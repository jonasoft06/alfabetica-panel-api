import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { changedFields } from '../activity-log/changed-fields.util';
import { logActivity } from '../activity-log/log-activity.util';
import { findActiveOrFail } from '../common/project-existence.util';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ProductionDetailDto,
  ProductionSource,
} from './dto/production-detail.dto';
import type { ProductionListItemDto } from './dto/production-list-item.dto';
import type { ProductionPhaseDto } from './dto/production-phase.dto';
import type { UpsertProductionDto } from './dto/upsert-production.dto';
import { productionError } from './production-errors';
import {
  ProductionSyncService,
  type ProductionSyncData,
} from './production-sync.service';
import {
  InconsistentStateError,
  resolveStatusAndPhase,
  type StatusAndPhase,
} from './utils/manual-state';
import { fromDbDate, toDbDate } from './utils/production-state';
import { generatePublicCode } from './utils/public-code.util';

// A collision in a 31^8 space is near impossible; the bound only guarantees
// the loop ends.
const PUBLIC_CODE_ATTEMPTS = 5;

const productionDetailSelect = {
  id: true,
  projectId: true,
  publicCode: true,
  authorName: true,
  clickupListId: true,
  bookType: true,
  status: true,
  currentPhase: { select: { code: true, label: true } },
  currentStageName: true,
  currentStageDueDate: true,
  estimatedEndDate: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductionSelect;

type ProductionDetailRow = Prisma.ProductionGetPayload<{
  select: typeof productionDetailSelect;
}>;

// A linked list is the source of truth; otherwise the data is typed by hand.
function sourceOf(production: {
  clickupListId: string | null;
}): ProductionSource {
  return production.clickupListId === null ? 'MANUAL' : 'CLICKUP';
}

// Stage due date and estimated end are calendar dates: serialized as
// YYYY-MM-DD. The audit timestamps stay ISO date-times.
function toDetailDto(production: ProductionDetailRow): ProductionDetailDto {
  return {
    ...production,
    source: sourceOf(production),
    currentStageDueDate: fromDbDate(production.currentStageDueDate),
    estimatedEndDate: fromDbDate(production.estimatedEndDate),
  };
}

// Unlinking turns the production MANUAL: the last known status, phase, book
// type and dates stay as the starting point for manual edits. Only what is
// meaningful with a list is cleared: the list itself, the ClickUp task name
// and the sync time.
const unlinkedData = {
  clickupListId: null,
  currentStageName: null,
  lastSyncedAt: null,
} satisfies Prisma.ProductionUncheckedUpdateInput;

// Fields only accepted in manual mode, by their body names.
const MANUAL_FIELDS = [
  'bookType',
  'status',
  'currentPhaseCode',
  'currentStageDueDate',
  'estimatedEndDate',
] as const satisfies readonly (keyof UpsertProductionDto)[];

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function linkChange(
  dto: UpsertProductionDto,
  currentListId: string | null,
): { isLinking: boolean; isUnlinking: boolean } {
  return {
    isLinking:
      typeof dto.clickupListId === 'string' &&
      dto.clickupListId !== currentListId,
    isUnlinking: dto.clickupListId === null && currentListId !== null,
  };
}

// Judged on the state after the request: "unlink + edit by hand" in one call
// is allowed, "link + edit by hand" is not (the sync would overwrite it).
function assertManualFieldsAllowed(
  dto: UpsertProductionDto,
  currentListId: string | null,
  isLinking: boolean,
  isUnlinking: boolean,
): void {
  const linkedAfter = isLinking || (currentListId !== null && !isUnlinking);

  if (linkedAfter && MANUAL_FIELDS.some((field) => dto[field] !== undefined)) {
    throw productionError('PRODUCTION_MANAGED_BY_CLICKUP');
  }
}

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: ProductionSyncService,
  ) {}

  async findOne(projectId: string): Promise<ProductionDetailDto> {
    await findActiveOrFail(this.prisma, projectId);

    const production = await this.prisma.production.findUnique({
      where: { projectId },
      select: productionDetailSelect,
    });

    if (!production) {
      throw productionError('PRODUCTION_NOT_FOUND');
    }

    return toDetailDto(production);
  }

  async findAll(): Promise<ProductionListItemDto[]> {
    const productions = await this.prisma.production.findMany({
      where: { project: { deletedAt: null } },
      select: {
        ...productionDetailSelect,
        project: { select: { title: true } },
      },
      orderBy: { project: { title: 'asc' } },
    });

    return productions.map((production) => ({
      projectId: production.projectId,
      projectTitle: production.project.title,
      publicCode: production.publicCode,
      authorName: production.authorName,
      source: sourceOf(production),
      status: production.status,
      bookType: production.bookType,
      currentPhase: production.currentPhase,
      currentStageName: production.currentStageName,
      currentStageDueDate: fromDbDate(production.currentStageDueDate),
      estimatedEndDate: fromDbDate(production.estimatedEndDate),
      lastSyncedAt: production.lastSyncedAt,
      updatedAt: production.updatedAt,
    }));
  }

  async findPhases(): Promise<ProductionPhaseDto[]> {
    return this.prisma.productionPhase.findMany({
      select: { id: true, code: true, label: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(
    projectId: string,
    userId: string,
  ): Promise<ProductionDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const existing = await tx.production.findUnique({
        where: { projectId },
        select: { id: true },
      });

      if (existing) {
        throw productionError('PRODUCTION_ALREADY_EXISTS');
      }

      return this.createInTx(tx, projectId, userId);
    });
  }

  // Also called by ProjectsService.create inside its own transaction, so a
  // project and its seeded production are created atomically.
  async createInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    userId: string,
  ): Promise<ProductionDetailDto> {
    const production = await tx.production.create({
      data: {
        projectId,
        publicCode: await this.uniquePublicCode(tx),
        updatedById: userId,
      },
      select: productionDetailSelect,
    });

    await logActivity(tx, {
      actorId: userId,
      action: 'production.create',
      entityType: 'production',
      entityId: production.id,
      projectId,
    });

    return toDetailDto(production);
  }

  async update(
    projectId: string,
    dto: UpsertProductionDto,
    userId: string,
  ): Promise<ProductionDetailDto> {
    const current = await this.findOne(projectId);
    const { isLinking, isUnlinking } = linkChange(dto, current.clickupListId);

    // Checked before calling ClickUp, and again inside the transaction.
    assertManualFieldsAllowed(
      dto,
      current.clickupListId,
      isLinking,
      isUnlinking,
    );

    let linkData: ProductionSyncData | null = null;

    if (isLinking) {
      const listId = dto.clickupListId as string;
      const owner = await this.prisma.production.findUnique({
        where: { clickupListId: listId },
        select: { id: true },
      });

      // Checked before calling ClickUp: no point validating a list that
      // cannot be linked anyway.
      if (owner && owner.id !== current.id) {
        throw productionError('CLICKUP_LIST_ALREADY_LINKED');
      }

      // ClickUp is read here, before the transaction, so no DB connection
      // waits on the network.
      linkData = await this.syncService.resolveForLink(listId);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await findActiveOrFail(tx, projectId);

        const production = await tx.production.findUnique({
          where: { projectId },
          select: productionDetailSelect,
        });

        if (!production) {
          throw productionError('PRODUCTION_NOT_FOUND');
        }

        // The link may have changed since the first read.
        assertManualFieldsAllowed(
          dto,
          production.clickupListId,
          isLinking,
          isUnlinking,
        );

        const authorData = { authorName: dto.authorName };
        const fields = changedFields(production, authorData);
        const manual = await this.resolveManualChanges(tx, production, dto);
        fields.push(...manual.fields);

        // A body that changes nothing is not a write: no updatedAt/updatedById
        // bump and no log row.
        if (fields.length === 0 && !isLinking && !isUnlinking) {
          return toDetailDto(production);
        }

        const updated = await tx.production.update({
          where: { id: production.id },
          data: {
            ...(fields.includes('authorName') ? authorData : {}),
            ...(isLinking
              ? { ...linkData, clickupListId: dto.clickupListId }
              : {}),
            ...(isUnlinking ? unlinkedData : {}),
            ...manual.data,
            updatedById: userId,
          },
          select: productionDetailSelect,
        });

        // Link/unlink first: in an "unlink + edit by hand" request the edits
        // apply to the now manual production.
        if (isLinking || isUnlinking) {
          await logActivity(tx, {
            actorId: userId,
            action: isLinking ? 'production.link' : 'production.unlink',
            entityType: 'production',
            entityId: production.id,
            projectId,
            metadata: {
              from: production.clickupListId,
              to: isLinking ? dto.clickupListId : null,
            },
          });
        }

        if (fields.length > 0) {
          await logActivity(tx, {
            actorId: userId,
            action: 'production.update',
            entityType: 'production',
            entityId: production.id,
            projectId,
            metadata: { fields },
          });
        }

        return toDetailDto(updated);
      });
    } catch (error) {
      // Another production linked the same list while ClickUp was being read;
      // the unique index caught it.
      if (isUniqueViolation(error)) {
        throw productionError('CLICKUP_LIST_ALREADY_LINKED');
      }
      throw error;
    }
  }

  // Merges the manual fields of the body onto the stored values, applies the
  // status/phase rules and returns only what actually changes, compared as the
  // API shows it (dates as YYYY-MM-DD, not as Date objects).
  private async resolveManualChanges(
    tx: Prisma.TransactionClient,
    production: ProductionDetailRow,
    dto: UpsertProductionDto,
  ): Promise<{
    fields: string[];
    data: Prisma.ProductionUncheckedUpdateInput;
  }> {
    const fields: string[] = [];
    const data: Prisma.ProductionUncheckedUpdateInput = {};

    if (!MANUAL_FIELDS.some((field) => dto[field] !== undefined)) {
      return { fields, data };
    }

    // An unknown code is a bad request even when it would change nothing.
    if (dto.currentPhaseCode !== undefined && dto.currentPhaseCode !== null) {
      await this.phaseIdOrFail(tx, dto.currentPhaseCode);
    }

    if (dto.bookType !== undefined && dto.bookType !== production.bookType) {
      fields.push('bookType');
      data.bookType = dto.bookType;
    }

    const currentPhaseCode = production.currentPhase?.code ?? null;
    let next: StatusAndPhase;
    try {
      next = resolveStatusAndPhase(
        { status: production.status, phaseCode: currentPhaseCode },
        { status: dto.status, phaseCode: dto.currentPhaseCode },
      );
    } catch (error) {
      if (error instanceof InconsistentStateError) {
        throw productionError('PRODUCTION_INCONSISTENT_STATE');
      }
      throw error;
    }

    if (next.status !== production.status) {
      fields.push('status');
      data.status = next.status;
    }

    if (next.phaseCode !== currentPhaseCode) {
      fields.push('currentPhaseCode');
      data.currentPhaseId = await this.phaseIdOrFail(tx, next.phaseCode);
    }

    if (
      dto.currentStageDueDate !== undefined &&
      dto.currentStageDueDate !== fromDbDate(production.currentStageDueDate)
    ) {
      fields.push('currentStageDueDate');
      data.currentStageDueDate = toDbDate(dto.currentStageDueDate);
    }

    if (
      dto.estimatedEndDate !== undefined &&
      dto.estimatedEndDate !== fromDbDate(production.estimatedEndDate)
    ) {
      fields.push('estimatedEndDate');
      data.estimatedEndDate = toDbDate(dto.estimatedEndDate);
    }

    return { fields, data };
  }

  private async phaseIdOrFail(
    tx: Prisma.TransactionClient,
    code: string | null,
  ): Promise<string | null> {
    if (code === null) {
      return null;
    }

    const phase = await tx.productionPhase.findUnique({
      where: { code },
      select: { id: true },
    });

    if (!phase) {
      throw productionError('PRODUCTION_PHASE_NOT_FOUND');
    }

    return phase.id;
  }

  // Re-reads the linked ClickUp list of one production. Unlike the bulk sync,
  // a FINISHED production is synced too. Like it, updatedById is not touched:
  // the data is derived; the log row records who asked for it.
  async sync(projectId: string, userId: string): Promise<ProductionDetailDto> {
    const current = await this.findOne(projectId);

    if (current.clickupListId === null) {
      throw productionError('PRODUCTION_NOT_LINKED');
    }

    const listId = current.clickupListId;

    // ClickUp is read before the transaction, so no DB connection waits on
    // the network.
    const data = await this.syncService.resolveForSingleSync(listId);

    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      // Guarded on the same list still being linked: an unlink or relink made
      // while ClickUp was being read wins.
      const { count } = await tx.production.updateMany({
        where: { id: current.id, clickupListId: listId },
        data,
      });

      const production = await tx.production.findUnique({
        where: { projectId },
        select: productionDetailSelect,
      });

      if (!production) {
        throw productionError('PRODUCTION_NOT_FOUND');
      }

      if (count === 0) {
        if (production.clickupListId === null) {
          throw productionError('PRODUCTION_NOT_LINKED');
        }
        // Relinked meanwhile: that link already synced the new list.
        return toDetailDto(production);
      }

      await logActivity(tx, {
        actorId: userId,
        action: 'production.sync',
        entityType: 'production',
        entityId: production.id,
        projectId,
        metadata: { scope: 'single' },
      });

      return toDetailDto(production);
    });
  }

  async remove(projectId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const production = await tx.production.findUnique({
        where: { projectId },
        select: { id: true },
      });

      if (!production) {
        throw productionError('PRODUCTION_NOT_FOUND');
      }

      // No files: a production only references ClickUp, which is never
      // written to.
      await tx.production.delete({ where: { id: production.id } });

      await logActivity(tx, {
        actorId: userId,
        action: 'production.delete',
        entityType: 'production',
        entityId: production.id,
        projectId,
      });
    });
  }

  // Part of the project soft delete, run inside ProjectsService.remove's
  // transaction. Same as an unlink: releases the ClickUp list so another
  // project can link it, and keeps the row, its publicCode and the manual
  // data.
  async cleanupForProjectDeleteInTx(
    tx: Prisma.TransactionClient,
    productionId: string,
    userId: string,
  ): Promise<void> {
    await tx.production.update({
      where: { id: productionId },
      data: { ...unlinkedData, updatedById: userId },
    });
  }

  private async uniquePublicCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    // Checked before inserting rather than retried on P2002: a failed insert
    // aborts the whole Postgres transaction.
    for (let attempt = 0; attempt < PUBLIC_CODE_ATTEMPTS; attempt += 1) {
      const candidate = generatePublicCode();
      const taken = await tx.production.findUnique({
        where: { publicCode: candidate },
        select: { id: true },
      });

      if (!taken) {
        return candidate;
      }
    }

    throw new Error('Could not generate a unique production public code');
  }
}

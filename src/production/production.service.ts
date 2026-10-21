import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ProductionStatus } from '../../generated/prisma/enums';
import { changedFields } from '../activity-log/changed-fields.util';
import { logActivity } from '../activity-log/log-activity.util';
import { findActiveOrFail } from '../common/project-existence.util';
import { PrismaService } from '../prisma/prisma.service';
import type { ProductionDetailDto } from './dto/production-detail.dto';
import type { ProductionListItemDto } from './dto/production-list-item.dto';
import type { ProductionPhaseDto } from './dto/production-phase.dto';
import type { UpsertProductionDto } from './dto/upsert-production.dto';
import { productionError } from './production-errors';
import {
  ProductionSyncService,
  type ProductionSyncData,
} from './production-sync.service';
import { fromDbDate } from './utils/production-state';
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

// Stage due date and estimated end are calendar dates: serialized as
// YYYY-MM-DD. The audit timestamps stay ISO date-times.
function toDetailDto(production: ProductionDetailRow): ProductionDetailDto {
  return {
    ...production,
    currentStageDueDate: fromDbDate(production.currentStageDueDate),
    estimatedEndDate: fromDbDate(production.estimatedEndDate),
  };
}

// Everything ClickUp-derived goes back to its unlinked state, so the panel never
// shows stale progress for a list that is no longer tracked.
const unlinkedData = {
  clickupListId: null,
  status: ProductionStatus.NOT_LINKED,
  bookType: null,
  currentPhaseId: null,
  currentStageName: null,
  currentStageDueDate: null,
  estimatedEndDate: null,
  lastSyncedAt: null,
} satisfies Prisma.ProductionUncheckedUpdateInput;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
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

    const isLinking =
      typeof dto.clickupListId === 'string' &&
      dto.clickupListId !== current.clickupListId;
    const isUnlinking =
      dto.clickupListId === null && current.clickupListId !== null;

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

        const fieldData = { authorName: dto.authorName };
        const fields = changedFields(production, fieldData);

        // A body that changes nothing is not a write: no updatedAt/updatedById
        // bump and no log row.
        if (fields.length === 0 && !isLinking && !isUnlinking) {
          return toDetailDto(production);
        }

        const updated = await tx.production.update({
          where: { id: production.id },
          data: {
            ...(fields.length > 0 ? fieldData : {}),
            ...(isLinking
              ? { ...linkData, clickupListId: dto.clickupListId }
              : {}),
            ...(isUnlinking ? unlinkedData : {}),
            updatedById: userId,
          },
          select: productionDetailSelect,
        });

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
  // transaction. Releases the ClickUp list so another project can link it,
  // and keeps the row and its publicCode.
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

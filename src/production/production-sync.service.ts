import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { BookType, ProductionStatus } from '../../generated/prisma/enums';
import { logActivity } from '../activity-log/log-activity.util';
import { ClickUpClient } from '../integrations/clickup/clickup.client';
import {
  ClickUpListNotFoundError,
  ClickUpUnavailableError,
} from '../integrations/clickup/clickup.errors';
import { PrismaService } from '../prisma/prisma.service';
import type { SyncResultDto } from './dto/sync-result.dto';
import { productionError } from './production-errors';
import type { PhaseCode } from './utils/phase-mapping';
import {
  computeInProductionState,
  toDbDate,
  UnmappedStagesError,
} from './utils/production-state';

type FolderKind = BookType | 'ARCHIVE' | 'OTHER';

// What a sync writes. bookType and estimatedEndDate are absent when an archived
// list leaves them as they were.
export type ProductionSyncData = Pick<
  Prisma.ProductionUncheckedUpdateInput,
  | 'bookType'
  | 'status'
  | 'currentPhaseId'
  | 'currentStageName'
  | 'currentStageDueDate'
  | 'estimatedEndDate'
  | 'lastSyncedAt'
>;

// The list sits in a folder that is not one of the production folders (or,
// when linking, in ARCHIVE). Mapped to CLICKUP_LIST_NOT_IN_PRODUCTION.
class ListNotInProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListNotInProductionError';
  }
}

@Injectable()
export class ProductionSyncService {
  private readonly logger = new Logger(ProductionSyncService.name);
  private readonly folderKinds: Map<string, FolderKind>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickUp: ClickUpClient,
    configService: ConfigService,
  ) {
    this.folderKinds = new Map<string, FolderKind>([
      [
        configService.getOrThrow<string>('CLICKUP_FOLDER_ACADEMIC_ID'),
        BookType.ACADEMIC,
      ],
      [
        configService.getOrThrow<string>('CLICKUP_FOLDER_TEXTBOOK_ID'),
        BookType.TEXTBOOK,
      ],
      [
        configService.getOrThrow<string>('CLICKUP_FOLDER_ARCHIVE_ID'),
        'ARCHIVE',
      ],
    ]);
  }

  // Validates a list being linked and returns the data to store with the link.
  // Throws HTTP errors (`code`): the caller is a request. Runs before any DB
  // transaction is opened, so no connection waits on ClickUp.
  async resolveForLink(listId: string): Promise<ProductionSyncData> {
    try {
      const list = await this.clickUp.getList(listId);
      const kind = this.folderKind(list.folderId);

      // Only lists still in production can be linked; an archived list has
      // nothing left to track.
      if (kind !== BookType.ACADEMIC && kind !== BookType.TEXTBOOK) {
        throw new ListNotInProductionError(`List is in a ${kind} folder`);
      }

      const tasks = await this.clickUp.getListTasks(listId);
      return this.inProductionData(kind, tasks, new Date());
    } catch (error) {
      throw this.toHttpError(error, `Link of list ${listId}`);
    }
  }

  // Same resolution as the bulk sync (an archived list becomes FINISHED, so a
  // FINISHED production can be re-synced), but for one production requested
  // by a user: failures become HTTP errors instead of being counted.
  async resolveForSingleSync(listId: string): Promise<ProductionSyncData> {
    try {
      return await this.resolveForSync(listId, new Date());
    } catch (error) {
      throw this.toHttpError(error, `Sync of list ${listId}`);
    }
  }

  // Syncs every linked production that is not finished, one at a time. A
  // failure only skips that production. Never sets updatedById: sync writes
  // derived data, not a human edit; the run itself is logged with its actor.
  async syncAll(actorId: string): Promise<SyncResultDto> {
    const syncedAt = new Date();
    const productions = await this.prisma.production.findMany({
      where: {
        clickupListId: { not: null },
        status: { not: ProductionStatus.FINISHED },
        project: { deletedAt: null },
      },
      select: { id: true, projectId: true, clickupListId: true },
      orderBy: { createdAt: 'asc' },
    });

    let updated = 0;
    let failed = 0;

    for (const production of productions) {
      const listId = production.clickupListId as string;

      try {
        const data = await this.resolveForSync(listId, syncedAt);

        // Guarded on the same list still being linked: an unlink or relink
        // made while ClickUp was being read wins.
        const { count } = await this.prisma.production.updateMany({
          where: { id: production.id, clickupListId: listId },
          data,
        });

        if (count === 1) {
          updated += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Sync failed for project ${production.projectId}: ${
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : 'unknown'
          }`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await logActivity(tx, {
        actorId,
        action: 'production.sync',
        entityType: 'production',
        entityId: 'sync',
        metadata: { updated, failed },
      });
    });

    return { syncedAt, updated, failed };
  }

  private async resolveForSync(
    listId: string,
    syncedAt: Date,
  ): Promise<ProductionSyncData> {
    const list = await this.clickUp.getList(listId);
    const kind = this.folderKind(list.folderId);

    if (kind === 'ARCHIVE') {
      // Finished: the book is out. bookType and estimatedEndDate are kept.
      return {
        status: ProductionStatus.FINISHED,
        currentPhaseId: await this.phaseId('PUBLISHED'),
        currentStageName: null,
        currentStageDueDate: null,
        lastSyncedAt: syncedAt,
      };
    }

    if (kind === 'OTHER') {
      throw new ListNotInProductionError(
        'List is no longer in a production folder',
      );
    }

    const tasks = await this.clickUp.getListTasks(listId);
    return this.inProductionData(kind, tasks, syncedAt);
  }

  private async inProductionData(
    bookType: BookType,
    tasks: Parameters<typeof computeInProductionState>[1],
    syncedAt: Date,
  ): Promise<ProductionSyncData> {
    const state = computeInProductionState(bookType, tasks);

    return {
      bookType: state.bookType,
      status: ProductionStatus.IN_PRODUCTION,
      currentPhaseId: await this.phaseId(state.phase),
      currentStageName: state.currentStageName,
      currentStageDueDate: toDbDate(state.currentStageDueDate),
      estimatedEndDate: toDbDate(state.estimatedEndDate),
      lastSyncedAt: syncedAt,
    };
  }

  // ClickUp and mapping failures -> `code` responses with generic messages.
  // The detail goes to the server log only.
  private toHttpError(error: unknown, context: string): unknown {
    if (error instanceof ClickUpListNotFoundError) {
      return productionError('CLICKUP_LIST_NOT_FOUND');
    }
    if (error instanceof ClickUpUnavailableError) {
      return productionError('CLICKUP_UNAVAILABLE');
    }
    if (error instanceof ListNotInProductionError) {
      this.logger.warn(`${context} rejected: ${error.message}`);
      return productionError('CLICKUP_LIST_NOT_IN_PRODUCTION');
    }
    if (error instanceof UnmappedStagesError) {
      this.logger.warn(`${context} rejected: ${error.message}`);
      return productionError('CLICKUP_LIST_UNMAPPED_STAGE');
    }
    return error;
  }

  private folderKind(folderId: string | null): FolderKind {
    return (folderId && this.folderKinds.get(folderId)) || 'OTHER';
  }

  private async phaseId(code: PhaseCode): Promise<string> {
    const phase = await this.prisma.productionPhase.findUnique({
      where: { code },
      select: { id: true },
    });

    // The catalog is seeded; a missing phase is a deploy error, not a
    // ClickUp problem.
    if (!phase) {
      throw new Error(`Production phase ${code} is not seeded`);
    }

    return phase.id;
  }
}

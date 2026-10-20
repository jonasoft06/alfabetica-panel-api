import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { MediaScope, MediaStatus } from '../../../generated/prisma/enums';
import {
  logActivity,
  type ActivityAction,
} from '../../activity-log/log-activity.util';
import {
  findActiveOrFail,
  type PrismaClientLike,
} from '../../common/project-existence.util';
import { PrismaService } from '../../prisma/prisma.service';
import { buildStorageKey } from '../../storage/storage-key.util';
import { StorageService } from '../../storage/storage.service';
import { mediaItemSelect, toMediaItem } from '../media-item.mapper';
import {
  EXTENSION_BY_MEDIA_TYPE,
  MAX_SIZE_BY_MEDIA_TYPE,
  MIME_TYPE_BY_MEDIA_TYPE,
  UPLOAD_URL_EXPIRES_IN_SECONDS,
} from '../media.service';
import type { CreateMediaResult } from '../media.service';
import type { CoverResponseDto } from './dto/cover-response.dto';
import type { CreateCoverDto } from './dto/create-cover.dto';

export type CoverFacet = 'portfolio' | 'publication';

// Everything that differs between the two cover flows. Each facet module owns
// its config; the rules themselves live once, in CoverService.
export interface CoverFacetConfig {
  // Appears in error messages and as the activity entityType.
  facet: CoverFacet;
  scope: MediaScope;
  width: number;
  height: number;
  action: ActivityAction;
  findByProject(
    client: PrismaClientLike,
    projectId: string,
  ): Promise<{ id: string; coverMediaId: string | null } | null>;
  // Sets the cover only if none is set yet; count is 0 when it lost the race.
  setCover(
    tx: Prisma.TransactionClient,
    facetId: string,
    mediaId: string,
    userId: string,
  ): Promise<Prisma.BatchPayload>;
}

@Injectable()
export class CoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async findCover(
    projectId: string,
    config: CoverFacetConfig,
  ): Promise<CoverResponseDto> {
    await findActiveOrFail(this.prisma, projectId);

    const target = await config.findByProject(this.prisma, projectId);

    if (!target) {
      throw new NotFoundException(`Project has no ${config.facet}`);
    }

    if (!target.coverMediaId) {
      return { cover: null };
    }

    const cover = await this.prisma.projectMedia.findFirst({
      where: { id: target.coverMediaId, status: MediaStatus.CONFIRMED },
      select: mediaItemSelect,
    });

    return { cover: cover ? toMediaItem(this.storageService, cover) : null };
  }

  async createCover(
    projectId: string,
    config: CoverFacetConfig,
    dto: CreateCoverDto,
  ): Promise<CreateMediaResult> {
    await findActiveOrFail(this.prisma, projectId);

    const target = await config.findByProject(this.prisma, projectId);

    if (!target) {
      throw new NotFoundException(
        `Project has no ${config.facet} to set a cover for`,
      );
    }

    if (target.coverMediaId) {
      throw new ConflictException({ reason: 'COVER_ALREADY_EXISTS' });
    }

    if (dto.mimeType !== MIME_TYPE_BY_MEDIA_TYPE.IMAGE) {
      throw new BadRequestException('Mime type does not match media type');
    }

    if (dto.sizeBytes > MAX_SIZE_BY_MEDIA_TYPE.IMAGE) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }

    if (dto.width !== config.width || dto.height !== config.height) {
      throw new BadRequestException({
        reason: 'COVER_INVALID_DIMENSIONS',
        expectedWidth: config.width,
        expectedHeight: config.height,
      });
    }

    const mediaId = randomUUID();
    const storageKey = buildStorageKey({
      scope: config.scope,
      projectId,
      mediaId,
      extension: EXTENSION_BY_MEDIA_TYPE.IMAGE,
    });

    await this.prisma.projectMedia.create({
      data: {
        id: mediaId,
        projectId,
        scope: config.scope,
        type: 'IMAGE',
        storageKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        alt: dto.alt,
        caption: dto.caption,
        width: dto.width,
        height: dto.height,
        // A null displayOrder is what marks this row as a cover, and what
        // makes the generic PATCH /media/:id/confirm refuse it.
        displayOrder: null,
        status: 'PENDING',
      },
    });

    const uploadUrl = await this.storageService.generateUploadUrl(
      storageKey,
      dto.mimeType,
    );

    return {
      mediaId,
      uploadUrl,
      storageKey,
      expiresIn: UPLOAD_URL_EXPIRES_IN_SECONDS,
      width: dto.width,
      height: dto.height,
    };
  }

  // Runs inside the caller's transaction: the facet services open it and load
  // the project detail they return in that same transaction.
  async confirmCoverInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    config: CoverFacetConfig,
    mediaId: string,
    userId: string,
  ): Promise<void> {
    await findActiveOrFail(tx, projectId);

    const target = await config.findByProject(tx, projectId);

    if (!target) {
      throw new NotFoundException(
        `Project has no ${config.facet} to set a cover for`,
      );
    }

    if (target.coverMediaId) {
      throw new ConflictException({ reason: 'COVER_ALREADY_EXISTS' });
    }

    const media = await tx.projectMedia.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        projectId: true,
        scope: true,
        type: true,
        status: true,
        displayOrder: true,
      },
    });

    if (!media || media.projectId !== projectId) {
      throw new NotFoundException('Cover media not found for this project');
    }

    if (
      media.scope !== config.scope ||
      media.type !== 'IMAGE' ||
      media.displayOrder !== null
    ) {
      throw new BadRequestException(
        `Media is not eligible as a ${config.facet} cover`,
      );
    }

    if (media.status !== 'PENDING') {
      throw new ConflictException('Media is not pending confirmation');
    }

    await tx.projectMedia.update({
      where: { id: media.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    // Guarded on coverMediaId still being null, so a cover confirmed by a
    // concurrent request since the check above is never overwritten.
    const { count } = await config.setCover(tx, target.id, media.id, userId);

    if (count === 0) {
      throw new ConflictException({ reason: 'COVER_ALREADY_EXISTS' });
    }

    await logActivity(tx, {
      actorId: userId,
      action: config.action,
      entityType: config.facet,
      entityId: target.id,
      projectId,
      metadata: { mediaId: media.id },
    });
  }
}

import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaScope,
  MediaStatus,
  MediaType,
  PublicationType,
} from '../../generated/prisma/enums';
import { logActivity } from '../activity-log/log-activity.util';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { findActiveOrFail } from '../projects/project-existence.util';
import { deleteStorageObjectSilently } from '../storage/delete-storage-object-silently.util';
import { buildStorageKey } from '../storage/storage-key.util';
import { StorageService } from '../storage/storage.service';
import type { CreateMediaDto } from './dto/create-media.dto';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024;
export const UPLOAD_URL_EXPIRES_IN_SECONDS = 900;
const PENDING_CLEANUP_AGE_MS = 2 * 60 * 60 * 1000;

// Media is gated by the module that owns it, not by 'projects': uploading a
// portfolio image is a portfolio edit, uploading a publication PDF is a
// publication edit. The scope is only known from the body or the stored row,
// so @RequirePermissions cannot express this and the check lives in the service.
const PERMISSION_BY_MEDIA_SCOPE: Record<MediaScope, string> = {
  PORTFOLIO: 'portfolio',
  PUBLICATION: 'publication',
};

export const MIME_TYPE_BY_MEDIA_TYPE: Record<MediaType, string> = {
  IMAGE: 'image/webp',
  PDF: 'application/pdf',
};

export const MAX_SIZE_BY_MEDIA_TYPE: Record<MediaType, number> = {
  IMAGE: MAX_IMAGE_SIZE_BYTES,
  PDF: MAX_PDF_SIZE_BYTES,
};

export const EXTENSION_BY_MEDIA_TYPE: Record<MediaType, string> = {
  IMAGE: 'webp',
  PDF: 'pdf',
};

export interface CreateMediaResult {
  mediaId: string;
  uploadUrl: string;
  storageKey: string;
  expiresIn: number;
  width: number | null;
  height: number | null;
}

export interface ConfirmMediaResult {
  id: string;
  status: MediaStatus;
  confirmedAt: Date;
  width: number | null;
  height: number | null;
}

export interface CleanupPendingMediaResult {
  purged: number;
}

function assertScopePermission(
  user: AccessTokenPayload,
  scope: MediaScope,
): void {
  const permission = PERMISSION_BY_MEDIA_SCOPE[scope];

  if (!user.permissions.includes(permission)) {
    throw new ForbiddenException(
      `Missing required permission(s): ${permission}`,
    );
  }
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async createMedia(
    projectId: string,
    dto: CreateMediaDto,
    user: AccessTokenPayload,
  ): Promise<CreateMediaResult> {
    await findActiveOrFail(this.prisma, projectId);

    assertScopePermission(user, dto.scope);

    // PDFs only enter through POST /projects/:id/publication/sections/:sectionId/pdf,
    // so every media row created here is a gallery image.
    if (dto.type === MediaType.PDF) {
      throw new BadRequestException({ reason: 'PDF_REQUIRES_SECTION_ROUTE' });
    }

    if (dto.scope === MediaScope.PUBLICATION) {
      const publication = await this.prisma.publication.findUnique({
        where: { projectId },
        select: { type: true },
      });

      // A DOI publication shows its sections instead of a gallery.
      if (publication?.type === PublicationType.DOI) {
        throw new ConflictException({ reason: 'PUBLICATION_DOI_NO_GALLERY' });
      }
    }

    if (dto.mimeType !== MIME_TYPE_BY_MEDIA_TYPE[dto.type]) {
      throw new BadRequestException('Mime type does not match media type');
    }

    if (dto.sizeBytes > MAX_SIZE_BY_MEDIA_TYPE[dto.type]) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }

    const width = dto.width ?? null;
    const height = dto.height ?? null;

    if (width === null || height === null) {
      throw new BadRequestException('Width and height are required for images');
    }

    const { _max } = await this.prisma.projectMedia.aggregate({
      where: { projectId, scope: dto.scope },
      _max: { displayOrder: true },
    });
    const displayOrder = (_max.displayOrder ?? -1) + 1;

    const mediaId = randomUUID();
    const storageKey = buildStorageKey({
      scope: dto.scope,
      projectId,
      mediaId,
      extension: EXTENSION_BY_MEDIA_TYPE[dto.type],
    });

    await this.prisma.projectMedia.create({
      data: {
        id: mediaId,
        projectId,
        scope: dto.scope,
        type: dto.type,
        storageKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        alt: dto.alt,
        caption: dto.caption,
        width,
        height,
        displayOrder,
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
      width,
      height,
    };
  }

  async confirmMedia(
    mediaId: string,
    user: AccessTokenPayload,
  ): Promise<ConfirmMediaResult> {
    const media = await this.prisma.projectMedia.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        projectId: true,
        status: true,
        displayOrder: true,
        scope: true,
        type: true,
        width: true,
        height: true,
      },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    assertScopePermission(user, media.scope);

    // Section PDFs are confirmed only through
    // PATCH /projects/:id/publication/sections/:sectionId/pdf/confirm, which
    // links them to their section. They are created with a null displayOrder
    // like covers, so this check runs before the cover check. The response
    // does not name the route.
    if (media.type === MediaType.PDF) {
      throw new BadRequestException({ reason: 'MEDIA_CONFIRM_NOT_ALLOWED' });
    }

    // Covers (portfolio and publication alike) are the only media created
    // with a null displayOrder. Each facet confirms its cover only through
    // PATCH /projects/:id/<scope>/cover/confirm, which sets it as that facet's
    // cover. The response does not name the route.
    if (media.displayOrder === null) {
      throw new BadRequestException({ reason: 'MEDIA_CONFIRM_NOT_ALLOWED' });
    }

    if (media.status === MediaStatus.CONFIRMED) {
      throw new ConflictException('Media already confirmed');
    }

    const confirmedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.projectMedia.update({
        where: { id: mediaId },
        data: { status: MediaStatus.CONFIRMED, confirmedAt },
      });

      await logActivity(tx, {
        actorId: user.sub,
        action: 'media.confirm',
        entityType: 'media',
        entityId: mediaId,
        projectId: media.projectId,
        metadata: { scope: media.scope, type: media.type },
      });
    });

    return {
      id: mediaId,
      status: MediaStatus.CONFIRMED,
      confirmedAt,
      width: media.width,
      height: media.height,
    };
  }

  async deleteMedia(mediaId: string, user: AccessTokenPayload): Promise<void> {
    const media = await this.prisma.projectMedia.findUnique({
      where: { id: mediaId },
      select: {
        projectId: true,
        storageKey: true,
        scope: true,
        type: true,
        publicationSectionPdf: { select: { id: true, publicationId: true } },
      },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    assertScopePermission(user, media.scope);

    const section = media.publicationSectionPdf;

    await this.prisma.$transaction(async (tx) => {
      await tx.portfolio.updateMany({
        where: { coverMediaId: mediaId },
        data: { coverMediaId: null, updatedById: user.sub },
      });

      await tx.publication.updateMany({
        where: { coverMediaId: mediaId },
        data: { coverMediaId: null, updatedById: user.sub },
      });

      // Released before the media row goes (RESTRICT FK). Unlike covers, this
      // does not touch Publication.updatedById: sections are their own rows.
      if (section) {
        await tx.publicationSection.update({
          where: { id: section.id },
          data: { pdfMediaId: null },
        });
      }

      await tx.projectMedia.delete({ where: { id: mediaId } });

      // A section PDF is logged on the publication, where its history lives,
      // instead of as a generic media.delete.
      await logActivity(
        tx,
        section
          ? {
              actorId: user.sub,
              action: 'publication.section_pdf_removed',
              entityType: 'publication',
              entityId: section.publicationId,
              projectId: media.projectId,
              metadata: { sectionId: section.id, mediaId },
            }
          : {
              actorId: user.sub,
              action: 'media.delete',
              entityType: 'media',
              entityId: mediaId,
              projectId: media.projectId,
              metadata: { scope: media.scope, type: media.type },
            },
      );
    });

    await deleteStorageObjectSilently(this.storageService, media.storageKey);
  }

  async cleanupPendingMedia(
    user: AccessTokenPayload,
  ): Promise<CleanupPendingMediaResult> {
    const cutoff = new Date(Date.now() - PENDING_CLEANUP_AGE_MS);

    const stale = await this.prisma.projectMedia.findMany({
      where: { status: MediaStatus.PENDING, createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
    });

    // One row per run, including runs that purge nothing: the run itself is
    // the audited operation.
    await this.prisma.$transaction(async (tx) => {
      if (stale.length > 0) {
        await tx.projectMedia.deleteMany({
          where: { id: { in: stale.map((media) => media.id) } },
        });
      }

      await logActivity(tx, {
        actorId: user.sub,
        action: 'media.cleanup',
        entityType: 'media',
        entityId: 'cleanup',
        metadata: { purgedCount: stale.length },
      });
    });

    await Promise.all(
      stale.map((media) =>
        deleteStorageObjectSilently(this.storageService, media.storageKey),
      ),
    );

    return { purged: stale.length };
  }
}

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
} from '../../generated/prisma/enums';
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

const ALLOWED_TYPES_BY_SCOPE: Record<MediaScope, MediaType[]> = {
  PORTFOLIO: [MediaType.IMAGE],
  PUBLICATION: [MediaType.IMAGE, MediaType.PDF],
};

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
}

export interface ConfirmMediaResult {
  id: string;
  status: MediaStatus;
  confirmedAt: Date;
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

    if (!ALLOWED_TYPES_BY_SCOPE[dto.scope].includes(dto.type)) {
      throw new BadRequestException('Invalid type for this scope');
    }

    if (dto.mimeType !== MIME_TYPE_BY_MEDIA_TYPE[dto.type]) {
      throw new BadRequestException('Mime type does not match media type');
    }

    if (dto.sizeBytes > MAX_SIZE_BY_MEDIA_TYPE[dto.type]) {
      throw new BadRequestException('File exceeds maximum allowed size');
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
    };
  }

  async confirmMedia(
    mediaId: string,
    user: AccessTokenPayload,
  ): Promise<ConfirmMediaResult> {
    const media = await this.prisma.projectMedia.findUnique({
      where: { id: mediaId },
      select: { id: true, status: true, displayOrder: true, scope: true },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    assertScopePermission(user, media.scope);

    if (media.displayOrder === null) {
      throw new BadRequestException(
        'Portfolio cover media must be confirmed via PATCH /projects/:id/portfolio/cover/confirm',
      );
    }

    if (media.status === MediaStatus.CONFIRMED) {
      throw new ConflictException('Media already confirmed');
    }

    const confirmedAt = new Date();
    await this.prisma.projectMedia.update({
      where: { id: mediaId },
      data: { status: MediaStatus.CONFIRMED, confirmedAt },
    });

    return { id: mediaId, status: MediaStatus.CONFIRMED, confirmedAt };
  }

  async deleteMedia(mediaId: string, user: AccessTokenPayload): Promise<void> {
    const media = await this.prisma.projectMedia.findUnique({
      where: { id: mediaId },
      select: { storageKey: true, scope: true },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    assertScopePermission(user, media.scope);

    await this.prisma.$transaction(async (tx) => {
      await tx.portfolio.updateMany({
        where: { coverMediaId: mediaId },
        data: { coverMediaId: null },
      });

      await tx.projectMedia.delete({ where: { id: mediaId } });
    });

    await deleteStorageObjectSilently(this.storageService, media.storageKey);
  }

  async cleanupPendingMedia(): Promise<CleanupPendingMediaResult> {
    const cutoff = new Date(Date.now() - PENDING_CLEANUP_AGE_MS);

    const stale = await this.prisma.projectMedia.findMany({
      where: { status: MediaStatus.PENDING, createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
    });

    if (stale.length === 0) {
      return { purged: 0 };
    }

    await this.prisma.projectMedia.deleteMany({
      where: { id: { in: stale.map((media) => media.id) } },
    });

    await Promise.all(
      stale.map((media) =>
        deleteStorageObjectSilently(this.storageService, media.storageKey),
      ),
    );

    return { purged: stale.length };
  }
}

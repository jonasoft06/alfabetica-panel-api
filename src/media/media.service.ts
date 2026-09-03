import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MediaScope, MediaType } from '../../generated/prisma/enums';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { buildStorageKey } from '../storage/storage-key.util';
import { StorageService } from '../storage/storage.service';
import type { CreateMediaDto } from './dto/create-media.dto';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024;
export const UPLOAD_URL_EXPIRES_IN_SECONDS = 900;

const ALLOWED_TYPES_BY_SCOPE: Record<MediaScope, MediaType[]> = {
  PORTFOLIO: [MediaType.IMAGE],
  PUBLICATION: [MediaType.IMAGE, MediaType.PDF],
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
    if (
      dto.scope === MediaScope.PUBLICATION &&
      !user.permissions.includes('publication')
    ) {
      throw new ForbiddenException(
        'Missing required permission(s): publication',
      );
    }

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
}

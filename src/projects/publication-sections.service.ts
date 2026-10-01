import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  MediaScope,
  MediaStatus,
  MediaType,
  PublicationType,
} from '../../generated/prisma/enums';
import { changedFields } from '../activity-log/changed-fields.util';
import { logActivity } from '../activity-log/log-activity.util';
import {
  EXTENSION_BY_MEDIA_TYPE,
  MAX_SIZE_BY_MEDIA_TYPE,
  MIME_TYPE_BY_MEDIA_TYPE,
  UPLOAD_URL_EXPIRES_IN_SECONDS,
} from '../media/media.service';
import type { CreateMediaResult } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { deleteStorageObjectSilently } from '../storage/delete-storage-object-silently.util';
import { buildStorageKey } from '../storage/storage-key.util';
import { StorageService } from '../storage/storage.service';
import type { CreatePublicationSectionDto } from './dto/create-publication-section.dto';
import type { CreateSectionPdfDto } from './dto/create-section-pdf.dto';
import type { PublicationSectionDto } from './dto/publication-section.dto';
import type { ReorderPublicationSectionsDto } from './dto/reorder-publication-sections.dto';
import type { UpdatePublicationSectionDto } from './dto/update-publication-section.dto';
import {
  findActiveOrFail,
  type PrismaClientLike,
} from './project-existence.util';

const sectionSelect = {
  id: true,
  label: true,
  description: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  pdfMedia: {
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      originalName: true,
    },
  },
} satisfies Prisma.PublicationSectionSelect;

type SectionRow = Prisma.PublicationSectionGetPayload<{
  select: typeof sectionSelect;
}>;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// Section writes never touch Publication.updatedById/updatedAt: a section is
// its own row, and its history lives in ActivityLog only.
@Injectable()
export class PublicationSectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async findAll(projectId: string): Promise<PublicationSectionDto[]> {
    const publication = await this.findPublicationOrFail(
      this.prisma,
      projectId,
    );

    // Only DOI publications have sections; any other type simply has none.
    if (publication.type !== PublicationType.DOI) {
      return [];
    }

    return this.listSections(this.prisma, publication.id);
  }

  async create(
    projectId: string,
    dto: CreatePublicationSectionDto,
    userId: string,
  ): Promise<PublicationSectionDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const publication = await this.findPublicationOrFail(tx, projectId);

        if (publication.type !== PublicationType.DOI) {
          throw new ConflictException({ reason: 'PUBLICATION_NOT_DOI' });
        }

        const sortOrder =
          dto.sortOrder ?? (await this.nextSortOrder(tx, publication.id));

        if (dto.sortOrder !== undefined) {
          const taken = await tx.publicationSection.findUnique({
            where: {
              publicationId_sortOrder: {
                publicationId: publication.id,
                sortOrder,
              },
            },
            select: { id: true },
          });

          if (taken) {
            throw new ConflictException({ reason: 'SECTION_SORT_ORDER_TAKEN' });
          }
        }

        const section = await tx.publicationSection.create({
          data: {
            publicationId: publication.id,
            label: dto.label,
            description: dto.description,
            sortOrder,
          },
          select: sectionSelect,
        });

        await logActivity(tx, {
          actorId: userId,
          action: 'publication.section_create',
          entityType: 'publication',
          entityId: publication.id,
          projectId,
          metadata: {
            sectionId: section.id,
            label: section.label,
            sortOrder: section.sortOrder,
          },
        });

        return this.toDto(section);
      });
    } catch (error) {
      // A concurrent request took the same sortOrder after the check above
      // passed; the unique constraint caught it.
      if (isUniqueViolation(error)) {
        throw new ConflictException({ reason: 'SECTION_SORT_ORDER_TAKEN' });
      }
      throw error;
    }
  }

  async update(
    projectId: string,
    sectionId: string,
    dto: UpdatePublicationSectionDto,
    userId: string,
  ): Promise<PublicationSectionDto> {
    return this.prisma.$transaction(async (tx) => {
      const publication = await this.findPublicationOrFail(tx, projectId);
      const section = await this.findSectionOrFail(
        tx,
        publication.id,
        sectionId,
      );

      const data = { label: dto.label, description: dto.description };
      const fields = changedFields(section, data);

      // A body that changes nothing is not a write: no updatedAt bump and no
      // log row.
      if (fields.length === 0) {
        return this.toDto(section);
      }

      const updated = await tx.publicationSection.update({
        where: { id: section.id },
        data,
        select: sectionSelect,
      });

      await logActivity(tx, {
        actorId: userId,
        action: 'publication.section_update',
        entityType: 'publication',
        entityId: publication.id,
        projectId,
        metadata: { sectionId: section.id, fields },
      });

      return this.toDto(updated);
    });
  }

  async reorder(
    projectId: string,
    dto: ReorderPublicationSectionsDto,
    userId: string,
  ): Promise<PublicationSectionDto[]> {
    return this.prisma.$transaction(async (tx) => {
      const publication = await this.findPublicationOrFail(tx, projectId);

      const current = await tx.publicationSection.findMany({
        where: { publicationId: publication.id },
        select: { id: true },
        orderBy: { sortOrder: 'asc' },
      });

      assertSameSections(
        current.map((section) => section.id),
        dto.sectionIds,
      );

      // Same sequence as today: nothing to write, even if the stored values
      // have gaps (1, 2, 5), since gaps are allowed.
      const isUnchanged = dto.sectionIds.every(
        (id, index) => current[index].id === id,
      );

      if (isUnchanged) {
        return this.listSections(tx, publication.id);
      }

      // Two phases so no intermediate state collides with the unique
      // (publicationId, sortOrder) constraint: first park every row on a
      // negative value nobody else uses, then write the final 1..N.
      for (const [index, id] of dto.sectionIds.entries()) {
        await tx.publicationSection.update({
          where: { id },
          data: { sortOrder: -(index + 1) },
        });
      }

      for (const [index, id] of dto.sectionIds.entries()) {
        await tx.publicationSection.update({
          where: { id },
          data: { sortOrder: index + 1 },
        });
      }

      await logActivity(tx, {
        actorId: userId,
        action: 'publication.sections_reorder',
        entityType: 'publication',
        entityId: publication.id,
        projectId,
        metadata: { sectionIds: dto.sectionIds },
      });

      return this.listSections(tx, publication.id);
    });
  }

  async remove(
    projectId: string,
    sectionId: string,
    userId: string,
  ): Promise<void> {
    const storageKey = await this.prisma.$transaction(async (tx) => {
      const publication = await this.findPublicationOrFail(tx, projectId);
      const section = await this.findSectionOrFail(
        tx,
        publication.id,
        sectionId,
      );

      // The section goes first: it references its PDF with a RESTRICT FK.
      // Remaining sections keep their sortOrder; gaps are allowed.
      await tx.publicationSection.delete({ where: { id: section.id } });

      if (section.pdfMedia) {
        await tx.projectMedia.delete({ where: { id: section.pdfMedia.id } });
      }

      await logActivity(tx, {
        actorId: userId,
        action: 'publication.section_delete',
        entityType: 'publication',
        entityId: publication.id,
        projectId,
        metadata: {
          sectionId: section.id,
          pdfMediaId: section.pdfMedia?.id ?? null,
        },
      });

      return section.pdfMedia?.storageKey ?? null;
    });

    // Storage cleanup runs after the transaction commits: a failed delete here
    // only leaves an orphaned object, which is harmless.
    if (storageKey) {
      await deleteStorageObjectSilently(this.storageService, storageKey);
    }
  }

  // Mirrors ProjectsService.createCover: a PENDING media row plus a presigned
  // upload URL. Nothing is linked to the section until confirmPdf.
  async createPdf(
    projectId: string,
    sectionId: string,
    dto: CreateSectionPdfDto,
  ): Promise<CreateMediaResult> {
    const publication = await this.findPublicationOrFail(
      this.prisma,
      projectId,
    );
    const section = await this.findSectionOrFail(
      this.prisma,
      publication.id,
      sectionId,
    );

    if (section.pdfMedia) {
      throw new ConflictException({ reason: 'SECTION_PDF_ALREADY_EXISTS' });
    }

    if (dto.mimeType !== MIME_TYPE_BY_MEDIA_TYPE.PDF) {
      throw new BadRequestException('Mime type does not match media type');
    }

    if (dto.sizeBytes > MAX_SIZE_BY_MEDIA_TYPE.PDF) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }

    const mediaId = randomUUID();
    const storageKey = buildStorageKey({
      scope: MediaScope.PUBLICATION,
      projectId,
      mediaId,
      extension: EXTENSION_BY_MEDIA_TYPE.PDF,
    });

    await this.prisma.projectMedia.create({
      data: {
        id: mediaId,
        projectId,
        scope: MediaScope.PUBLICATION,
        type: MediaType.PDF,
        storageKey,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        // Not part of any gallery ordering, same as covers.
        displayOrder: null,
        status: MediaStatus.PENDING,
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
      width: null,
      height: null,
    };
  }

  // Mirrors ProjectsService.confirmCover.
  async confirmPdf(
    projectId: string,
    sectionId: string,
    mediaId: string,
    userId: string,
  ): Promise<PublicationSectionDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const publication = await this.findPublicationOrFail(tx, projectId);
        const section = await this.findSectionOrFail(
          tx,
          publication.id,
          sectionId,
        );

        if (section.pdfMedia) {
          throw new ConflictException({ reason: 'SECTION_PDF_ALREADY_EXISTS' });
        }

        const media = await tx.projectMedia.findUnique({
          where: { id: mediaId },
          select: {
            id: true,
            projectId: true,
            scope: true,
            type: true,
            status: true,
            publicationSectionPdf: { select: { id: true } },
          },
        });

        if (!media || media.projectId !== projectId) {
          throw new NotFoundException(
            'Section PDF media not found for this project',
          );
        }

        if (
          media.scope !== MediaScope.PUBLICATION ||
          media.type !== MediaType.PDF
        ) {
          throw new BadRequestException(
            'Media is not eligible as a section PDF',
          );
        }

        if (media.publicationSectionPdf) {
          throw new ConflictException({ reason: 'SECTION_PDF_ALREADY_USED' });
        }

        if (media.status !== MediaStatus.PENDING) {
          throw new ConflictException('Media is not pending confirmation');
        }

        await tx.projectMedia.update({
          where: { id: media.id },
          data: { status: MediaStatus.CONFIRMED, confirmedAt: new Date() },
        });

        // Guarded on pdfMediaId still being null, so a PDF confirmed by a
        // concurrent request since the check above is never overwritten.
        const { count } = await tx.publicationSection.updateMany({
          where: { id: section.id, pdfMediaId: null },
          data: { pdfMediaId: media.id },
        });

        if (count === 0) {
          throw new ConflictException({ reason: 'SECTION_PDF_ALREADY_EXISTS' });
        }

        await logActivity(tx, {
          actorId: userId,
          action: 'publication.section_pdf_set',
          entityType: 'publication',
          entityId: publication.id,
          projectId,
          metadata: { sectionId: section.id, mediaId: media.id },
        });

        return this.toDto(
          await tx.publicationSection.findUniqueOrThrow({
            where: { id: section.id },
            select: sectionSelect,
          }),
        );
      });
    } catch (error) {
      // The same media was linked to another section concurrently; the
      // unique pdfMediaId constraint caught it.
      if (isUniqueViolation(error)) {
        throw new ConflictException({ reason: 'SECTION_PDF_ALREADY_USED' });
      }
      throw error;
    }
  }

  private async findPublicationOrFail(
    client: PrismaClientLike,
    projectId: string,
  ): Promise<{ id: string; type: PublicationType }> {
    await findActiveOrFail(client, projectId);

    const publication = await client.publication.findUnique({
      where: { projectId },
      select: { id: true, type: true },
    });

    if (!publication) {
      throw new NotFoundException('Project has no publication');
    }

    return publication;
  }

  private async findSectionOrFail(
    client: PrismaClientLike,
    publicationId: string,
    sectionId: string,
  ): Promise<SectionRow> {
    const section = await client.publicationSection.findFirst({
      where: { id: sectionId, publicationId },
      select: sectionSelect,
    });

    if (!section) {
      throw new NotFoundException('Section not found for this publication');
    }

    return section;
  }

  private async nextSortOrder(
    client: PrismaClientLike,
    publicationId: string,
  ): Promise<number> {
    const { _max } = await client.publicationSection.aggregate({
      where: { publicationId },
      _max: { sortOrder: true },
    });

    return (_max.sortOrder ?? 0) + 1;
  }

  private async listSections(
    client: PrismaClientLike,
    publicationId: string,
  ): Promise<PublicationSectionDto[]> {
    const sections = await client.publicationSection.findMany({
      where: { publicationId },
      select: sectionSelect,
      orderBy: { sortOrder: 'asc' },
    });

    return sections.map((section) => this.toDto(section));
  }

  private toDto(section: SectionRow): PublicationSectionDto {
    return {
      id: section.id,
      label: section.label,
      description: section.description,
      sortOrder: section.sortOrder,
      createdAt: section.createdAt,
      updatedAt: section.updatedAt,
      pdf: section.pdfMedia
        ? {
            id: section.pdfMedia.id,
            url: this.storageService.publicUrl(section.pdfMedia.storageKey),
            mimeType: section.pdfMedia.mimeType,
            sizeBytes: section.pdfMedia.sizeBytes,
            originalName: section.pdfMedia.originalName,
          }
        : null,
    };
  }
}

// The body must name every section of the publication exactly once.
function assertSameSections(
  currentIds: string[],
  requestedIds: string[],
): void {
  const current = new Set(currentIds);
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const id of requestedIds) {
    if (seen.has(id)) {
      duplicated.add(id);
    }
    seen.add(id);
  }

  const missing = currentIds.filter((id) => !seen.has(id));
  const unknown = [...seen].filter((id) => !current.has(id));

  if (missing.length > 0 || unknown.length > 0 || duplicated.size > 0) {
    throw new BadRequestException({
      reason: 'SECTIONS_ORDER_MISMATCH',
      missing,
      unknown,
      duplicated: [...duplicated],
    });
  }
}

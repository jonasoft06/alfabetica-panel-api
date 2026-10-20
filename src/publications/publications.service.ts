import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  MediaScope,
  MediaType,
  PublicationType,
} from '../../generated/prisma/enums';
import { changedFields } from '../activity-log/changed-fields.util';
import { logActivity } from '../activity-log/log-activity.util';
import type { ProjectDetailDto } from '../common/dto/project-detail.dto';
import { loadProjectDetailOrFail } from '../common/project-detail.util';
import {
  findActiveOrFail,
  type PrismaClientLike,
} from '../common/project-existence.util';
import { slugify, uniqueSlug } from '../common/utils/slug.util';
import { CoverService } from '../media/covers/cover.service';
import type { CoverResponseDto } from '../media/covers/dto/cover-response.dto';
import type { CreateCoverDto } from '../media/covers/dto/create-cover.dto';
import { coverItemSelect, toCoverItem } from '../media/media-item.mapper';
import type { CreateMediaResult } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { deleteStorageObjectSilently } from '../storage/delete-storage-object-silently.util';
import { StorageService } from '../storage/storage.service';
import type { CreatePublicationDto } from './dto/create-publication.dto';
import type { FindPublicationsQueryDto } from './dto/find-publications-query.dto';
import type { PublicationDetailDto } from './dto/publication-detail.dto';
import type { PublicationListResponseDto } from './dto/publication-list.dto';
import type { UpsertPublicationDto } from './dto/upsert-publication.dto';
import { PUBLICATION_COVER } from './publication-cover.config';

const publicationDetailSelect = {
  id: true,
  slug: true,
  type: true,
  coverMediaId: true,
  authors: true,
  editionNumber: true,
  format: true,
  collection: true,
  measures: true,
  presentation: true,
  audience: true,
  language: true,
  isbn: true,
  sku: true,
  price: true,
  quantity: true,
  pages: true,
  compareAtPrice: true,
  currency: true,
  externalUrl: true,
  isPublished: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PublicationSelect;

const activePublicationWhere = {
  project: { deletedAt: null },
} satisfies Prisma.PublicationWhereInput;

@Injectable()
export class PublicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly coverService: CoverService,
  ) {}

  async findOne(projectId: string): Promise<PublicationDetailDto> {
    await findActiveOrFail(this.prisma, projectId);

    const publication = await this.prisma.publication.findUnique({
      where: { projectId },
      select: publicationDetailSelect,
    });

    if (!publication) {
      throw new NotFoundException('Project has no publication');
    }

    return publication;
  }

  async create(
    projectId: string,
    dto: CreatePublicationDto,
    userId: string,
  ): Promise<PublicationDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const project = await findActiveOrFail(tx, projectId);

      const existing = await tx.publication.findUnique({
        where: { projectId },
        select: { id: true },
      });

      if (existing) {
        throw new ConflictException('Project already has a publication');
      }

      return this.createInTx(tx, projectId, project.title, dto, userId);
    });
  }

  // Also called by ProjectsService.create inside its own transaction (with
  // only `type`), so a project and its seeded publication are created
  // atomically.
  async createInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    projectTitle: string,
    dto: CreatePublicationDto,
    userId: string,
  ): Promise<PublicationDetailDto> {
    const { type, ...fields } = dto;
    const presentFields = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ) as Partial<CreatePublicationDto>;

    const publication = await tx.publication.create({
      data: {
        ...presentFields,
        projectId,
        type,
        // Publication slugs live in their own unique namespace, so this is
        // resolved against publications, not against portfolio slugs.
        slug: await this.uniquePublicationSlug(tx, slugify(projectTitle)),
        updatedById: userId,
      },
      select: publicationDetailSelect,
    });

    await logActivity(tx, {
      actorId: userId,
      action: 'publication.create',
      entityType: 'publication',
      entityId: publication.id,
      projectId,
    });

    return publication;
  }

  async update(
    projectId: string,
    dto: UpsertPublicationDto,
    userId: string,
  ): Promise<PublicationDetailDto> {
    const { publication, staleStorageKeys } = await this.prisma.$transaction(
      async (tx) => {
        await findActiveOrFail(tx, projectId);

        const existing = await tx.publication.findUnique({
          where: { projectId },
          select: publicationDetailSelect,
        });

        if (!existing) {
          throw new NotFoundException('Project has no publication');
        }

        const isTypeChanging =
          dto.type !== undefined && dto.type !== existing.type;

        const staleStorageKeys: string[] = [];
        const typeTransitionData: Prisma.PublicationUncheckedUpdateInput = {};
        // Counts of what the type change removed, for the activity metadata.
        const deletedCounts: Record<string, number> = {};

        if (isTypeChanging) {
          if (existing.type === PublicationType.SALE) {
            typeTransitionData.price = null;
            typeTransitionData.quantity = null;
            typeTransitionData.sku = null;
            typeTransitionData.compareAtPrice = null;
          } else if (existing.type === PublicationType.LINK) {
            typeTransitionData.externalUrl = null;
          } else if (existing.type === PublicationType.DOI) {
            // Every PUBLICATION PDF goes, attached to a section or not: PDFs
            // only exist for DOI sections, so none has a use after this.
            const pdfs = await tx.projectMedia.findMany({
              where: {
                projectId,
                scope: MediaScope.PUBLICATION,
                type: MediaType.PDF,
              },
              select: { storageKey: true },
            });

            // Sections first: they reference their PDF with a RESTRICT FK.
            const { count: deletedSectionCount } =
              await tx.publicationSection.deleteMany({
                where: { publicationId: existing.id },
              });
            await tx.projectMedia.deleteMany({
              where: {
                projectId,
                scope: MediaScope.PUBLICATION,
                type: MediaType.PDF,
              },
            });

            staleStorageKeys.push(...pdfs.map((pdf) => pdf.storageKey));
            deletedCounts.deletedSectionCount = deletedSectionCount;
            deletedCounts.deletedPdfCount = pdfs.length;
          }

          if (dto.type === PublicationType.DOI) {
            // A DOI publication shows sections instead of a gallery. Gallery
            // images are the ones with a displayOrder; covers (null) stay.
            const galleryWhere = {
              projectId,
              scope: MediaScope.PUBLICATION,
              type: MediaType.IMAGE,
              displayOrder: { not: null },
            } satisfies Prisma.ProjectMediaWhereInput;

            const images = await tx.projectMedia.findMany({
              where: galleryWhere,
              select: { storageKey: true },
            });

            await tx.projectMedia.deleteMany({ where: galleryWhere });

            staleStorageKeys.push(...images.map((image) => image.storageKey));
            deletedCounts.deletedGalleryImageCount = images.length;
          }
        }

        const presentFields = Object.fromEntries(
          Object.entries(dto).filter(([, value]) => value !== undefined),
        ) as Partial<UpsertPublicationDto>;

        const data = { ...typeTransitionData, ...presentFields };
        const fields = changedFields(existing, data);

        // A body that changes nothing is not a write: no updatedAt/updatedById
        // bump and no log row. A type change always lands in `fields`.
        if (fields.length === 0) {
          return { publication: existing, staleStorageKeys };
        }

        const publication = await tx.publication.update({
          where: { id: existing.id },
          data: { ...data, updatedById: userId },
          select: publicationDetailSelect,
        });

        await logActivity(tx, {
          actorId: userId,
          action: 'publication.update',
          entityType: 'publication',
          entityId: existing.id,
          projectId,
          metadata: isTypeChanging
            ? {
                fields,
                typeFrom: existing.type,
                typeTo: dto.type,
                ...deletedCounts,
              }
            : { fields },
        });

        return { publication, staleStorageKeys };
      },
    );

    await Promise.all(
      staleStorageKeys.map((storageKey) =>
        deleteStorageObjectSilently(this.storageService, storageKey),
      ),
    );

    return publication;
  }

  async remove(projectId: string, userId: string): Promise<void> {
    const staleStorageKeys = await this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const publication = await tx.publication.findUnique({
        where: { projectId },
        select: { id: true },
      });

      if (!publication) {
        throw new NotFoundException('Project has no publication to delete');
      }

      const media = await tx.projectMedia.findMany({
        where: { projectId, scope: MediaScope.PUBLICATION },
        select: { storageKey: true },
      });

      // Sections reference their PDF with a RESTRICT foreign key, so they have
      // to go before the media rows they point at.
      await tx.publicationSection.deleteMany({
        where: { publicationId: publication.id },
      });

      // Released before the media rows go, so the cover FK never dangles.
      await tx.publication.update({
        where: { id: publication.id },
        data: { coverMediaId: null },
      });

      await tx.projectMedia.deleteMany({
        where: { projectId, scope: MediaScope.PUBLICATION },
      });

      await tx.publication.delete({ where: { id: publication.id } });

      await logActivity(tx, {
        actorId: userId,
        action: 'publication.delete',
        entityType: 'publication',
        entityId: publication.id,
        projectId,
        metadata: { deletedMediaCount: media.length },
      });

      return media.map((item) => item.storageKey);
    });

    // Storage cleanup runs after the transaction commits: a failed delete here
    // only leaves an orphaned object, which is harmless.
    await Promise.all(
      staleStorageKeys.map((storageKey) =>
        deleteStorageObjectSilently(this.storageService, storageKey),
      ),
    );
  }

  // Part of the project soft delete, run inside ProjectsService.remove's
  // transaction before the project's media rows are deleted.
  async cleanupForProjectDeleteInTx(
    tx: Prisma.TransactionClient,
    publication: { id: string; slug: string },
    slugSuffix: string,
    userId: string,
  ): Promise<void> {
    // Sections reference their PDF with a RESTRICT foreign key, so they
    // have to go before the media rows they point at.
    await tx.publicationSection.deleteMany({
      where: { publicationId: publication.id },
    });

    await tx.publication.update({
      where: { id: publication.id },
      data: {
        slug: `${publication.slug}-${slugSuffix}`,
        coverMediaId: null,
        isPublished: false,
        publishedAt: null,
        updatedById: userId,
      },
    });
  }

  async findCover(projectId: string): Promise<CoverResponseDto> {
    return this.coverService.findCover(projectId, PUBLICATION_COVER);
  }

  async createCover(
    projectId: string,
    dto: CreateCoverDto,
  ): Promise<CreateMediaResult> {
    return this.coverService.createCover(projectId, PUBLICATION_COVER, dto);
  }

  async confirmCover(
    projectId: string,
    mediaId: string,
    userId: string,
  ): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.coverService.confirmCoverInTx(
        tx,
        projectId,
        PUBLICATION_COVER,
        mediaId,
        userId,
      );

      return loadProjectDetailOrFail(tx, projectId);
    });
  }

  async findAll(
    query: FindPublicationsQueryDto,
  ): Promise<PublicationListResponseDto> {
    const where: Prisma.PublicationWhereInput = { ...activePublicationWhere };

    if (query.type) {
      where.type = query.type;
    }
    if (query.status) {
      where.isPublished = query.status === 'published';
    }

    // Two queries regardless of list size: cover and sections count come
    // embedded in the list query, and every count comes from one groupBy
    // that ignores the filters.
    const [publications, groups] = await Promise.all([
      this.prisma.publication.findMany({
        where,
        select: {
          id: true,
          projectId: true,
          slug: true,
          type: true,
          isPublished: true,
          price: true,
          currency: true,
          quantity: true,
          externalUrl: true,
          updatedAt: true,
          coverMedia: { select: coverItemSelect },
          project: { select: { title: true, subtitle: true } },
          _count: { select: { sections: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.publication.groupBy({
        by: ['type', 'isPublished'],
        where: activePublicationWhere,
        _count: { _all: true },
      }),
    ]);

    const byType: Record<PublicationType, number> = {
      SALE: 0,
      LINK: 0,
      DOI: 0,
    };
    let published = 0;

    for (const group of groups) {
      byType[group.type] += group._count._all;
      if (group.isPublished) {
        published += group._count._all;
      }
    }

    return {
      items: publications.map(
        ({ coverMedia, project, _count, ...publication }) => ({
          id: publication.id,
          projectId: publication.projectId,
          title: project.title,
          subtitle: project.subtitle,
          slug: publication.slug,
          type: publication.type,
          isPublished: publication.isPublished,
          price: publication.price,
          currency: publication.currency,
          quantity: publication.quantity,
          externalUrl: publication.externalUrl,
          cover: toCoverItem(this.storageService, coverMedia),
          sectionsCount: _count.sections,
          updatedAt: publication.updatedAt,
        }),
      ),
      counts: {
        total: byType.SALE + byType.LINK + byType.DOI,
        published,
        byType,
      },
    };
  }

  private uniquePublicationSlug(
    client: PrismaClientLike,
    base: string,
  ): Promise<string> {
    return uniqueSlug(base, async (slug) =>
      Boolean(
        await client.publication.findUnique({
          where: { slug },
          select: { id: true },
        }),
      ),
    );
  }
}

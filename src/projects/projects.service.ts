import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { MediaScope, PublicationType } from '../../generated/prisma/enums';
import {
  EXTENSION_BY_MEDIA_TYPE,
  MAX_SIZE_BY_MEDIA_TYPE,
  MIME_TYPE_BY_MEDIA_TYPE,
  UPLOAD_URL_EXPIRES_IN_SECONDS,
} from '../media/media.service';
import type { CreateMediaResult } from '../media/media.service';
import { changedFields } from '../activity-log/changed-fields.util';
import {
  logActivity,
  type ActivityAction,
} from '../activity-log/log-activity.util';
import { PrismaService } from '../prisma/prisma.service';
import { deleteStorageObjectSilently } from '../storage/delete-storage-object-silently.util';
import { buildStorageKey } from '../storage/storage-key.util';
import { StorageService } from '../storage/storage.service';
import type { CreateCoverDto } from './dto/create-cover.dto';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { CreatePublicationDto } from './dto/create-publication.dto';
import type { FindProjectsQueryDto } from './dto/find-projects-query.dto';
import type { PortfolioDetailDto } from './dto/portfolio-detail.dto';
import type { ProjectDetailDto } from './dto/project-detail.dto';
import type { ProjectListItemDto } from './dto/project-list-item.dto';
import type { PublicationDetailDto } from './dto/publication-detail.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import type { UpsertPortfolioDto } from './dto/upsert-portfolio.dto';
import type { UpsertPublicationDto } from './dto/upsert-publication.dto';
import {
  findActiveOrFail,
  type PrismaClientLike,
} from './project-existence.util';
import { slugify } from './utils/slugify.util';

// Mirrors the schema default for SiteSettings.portfolioMaxItems, used when the
// singleton settings row has not been created yet.
const DEFAULT_PORTFOLIO_MAX_ITEMS = 10;

const SITE_SETTINGS_ID = 1;

// Exact pixel size a portfolio cover must have (3:4 portrait).
export const PORTFOLIO_COVER_WIDTH = 1200;
export const PORTFOLIO_COVER_HEIGHT = 1600;

// Exact pixel size a publication cover must have (square).
export const PUBLICATION_COVER_WIDTH = 1600;
export const PUBLICATION_COVER_HEIGHT = 1600;

export type CoverFacet = 'portfolio' | 'publication';

interface CoverFacetConfig {
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

// Everything that differs between the two cover flows. The rules themselves
// live once, in createCover/confirmCover.
const COVER_FACETS: Record<CoverFacet, CoverFacetConfig> = {
  portfolio: {
    scope: MediaScope.PORTFOLIO,
    width: PORTFOLIO_COVER_WIDTH,
    height: PORTFOLIO_COVER_HEIGHT,
    action: 'portfolio.cover_set',
    findByProject: (client, projectId) =>
      client.portfolio.findUnique({
        where: { projectId },
        select: { id: true, coverMediaId: true },
      }),
    setCover: (tx, facetId, mediaId, userId) =>
      tx.portfolio.updateMany({
        where: { id: facetId, coverMediaId: null },
        data: { coverMediaId: mediaId, updatedById: userId },
      }),
  },
  publication: {
    scope: MediaScope.PUBLICATION,
    width: PUBLICATION_COVER_WIDTH,
    height: PUBLICATION_COVER_HEIGHT,
    action: 'publication.cover_set',
    findByProject: (client, projectId) =>
      client.publication.findUnique({
        where: { projectId },
        select: { id: true, coverMediaId: true },
      }),
    setCover: (tx, facetId, mediaId, userId) =>
      tx.publication.updateMany({
        where: { id: facetId, coverMediaId: null },
        data: { coverMediaId: mediaId, updatedById: userId },
      }),
  },
};

const projectDetailSelect = {
  id: true,
  title: true,
  subtitle: true,
  description: true,
  client: true,
  issueYear: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  portfolio: {
    select: {
      id: true,
      slug: true,
      coverMediaId: true,
      isPublished: true,
      displayOrder: true,
      publishedAt: true,
    },
  },
  publication: {
    select: { id: true, slug: true, type: true, isPublished: true },
  },
  production: {
    select: { id: true, publicCode: true },
  },
} satisfies Prisma.ProjectSelect;

type ProjectDetailRow = Prisma.ProjectGetPayload<{
  select: typeof projectDetailSelect;
}>;

// Shape returned by the portfolio facet endpoints (GET/POST/PUT), mirroring
// what publicationDetailSelect does for the publication facet.
const portfolioDetailSelect = {
  id: true,
  slug: true,
  coverMediaId: true,
  isPublished: true,
  displayOrder: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PortfolioSelect;

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
  compareAtPrice: true,
  currency: true,
  externalUrl: true,
  isPublished: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PublicationSelect;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async create(
    dto: CreateProjectDto,
    userId: string,
  ): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          title: dto.title,
          subtitle: dto.subtitle,
          description: dto.description,
          client: dto.client,
          issueYear: dto.issueYear,
          tags: dto.tags ?? [],
          createdById: userId,
          updatedById: userId,
        },
        select: { id: true },
      });

      await logActivity(tx, {
        actorId: userId,
        action: 'project.create',
        entityType: 'project',
        entityId: project.id,
        projectId: project.id,
      });

      if (dto.portfolio) {
        const portfolio = await tx.portfolio.create({
          data: {
            projectId: project.id,
            slug: await this.uniquePortfolioSlug(tx, slugify(dto.title)),
            updatedById: userId,
          },
          select: { id: true },
        });

        await logActivity(tx, {
          actorId: userId,
          action: 'portfolio.create',
          entityType: 'portfolio',
          entityId: portfolio.id,
          projectId: project.id,
        });
      }

      if (dto.publication) {
        const publication = await tx.publication.create({
          data: {
            projectId: project.id,
            type: dto.publication.type,
            // Publication slugs live in their own unique namespace, so this is
            // resolved against publications, not against portfolio slugs.
            slug: await this.uniquePublicationSlug(tx, slugify(dto.title)),
            updatedById: userId,
          },
          select: { id: true },
        });

        await logActivity(tx, {
          actorId: userId,
          action: 'publication.create',
          entityType: 'publication',
          entityId: publication.id,
          projectId: project.id,
        });
      }

      return this.loadDetailOrFail(tx, project.id);
    });
  }

  async findAll(
    filters: FindProjectsQueryDto = {},
  ): Promise<ProjectListItemDto[]> {
    const where: Prisma.ProjectWhereInput = { deletedAt: null };

    if (filters.hasPortfolio !== undefined) {
      where.portfolio = filters.hasPortfolio ? { isNot: null } : null;
    }
    if (filters.hasPublication !== undefined) {
      where.publication = filters.hasPublication ? { isNot: null } : null;
    }
    if (filters.hasProduction !== undefined) {
      where.production = filters.hasProduction ? { isNot: null } : null;
    }

    const projects = await this.prisma.project.findMany({
      where,
      select: {
        id: true,
        title: true,
        client: true,
        issueYear: true,
        createdAt: true,
        portfolio: { select: { isPublished: true } },
        publication: { select: { id: true } },
        production: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return projects.map((project) => ({
      id: project.id,
      title: project.title,
      client: project.client,
      issueYear: project.issueYear,
      createdAt: project.createdAt,
      isPublished: project.portfolio?.isPublished ?? false,
      hasPortfolio: project.portfolio !== null,
      hasPublication: project.publication !== null,
      hasProduction: project.production !== null,
    }));
  }

  async findOne(id: string): Promise<ProjectDetailDto> {
    return this.loadDetailOrFail(this.prisma, id);
  }

  async findPublication(projectId: string): Promise<PublicationDetailDto> {
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

  async update(
    id: string,
    dto: UpdateProjectDto,
    userId: string,
  ): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.project.findFirst({
        where: { id, deletedAt: null },
        select: {
          title: true,
          subtitle: true,
          description: true,
          client: true,
          issueYear: true,
          tags: true,
        },
      });

      if (!current) {
        throw new NotFoundException('Project not found');
      }

      const data = {
        title: dto.title,
        subtitle: dto.subtitle,
        description: dto.description,
        client: dto.client,
        issueYear: dto.issueYear,
        tags: dto.tags,
      };
      const fields = changedFields(current, data);

      // A body that changes nothing is not a write: no updatedAt/updatedById
      // bump and no log row.
      if (fields.length > 0) {
        await tx.project.update({
          where: { id },
          data: { ...data, updatedById: userId },
        });

        await logActivity(tx, {
          actorId: userId,
          action: 'project.update',
          entityType: 'project',
          entityId: id,
          projectId: id,
          metadata: { fields },
        });
      }

      return this.loadDetailOrFail(tx, id);
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const staleStorageKeys = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          portfolio: { select: { id: true, slug: true } },
          publication: { select: { id: true, slug: true } },
        },
      });

      if (!project) {
        throw new NotFoundException('Project not found');
      }

      const media = await tx.projectMedia.findMany({
        where: { projectId: id },
        select: { storageKey: true },
      });

      const suffix = `deleted-${id.slice(0, 8)}`;

      if (project.portfolio) {
        await tx.portfolio.update({
          where: { id: project.portfolio.id },
          data: {
            slug: `${project.portfolio.slug}-${suffix}`,
            // Released before the media rows go, so the cover FK never dangles.
            coverMediaId: null,
            // Also released from the published set, otherwise a deleted project
            // would keep occupying a slot against portfolioMaxItems forever.
            isPublished: false,
            publishedAt: null,
            displayOrder: null,
            updatedById: userId,
          },
        });
      }

      if (project.publication) {
        // Sections reference their PDF with a RESTRICT foreign key, so they
        // have to go before the media rows they point at.
        await tx.publicationSection.deleteMany({
          where: { publicationId: project.publication.id },
        });

        await tx.publication.update({
          where: { id: project.publication.id },
          data: {
            slug: `${project.publication.slug}-${suffix}`,
            coverMediaId: null,
            isPublished: false,
            publishedAt: null,
            updatedById: userId,
          },
        });
      }

      // Every scope goes: a soft-deleted project has no use for its files, and
      // leaving them would keep paying for storage nobody can reach.
      await tx.projectMedia.deleteMany({ where: { projectId: id } });

      await tx.project.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: userId },
      });

      await logActivity(tx, {
        actorId: userId,
        action: 'project.delete',
        entityType: 'project',
        entityId: id,
        projectId: id,
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

  async findPortfolio(projectId: string): Promise<PortfolioDetailDto> {
    await findActiveOrFail(this.prisma, projectId);

    const portfolio = await this.prisma.portfolio.findUnique({
      where: { projectId },
      select: portfolioDetailSelect,
    });

    if (!portfolio) {
      throw new NotFoundException('Project has no portfolio');
    }

    return portfolio;
  }

  async createPortfolio(
    projectId: string,
    userId: string,
  ): Promise<PortfolioDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const project = await findActiveOrFail(tx, projectId);

      const existing = await tx.portfolio.findUnique({
        where: { projectId },
        select: { id: true },
      });

      if (existing) {
        throw new ConflictException('Project already has a portfolio');
      }

      const portfolio = await tx.portfolio.create({
        data: {
          projectId,
          slug: await this.uniquePortfolioSlug(tx, slugify(project.title)),
          updatedById: userId,
        },
        select: portfolioDetailSelect,
      });

      await logActivity(tx, {
        actorId: userId,
        action: 'portfolio.create',
        entityType: 'portfolio',
        entityId: portfolio.id,
        projectId,
      });

      return portfolio;
    });
  }

  async updatePortfolio(
    projectId: string,
    dto: UpsertPortfolioDto,
    userId: string,
  ): Promise<PortfolioDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const portfolio = await tx.portfolio.findUnique({
        where: { projectId },
        select: portfolioDetailSelect,
      });

      if (!portfolio) {
        throw new NotFoundException('Project has no portfolio');
      }

      const data = { displayOrder: dto.displayOrder };
      const fields = changedFields(portfolio, data);

      // Nothing to write is not an error: return the facet untouched rather
      // than bumping updatedAt for a body that changes nothing.
      if (fields.length === 0) {
        return portfolio;
      }

      const updated = await tx.portfolio.update({
        where: { id: portfolio.id },
        data: { ...data, updatedById: userId },
        select: portfolioDetailSelect,
      });

      await logActivity(tx, {
        actorId: userId,
        action: 'portfolio.update',
        entityType: 'portfolio',
        entityId: portfolio.id,
        projectId,
        metadata: { fields },
      });

      return updated;
    });
  }

  async deletePortfolio(projectId: string, userId: string): Promise<void> {
    const staleStorageKeys = await this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const portfolio = await tx.portfolio.findUnique({
        where: { projectId },
        select: { id: true },
      });

      if (!portfolio) {
        throw new NotFoundException('Project has no portfolio to delete');
      }

      const media = await tx.projectMedia.findMany({
        where: { projectId, scope: MediaScope.PORTFOLIO },
        select: { id: true, storageKey: true },
      });

      // Released before the media rows go, so the cover FK never dangles.
      await tx.portfolio.update({
        where: { id: portfolio.id },
        data: { coverMediaId: null },
      });

      await tx.projectMedia.deleteMany({
        where: { projectId, scope: MediaScope.PORTFOLIO },
      });

      await tx.portfolio.delete({ where: { id: portfolio.id } });

      await logActivity(tx, {
        actorId: userId,
        action: 'portfolio.delete',
        entityType: 'portfolio',
        entityId: portfolio.id,
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

  async createCover(
    projectId: string,
    facet: CoverFacet,
    dto: CreateCoverDto,
  ): Promise<CreateMediaResult> {
    const config = COVER_FACETS[facet];

    await findActiveOrFail(this.prisma, projectId);

    const target = await config.findByProject(this.prisma, projectId);

    if (!target) {
      throw new NotFoundException(`Project has no ${facet} to set a cover for`);
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

  async confirmCover(
    projectId: string,
    facet: CoverFacet,
    mediaId: string,
    userId: string,
  ): Promise<ProjectDetailDto> {
    const config = COVER_FACETS[facet];

    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const target = await config.findByProject(tx, projectId);

      if (!target) {
        throw new NotFoundException(
          `Project has no ${facet} to set a cover for`,
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
          `Media is not eligible as a ${facet} cover`,
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
        entityType: facet,
        entityId: target.id,
        projectId,
        metadata: { mediaId: media.id },
      });

      return this.loadDetailOrFail(tx, projectId);
    });
  }

  async publishPortfolio(
    projectId: string,
    userId: string,
  ): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const portfolio = await tx.portfolio.findUnique({
        where: { projectId },
        select: { id: true, isPublished: true },
      });

      if (!portfolio) {
        throw new NotFoundException('Project has no portfolio to publish');
      }

      const settings = await tx.siteSettings.findUnique({
        where: { id: SITE_SETTINGS_ID },
        select: { portfolioMaxItems: true },
      });
      const maxItems =
        settings?.portfolioMaxItems ?? DEFAULT_PORTFOLIO_MAX_ITEMS;

      const currentCount = await tx.portfolio.count({
        where: { isPublished: true },
      });

      // An already published portfolio occupies one of those slots, so
      // re-publishing it must not be rejected by the limit.
      if (!portfolio.isPublished && currentCount >= maxItems) {
        throw new ConflictException({
          reason: 'PORTFOLIO_LIMIT_REACHED',
          maxItems,
          currentCount,
        });
      }

      const { _max } = await tx.portfolio.aggregate({
        _max: { displayOrder: true },
      });

      await tx.portfolio.update({
        where: { id: portfolio.id },
        data: {
          isPublished: true,
          publishedAt: new Date(),
          displayOrder: (_max.displayOrder ?? 0) + 1,
          updatedById: userId,
        },
      });

      await logActivity(tx, {
        actorId: userId,
        action: 'portfolio.publish',
        entityType: 'portfolio',
        entityId: portfolio.id,
        projectId,
      });

      return this.loadDetailOrFail(tx, projectId);
    });
  }

  async unpublishPortfolio(
    projectId: string,
    userId: string,
  ): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const portfolio = await tx.portfolio.findUnique({
        where: { projectId },
        select: { id: true },
      });

      if (!portfolio) {
        throw new NotFoundException('Project has no portfolio to unpublish');
      }

      await tx.portfolio.update({
        where: { id: portfolio.id },
        data: {
          isPublished: false,
          publishedAt: null,
          displayOrder: null,
          updatedById: userId,
        },
      });

      await logActivity(tx, {
        actorId: userId,
        action: 'portfolio.unpublish',
        entityType: 'portfolio',
        entityId: portfolio.id,
        projectId,
      });

      return this.loadDetailOrFail(tx, projectId);
    });
  }

  async createPublication(
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
          slug: await this.uniquePublicationSlug(tx, slugify(project.title)),
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
    });
  }

  async updatePublication(
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

        if (isTypeChanging) {
          if (existing.type === PublicationType.SALE) {
            typeTransitionData.price = null;
            typeTransitionData.quantity = null;
            typeTransitionData.sku = null;
            typeTransitionData.compareAtPrice = null;
          } else if (existing.type === PublicationType.LINK) {
            typeTransitionData.externalUrl = null;
          } else if (existing.type === PublicationType.DOI) {
            const sections = await tx.publicationSection.findMany({
              where: { publicationId: existing.id },
              select: {
                pdfMediaId: true,
                pdfMedia: { select: { storageKey: true } },
              },
            });

            if (sections.length > 0) {
              await tx.publicationSection.deleteMany({
                where: { publicationId: existing.id },
              });
              await tx.projectMedia.deleteMany({
                where: {
                  id: { in: sections.map((section) => section.pdfMediaId) },
                },
              });
              staleStorageKeys.push(
                ...sections.map((section) => section.pdfMedia.storageKey),
              );
            }
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
            ? { fields, typeFrom: existing.type, typeTo: dto.type }
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

  async deletePublication(projectId: string, userId: string): Promise<void> {
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

  private async loadDetailOrFail(
    client: PrismaClientLike,
    id: string,
  ): Promise<ProjectDetailDto> {
    const project = await client.project.findFirst({
      where: { id, deletedAt: null },
      select: projectDetailSelect,
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return this.toDetailDto(project);
  }

  private toDetailDto(project: ProjectDetailRow): ProjectDetailDto {
    return {
      id: project.id,
      title: project.title,
      subtitle: project.subtitle,
      description: project.description,
      client: project.client,
      issueYear: project.issueYear,
      tags: project.tags,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      portfolio: project.portfolio
        ? {
            id: project.portfolio.id,
            slug: project.portfolio.slug,
            coverMediaId: project.portfolio.coverMediaId,
            isPublished: project.portfolio.isPublished,
            displayOrder: project.portfolio.displayOrder,
            publishedAt: project.portfolio.publishedAt,
          }
        : null,
      publication: project.publication
        ? {
            id: project.publication.id,
            slug: project.publication.slug,
            type: project.publication.type,
            isPublished: project.publication.isPublished,
          }
        : null,
      production: project.production
        ? {
            id: project.production.id,
            publicCode: project.production.publicCode,
          }
        : null,
    };
  }

  private uniquePortfolioSlug(
    client: PrismaClientLike,
    base: string,
  ): Promise<string> {
    return this.uniqueSlug(base, async (slug) =>
      Boolean(
        await client.portfolio.findUnique({
          where: { slug },
          select: { id: true },
        }),
      ),
    );
  }

  private uniquePublicationSlug(
    client: PrismaClientLike,
    base: string,
  ): Promise<string> {
    return this.uniqueSlug(base, async (slug) =>
      Boolean(
        await client.publication.findUnique({
          where: { slug },
          select: { id: true },
        }),
      ),
    );
  }

  private async uniqueSlug(
    base: string,
    isTaken: (slug: string) => Promise<boolean>,
  ): Promise<string> {
    // slugify() returns '' for titles with no alphanumeric characters.
    const root = base || 'project';
    let candidate = root;
    let suffix = 1;

    while (await isTaken(candidate)) {
      suffix += 1;
      candidate = `${root}-${suffix}`;
    }

    return candidate;
  }
}

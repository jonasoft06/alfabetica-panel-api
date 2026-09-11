import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PublicationType } from '../../generated/prisma/enums';
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
import type { ConfirmPortfolioCoverDto } from './dto/confirm-portfolio-cover.dto';
import type { CreatePortfolioCoverDto } from './dto/create-portfolio-cover.dto';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { FindProjectsQueryDto } from './dto/find-projects-query.dto';
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
        },
        select: { id: true },
      });

      if (dto.portfolio) {
        await tx.projectPortfolio.create({
          data: {
            projectId: project.id,
            slug: await this.uniquePortfolioSlug(tx, slugify(dto.title)),
          },
        });
      }

      if (dto.publication) {
        await tx.publication.create({
          data: {
            projectId: project.id,
            type: dto.publication.type,
            // Publication slugs live in their own unique namespace, so this is
            // resolved against publications, not against portfolio slugs.
            slug: await this.uniquePublicationSlug(tx, slugify(dto.title)),
          },
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
      select: {
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
      },
    });

    if (!publication) {
      throw new NotFoundException('Project has no publication');
    }

    return publication;
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectDetailDto> {
    await findActiveOrFail(this.prisma, id);

    await this.prisma.project.update({
      where: { id },
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        description: dto.description,
        client: dto.client,
        issueYear: dto.issueYear,
        tags: dto.tags,
      },
    });

    return this.loadDetailOrFail(this.prisma, id);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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

      await tx.project.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      const suffix = `deleted-${id.slice(0, 8)}`;

      if (project.portfolio) {
        await tx.projectPortfolio.update({
          where: { id: project.portfolio.id },
          data: {
            slug: `${project.portfolio.slug}-${suffix}`,
            // Also released from the published set, otherwise a deleted project
            // would keep occupying a slot against portfolioMaxItems forever.
            isPublished: false,
            publishedAt: null,
            displayOrder: null,
          },
        });
      }

      if (project.publication) {
        await tx.publication.update({
          where: { id: project.publication.id },
          data: {
            slug: `${project.publication.slug}-${suffix}`,
            isPublished: false,
            publishedAt: null,
          },
        });
      }
    });
  }

  async upsertPortfolio(
    projectId: string,
    dto: UpsertPortfolioDto,
  ): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const project = await findActiveOrFail(tx, projectId);

      const slug =
        dto.slug ??
        (await this.uniquePortfolioSlug(tx, slugify(project.title)));

      await tx.projectPortfolio.upsert({
        where: { projectId },
        create: {
          projectId,
          slug,
        },
        update: {
          slug: dto.slug,
        },
      });

      return this.loadDetailOrFail(tx, projectId);
    });
  }

  async createPortfolioCover(
    projectId: string,
    dto: CreatePortfolioCoverDto,
  ): Promise<CreateMediaResult> {
    await findActiveOrFail(this.prisma, projectId);

    const portfolio = await this.prisma.projectPortfolio.findUnique({
      where: { projectId },
      select: { coverMediaId: true },
    });

    if (!portfolio) {
      throw new NotFoundException(
        'Project has no portfolio to set a cover for',
      );
    }

    if (portfolio.coverMediaId) {
      throw new ConflictException({ reason: 'COVER_ALREADY_EXISTS' });
    }

    if (dto.mimeType !== MIME_TYPE_BY_MEDIA_TYPE.IMAGE) {
      throw new BadRequestException('Mime type does not match media type');
    }

    if (dto.sizeBytes > MAX_SIZE_BY_MEDIA_TYPE.IMAGE) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }

    const mediaId = randomUUID();
    const storageKey = buildStorageKey({
      scope: 'PORTFOLIO',
      projectId,
      mediaId,
      extension: EXTENSION_BY_MEDIA_TYPE.IMAGE,
    });

    await this.prisma.projectMedia.create({
      data: {
        id: mediaId,
        projectId,
        scope: 'PORTFOLIO',
        type: 'IMAGE',
        storageKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        alt: dto.alt,
        caption: dto.caption,
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
    };
  }

  async confirmPortfolioCover(
    projectId: string,
    dto: ConfirmPortfolioCoverDto,
  ): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const portfolio = await tx.projectPortfolio.findUnique({
        where: { projectId },
        select: { id: true, coverMediaId: true },
      });

      if (!portfolio) {
        throw new NotFoundException(
          'Project has no portfolio to set a cover for',
        );
      }

      if (portfolio.coverMediaId) {
        throw new ConflictException({ reason: 'COVER_ALREADY_EXISTS' });
      }

      const media = await tx.projectMedia.findUnique({
        where: { id: dto.mediaId },
        select: {
          id: true,
          projectId: true,
          scope: true,
          type: true,
          status: true,
        },
      });

      if (!media || media.projectId !== projectId) {
        throw new NotFoundException('Cover media not found for this project');
      }

      if (media.scope !== 'PORTFOLIO' || media.type !== 'IMAGE') {
        throw new BadRequestException(
          'Media is not eligible as a portfolio cover',
        );
      }

      if (media.status !== 'PENDING') {
        throw new ConflictException('Media is not pending confirmation');
      }

      await tx.projectMedia.update({
        where: { id: media.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });

      await tx.projectPortfolio.update({
        where: { id: portfolio.id },
        data: { coverMediaId: media.id },
      });

      return this.loadDetailOrFail(tx, projectId);
    });
  }

  async publishPortfolio(projectId: string): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const portfolio = await tx.projectPortfolio.findUnique({
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

      const currentCount = await tx.projectPortfolio.count({
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

      const { _max } = await tx.projectPortfolio.aggregate({
        _max: { displayOrder: true },
      });

      await tx.projectPortfolio.update({
        where: { id: portfolio.id },
        data: {
          isPublished: true,
          publishedAt: new Date(),
          displayOrder: (_max.displayOrder ?? 0) + 1,
        },
      });

      return this.loadDetailOrFail(tx, projectId);
    });
  }

  async unpublishPortfolio(projectId: string): Promise<ProjectDetailDto> {
    await findActiveOrFail(this.prisma, projectId);

    const portfolio = await this.prisma.projectPortfolio.findUnique({
      where: { projectId },
      select: { id: true },
    });

    if (!portfolio) {
      throw new NotFoundException('Project has no portfolio to unpublish');
    }

    await this.prisma.projectPortfolio.update({
      where: { id: portfolio.id },
      data: { isPublished: false, publishedAt: null, displayOrder: null },
    });

    return this.loadDetailOrFail(this.prisma, projectId);
  }

  async upsertPublication(
    projectId: string,
    dto: UpsertPublicationDto,
  ): Promise<ProjectDetailDto> {
    const staleStorageKeys = await this.prisma.$transaction(async (tx) => {
      const project = await findActiveOrFail(tx, projectId);

      const existing = await tx.publication.findUnique({
        where: { projectId },
        select: { id: true, type: true },
      });

      const resolvedType = dto.type ?? existing?.type;
      if (resolvedType === undefined) {
        throw new BadRequestException(
          'type is required to create a publication',
        );
      }

      const isTypeChanging =
        existing !== null &&
        dto.type !== undefined &&
        dto.type !== existing.type;

      const staleStorageKeys: string[] = [];
      const typeTransitionData: Prisma.PublicationUpdateInput = {};

      if (isTypeChanging && existing) {
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

      if (existing) {
        await tx.publication.update({
          where: { id: existing.id },
          data: { ...typeTransitionData, ...presentFields },
        });
      } else {
        const slug = await this.uniquePublicationSlug(
          tx,
          slugify(project.title),
        );

        await tx.publication.create({
          data: { ...presentFields, projectId, slug, type: resolvedType },
        });
      }

      return staleStorageKeys;
    });

    await Promise.all(
      staleStorageKeys.map((storageKey) =>
        deleteStorageObjectSilently(this.storageService, storageKey),
      ),
    );

    return this.loadDetailOrFail(this.prisma, projectId);
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
        await client.projectPortfolio.findUnique({
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

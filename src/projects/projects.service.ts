import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { ProjectDetailDto } from './dto/project-detail.dto';
import type { ProjectListItemDto } from './dto/project-list-item.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import type { UpsertPortfolioDto } from './dto/upsert-portfolio.dto';
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
      coverUrl: true,
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

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findAll(): Promise<ProjectListItemDto[]> {
    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        title: true,
        client: true,
        issueYear: true,
        createdAt: true,
        portfolio: { select: { isPublished: true } },
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
    }));
  }

  async findOne(id: string): Promise<ProjectDetailDto> {
    return this.loadDetailOrFail(this.prisma, id);
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectDetailDto> {
    await this.findActiveOrFail(this.prisma, id);

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
      const project = await this.findActiveOrFail(tx, projectId);

      const slug =
        dto.slug ??
        (await this.uniquePortfolioSlug(tx, slugify(project.title)));

      await tx.projectPortfolio.upsert({
        where: { projectId },
        create: {
          projectId,
          slug,
          coverUrl: dto.coverUrl,
          coverStorageKey: dto.coverStorageKey,
        },
        update: {
          slug: dto.slug,
          coverUrl: dto.coverUrl,
          coverStorageKey: dto.coverStorageKey,
        },
      });

      return this.loadDetailOrFail(tx, projectId);
    });
  }

  async publishPortfolio(projectId: string): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.findActiveOrFail(tx, projectId);

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
    await this.findActiveOrFail(this.prisma, projectId);

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

  private async findActiveOrFail(
    client: PrismaClientLike,
    id: string,
  ): Promise<{ id: string; title: string }> {
    const project = await client.project.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, title: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
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
            coverUrl: project.portfolio.coverUrl,
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

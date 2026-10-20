import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { MediaScope, MediaStatus } from '../../generated/prisma/enums';
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
import {
  coverItemSelect,
  galleryMediaWhere,
  toCoverItem,
} from '../media/media-item.mapper';
import type { CreateMediaResult } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { deleteStorageObjectSilently } from '../storage/delete-storage-object-silently.util';
import { StorageService } from '../storage/storage.service';
import type { FindPortfoliosQueryDto } from './dto/find-portfolios-query.dto';
import type { PortfolioDetailDto } from './dto/portfolio-detail.dto';
import type { PortfolioListResponseDto } from './dto/portfolio-list.dto';
import type { UpsertPortfolioDto } from './dto/upsert-portfolio.dto';
import { PORTFOLIO_COVER } from './portfolio-cover.config';
import { findPortfolioMaxItems } from './utils/portfolio-max-items.util';

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

const activePortfolioWhere = {
  project: { deletedAt: null },
} satisfies Prisma.PortfolioWhereInput;

@Injectable()
export class PortfoliosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly coverService: CoverService,
  ) {}

  async findOne(projectId: string): Promise<PortfolioDetailDto> {
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

  async create(projectId: string, userId: string): Promise<PortfolioDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const project = await findActiveOrFail(tx, projectId);

      const existing = await tx.portfolio.findUnique({
        where: { projectId },
        select: { id: true },
      });

      if (existing) {
        throw new ConflictException('Project already has a portfolio');
      }

      return this.createInTx(tx, projectId, project.title, userId);
    });
  }

  // Also called by ProjectsService.create inside its own transaction, so a
  // project and its seeded portfolio are created atomically.
  async createInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    projectTitle: string,
    userId: string,
  ): Promise<PortfolioDetailDto> {
    const portfolio = await tx.portfolio.create({
      data: {
        projectId,
        slug: await this.uniquePortfolioSlug(tx, slugify(projectTitle)),
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
  }

  async update(
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

  async remove(projectId: string, userId: string): Promise<void> {
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

  // Part of the project soft delete, run inside ProjectsService.remove's
  // transaction before the project's media rows are deleted.
  async cleanupForProjectDeleteInTx(
    tx: Prisma.TransactionClient,
    portfolio: { id: string; slug: string },
    slugSuffix: string,
    userId: string,
  ): Promise<void> {
    await tx.portfolio.update({
      where: { id: portfolio.id },
      data: {
        slug: `${portfolio.slug}-${slugSuffix}`,
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

  async findCover(projectId: string): Promise<CoverResponseDto> {
    return this.coverService.findCover(projectId, PORTFOLIO_COVER);
  }

  async createCover(
    projectId: string,
    dto: CreateCoverDto,
  ): Promise<CreateMediaResult> {
    return this.coverService.createCover(projectId, PORTFOLIO_COVER, dto);
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
        PORTFOLIO_COVER,
        mediaId,
        userId,
      );

      return loadProjectDetailOrFail(tx, projectId);
    });
  }

  async publish(projectId: string, userId: string): Promise<ProjectDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await findActiveOrFail(tx, projectId);

      const portfolio = await tx.portfolio.findUnique({
        where: { projectId },
        select: { id: true, isPublished: true },
      });

      if (!portfolio) {
        throw new NotFoundException('Project has no portfolio to publish');
      }

      const maxItems = await findPortfolioMaxItems(tx);

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

      return loadProjectDetailOrFail(tx, projectId);
    });
  }

  async unpublish(
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

      return loadProjectDetailOrFail(tx, projectId);
    });
  }

  async findAll(
    query: FindPortfoliosQueryDto,
  ): Promise<PortfolioListResponseDto> {
    const where: Prisma.PortfolioWhereInput = { ...activePortfolioWhere };

    if (query.status) {
      where.isPublished = query.status === 'published';
    }

    // A fixed number of queries regardless of list size: cover and gallery
    // count come embedded in the list query, and counts ignore the filters.
    const [portfolios, total, published, withoutCover, maxItems] =
      await Promise.all([
        this.prisma.portfolio.findMany({
          where,
          select: {
            id: true,
            projectId: true,
            slug: true,
            isPublished: true,
            displayOrder: true,
            publishedAt: true,
            updatedAt: true,
            coverMedia: { select: coverItemSelect },
            project: {
              select: {
                title: true,
                subtitle: true,
                _count: {
                  select: {
                    media: { where: galleryMediaWhere(MediaScope.PORTFOLIO) },
                  },
                },
              },
            },
          },
          orderBy: [
            { displayOrder: { sort: 'asc', nulls: 'last' } },
            { project: { title: 'asc' } },
          ],
        }),
        this.prisma.portfolio.count({ where: activePortfolioWhere }),
        this.prisma.portfolio.count({
          where: { ...activePortfolioWhere, isPublished: true },
        }),
        // No cover at all, or one still PENDING.
        this.prisma.portfolio.count({
          where: {
            ...activePortfolioWhere,
            NOT: { coverMedia: { is: { status: MediaStatus.CONFIRMED } } },
          },
        }),
        findPortfolioMaxItems(this.prisma),
      ]);

    return {
      items: portfolios.map(({ coverMedia, project, ...portfolio }) => ({
        id: portfolio.id,
        projectId: portfolio.projectId,
        title: project.title,
        subtitle: project.subtitle,
        slug: portfolio.slug,
        isPublished: portfolio.isPublished,
        displayOrder: portfolio.displayOrder,
        publishedAt: portfolio.publishedAt,
        cover: toCoverItem(this.storageService, coverMedia),
        galleryCount: project._count.media,
        updatedAt: portfolio.updatedAt,
      })),
      counts: {
        total,
        published,
        unpublished: total - published,
        withoutCover,
      },
      maxItems,
    };
  }

  private uniquePortfolioSlug(
    client: PrismaClientLike,
    base: string,
  ): Promise<string> {
    return uniqueSlug(base, async (slug) =>
      Boolean(
        await client.portfolio.findUnique({
          where: { slug },
          select: { id: true },
        }),
      ),
    );
  }
}

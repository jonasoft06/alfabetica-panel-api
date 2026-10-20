import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { MediaScope, MediaStatus } from '../../generated/prisma/enums';
import {
  coverItemSelect,
  galleryMediaWhere,
  toCoverItem,
} from '../media/media-item.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { FindPortfoliosQueryDto } from './dto/find-portfolios-query.dto';
import type { PortfolioListResponseDto } from './dto/portfolio-list.dto';
import { findPortfolioMaxItems } from './utils/portfolio-max-items.util';

const activePortfolioWhere = {
  project: { deletedAt: null },
} satisfies Prisma.PortfolioWhereInput;

@Injectable()
export class PortfoliosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

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
}

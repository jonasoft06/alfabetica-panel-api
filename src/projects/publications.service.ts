import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PublicationType } from '../../generated/prisma/enums';
import { coverItemSelect, toCoverItem } from '../media/media-item.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { FindPublicationsQueryDto } from './dto/find-publications-query.dto';
import type { PublicationListResponseDto } from './dto/publication-list.dto';

const activePublicationWhere = {
  project: { deletedAt: null },
} satisfies Prisma.PublicationWhereInput;

@Injectable()
export class PublicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

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
}

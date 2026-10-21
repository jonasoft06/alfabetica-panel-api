import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { changedFields } from '../activity-log/changed-fields.util';
import { logActivity } from '../activity-log/log-activity.util';
import type { ProjectDetailDto } from '../common/dto/project-detail.dto';
import { loadProjectDetailOrFail } from '../common/project-detail.util';
import { PortfoliosService } from '../portfolios/portfolios.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionService } from '../production/production.service';
import { PublicationsService } from '../publications/publications.service';
import { deleteStorageObjectSilently } from '../storage/delete-storage-object-silently.util';
import { StorageService } from '../storage/storage.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { FindProjectsQueryDto } from './dto/find-projects-query.dto';
import type { ProjectListItemDto } from './dto/project-list-item.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly portfoliosService: PortfoliosService,
    private readonly publicationsService: PublicationsService,
    private readonly productionService: ProductionService,
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

      // Facets seeded from the body are created in this same transaction, so
      // a failure in either rolls the whole project back.
      if (dto.portfolio) {
        await this.portfoliosService.createInTx(
          tx,
          project.id,
          dto.title,
          userId,
        );
      }

      if (dto.publication) {
        await this.publicationsService.createInTx(
          tx,
          project.id,
          dto.title,
          { type: dto.publication.type },
          userId,
        );
      }

      if (dto.production) {
        await this.productionService.createInTx(tx, project.id, userId);
      }

      return loadProjectDetailOrFail(tx, project.id);
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
    return loadProjectDetailOrFail(this.prisma, id);
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

      return loadProjectDetailOrFail(tx, id);
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
          production: { select: { id: true } },
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

      // Each facet releases its slug, its cover FK and anything that would
      // block the media delete below, inside this same transaction.
      if (project.portfolio) {
        await this.portfoliosService.cleanupForProjectDeleteInTx(
          tx,
          project.portfolio,
          suffix,
          userId,
        );
      }

      if (project.publication) {
        await this.publicationsService.cleanupForProjectDeleteInTx(
          tx,
          project.publication,
          suffix,
          userId,
        );
      }

      if (project.production) {
        await this.productionService.cleanupForProjectDeleteInTx(
          tx,
          project.production.id,
          userId,
        );
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
}

import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { ProjectDetailDto } from './dto/project-detail.dto';
import type { PrismaClientLike } from './project-existence.util';

// The project detail is returned by the project endpoints and by the facet
// endpoints that change what it shows (cover confirm, publish, unpublish), so
// it lives here rather than in either module.
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

export async function loadProjectDetailOrFail(
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

  return toDetailDto(project);
}

function toDetailDto(project: ProjectDetailRow): ProjectDetailDto {
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

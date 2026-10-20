import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PrismaClientLike = PrismaService | Prisma.TransactionClient;

export async function findActiveOrFail(
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

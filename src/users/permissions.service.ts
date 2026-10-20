import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PermissionDto } from './dto/permission.dto';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  // The catalog is fixed (seeded); this only exposes it to the panel.
  async findAll(): Promise<PermissionDto[]> {
    return this.prisma.permission.findMany({
      select: { id: true, key: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }
}

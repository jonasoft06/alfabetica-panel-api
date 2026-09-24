import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UserMeResponseDto } from './dto/user-me-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMe(userId: string): Promise<UserMeResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        role: {
          select: {
            id: true,
            name: true,
          },
        },
        permissions: {
          select: {
            permission: { select: { key: true } },
          },
        },
      },
    });

    // Defensive: the access token guard already proved the token is valid, but
    // the user could have been deleted after it was issued.
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      // Role is returned as plain data: it is a team label, not a permission source.
      role: user.role ? { id: user.role.id, name: user.role.name } : null,
      permissions: user.permissions.map(
        (userPermission) => userPermission.permission.key,
      ),
    };
  }
}

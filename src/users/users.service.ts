import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { UserStatus } from '../../generated/prisma/enums';
import { logActivity } from '../activity-log/log-activity.util';
import { normalizeEmail } from '../auth/utils/normalize-email.util';
import { PrismaService } from '../prisma/prisma.service';
import type { InviteUserDto } from './dto/invite-user.dto';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { UserListItemDto } from './dto/user-list-item.dto';
import type { UserMeResponseDto } from './dto/user-me-response.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The permission that manages collaborators; at least one ACTIVE user must
// always keep it, or nobody could manage users again.
const USERS_PERMISSION = 'users';

const userListSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  lastLogin: true,
  invitedAt: true,
  invitationExpiresAt: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
  permissions: { select: { permission: { select: { key: true } } } },
} satisfies Prisma.UserSelect;

type UserListRow = Prisma.UserGetPayload<{ select: typeof userListSelect }>;

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

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

  async findAll(): Promise<UserListItemDto[]> {
    const users = await this.prisma.user.findMany({
      select: userListSelect,
      orderBy: { createdAt: 'asc' },
    });

    return users.map((user) => this.toListItem(user));
  }

  async invite(dto: InviteUserDto, actorId: string): Promise<UserListItemDto> {
    const email = normalizeEmail(dto.email);

    // Same rule login applies: an address outside the domain could be invited
    // but never sign in.
    const allowedDomain = this.configService.getOrThrow<string>(
      'ALLOWED_EMAIL_DOMAIN',
    );
    if (email.split('@')[1] !== allowedDomain) {
      throw new BadRequestException('Email domain is not allowed');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.roleId) {
          const role = await tx.role.findUnique({
            where: { id: dto.roleId },
            select: { id: true },
          });

          if (!role) {
            throw new BadRequestException('Role not found');
          }
        }

        // The catalog is fixed: an invitation can only combine existing keys.
        const permissions = await tx.permission.findMany({
          where: { key: { in: dto.permissions } },
          select: { id: true, key: true },
        });
        const known = new Set(permissions.map((permission) => permission.key));
        const unknown = dto.permissions.filter((key) => !known.has(key));

        if (unknown.length > 0) {
          throw new BadRequestException({
            reason: 'UNKNOWN_PERMISSIONS',
            unknown,
          });
        }

        const existing = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });

        if (existing) {
          throw new ConflictException('A user with this email already exists');
        }

        const invitedAt = new Date();
        const user = await tx.user.create({
          data: {
            email,
            name: dto.name ?? null,
            roleId: dto.roleId ?? null,
            status: UserStatus.INVITED,
            invitedAt,
            invitationExpiresAt: new Date(
              invitedAt.getTime() + INVITATION_TTL_MS,
            ),
            invitedById: actorId,
            permissions: {
              create: permissions.map((permission) => ({
                permissionId: permission.id,
              })),
            },
          },
          select: userListSelect,
        });

        const item = this.toListItem(user);

        // No email in metadata: the log keeps summaries, not personal data.
        await logActivity(tx, {
          actorId,
          action: 'user.invite',
          entityType: 'user',
          entityId: user.id,
          metadata: {
            roleId: dto.roleId ?? null,
            permissions: item.permissions,
          },
        });

        return item;
      });
    } catch (error) {
      // A concurrent invitation took the same email after the check above
      // passed; the unique index caught it.
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async updateStatus(
    userId: string,
    dto: UpdateUserStatusDto,
    actorId: string,
  ): Promise<UserListItemDto> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { ...userListSelect, firebaseUid: true },
          });

          if (!user) {
            throw new NotFoundException('User not found');
          }

          // Same status is not a write: no tokenVersion bump and no log row.
          if (user.status === dto.status) {
            return this.toListItem(user);
          }

          // INVITED -> ACTIVE only happens on first login, which links the
          // Firebase account. Activating by hand an account that was never
          // linked would leave an ACTIVE user without firebaseUid, which login
          // treats as corrupt. This covers INVITED users (never linked) and
          // INACTIVE users who were deactivated before their first login.
          if (dto.status === UserStatus.ACTIVE && user.firebaseUid === null) {
            throw new ConflictException({ reason: 'USER_NOT_LINKED' });
          }

          // The protections only apply to ACTIVE users: an INVITED user cannot
          // sign in, and deactivating one is how a pending invitation is
          // cancelled.
          if (
            dto.status === UserStatus.INACTIVE &&
            user.status === UserStatus.ACTIVE
          ) {
            if (user.id === actorId) {
              throw new ConflictException({ reason: 'USER_SELF_DEACTIVATION' });
            }

            const managesUsers = user.permissions.some(
              (userPermission) =>
                userPermission.permission.key === USERS_PERMISSION,
            );

            if (managesUsers) {
              const remaining = await tx.user.count({
                where: {
                  id: { not: user.id },
                  status: UserStatus.ACTIVE,
                  permissions: {
                    some: { permission: { key: USERS_PERMISSION } },
                  },
                },
              });

              if (remaining === 0) {
                throw new ConflictException({ reason: 'LAST_USERS_ADMIN' });
              }
            }
          }

          const updated = await tx.user.update({
            where: { id: user.id },
            data: {
              status: dto.status,
              // Rejects every refresh token issued so far. Access tokens
              // already issued stay valid until they expire.
              ...(dto.status === UserStatus.INACTIVE
                ? { tokenVersion: { increment: 1 } }
                : {}),
            },
            select: userListSelect,
          });

          await logActivity(tx, {
            actorId,
            action:
              dto.status === UserStatus.ACTIVE
                ? 'user.activate'
                : 'user.deactivate',
            entityType: 'user',
            entityId: user.id,
            metadata: { from: user.status },
          });

          return this.toListItem(updated);
        },
        // Serializable so two admins deactivating each other at the same time
        // cannot both pass the last-admin check.
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // The losing side of a serialization conflict. Retrying is safe: the
      // request will then see the committed state and decide again.
      if (isPrismaError(error, 'P2034')) {
        throw new ConflictException({ reason: 'CONCURRENT_UPDATE' });
      }
      throw error;
    }
  }

  private toListItem(user: UserListRow): UserListItemDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role: user.role ? { id: user.role.id, name: user.role.name } : null,
      permissions: user.permissions
        .map((userPermission) => userPermission.permission.key)
        .sort(),
      lastLogin: user.lastLogin,
      invitedAt: user.invitedAt,
      invitationExpiresAt: user.invitationExpiresAt,
      createdAt: user.createdAt,
    };
  }
}

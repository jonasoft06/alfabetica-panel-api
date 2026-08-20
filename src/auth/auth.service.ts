import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Prisma, Status } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { FirebaseUser } from './guards/firebase-auth.guard';

const userWithRoleInclude = {
  role: {
    include: {
      rolePermissions: { include: { permission: true } },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithRole = Prisma.UserGetPayload<{
  include: typeof userWithRoleInclude;
}>;

interface RefreshTokenPayload {
  sub: string;
  tokenVersion: number;
}

interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(firebaseUser: FirebaseUser): Promise<LoginResult> {
    this.assertAllowedDomain(firebaseUser.email);

    const user = await this.prisma.user.findUnique({
      where: { firebaseUid: firebaseUser.uid },
      include: userWithRoleInclude,
    });

    this.assertActiveUser(user);

    // Refresh token: long-lived, minimal payload. tokenVersion lets /auth/refresh
    // and /auth/logout reject tokens issued before a manual session revocation.
    const refreshToken = this.jwtService.sign(
      {
        sub: user.id,
        tokenVersion: user.tokenVersion,
      },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
        ) as JwtSignOptions['expiresIn'],
      },
    );

    return { accessToken: this.signAccessToken(user), refreshToken };
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string }> {
    const payload = this.verifyRefreshToken(refreshToken);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: userWithRoleInclude,
    });

    this.assertActiveUser(user);

    if (user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    return { accessToken: this.signAccessToken(user) };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    let payload: RefreshTokenPayload;
    try {
      payload = this.verifyRefreshToken(refreshToken);
    } catch {
      return;
    }

    // Bumping tokenVersion invalidates every refresh token issued before this
    // point, logging the user out of all devices, not just this session.
    await this.prisma.user
      .update({
        where: { id: payload.sub },
        data: { tokenVersion: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  private signAccessToken(user: UserWithRole): string {
    const permissions = user.role.rolePermissions.map(
      (rolePermission) => rolePermission.permission.key,
    );

    // Access token: short-lived, carries the authorization payload used by
    // every protected endpoint (role + permissions) so guards never hit the DB.
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role.name,
        permissions,
      },
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as JwtSignOptions['expiresIn'],
      },
    );
  }

  private verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private assertActiveUser(
    user: UserWithRole | null,
  ): asserts user is UserWithRole {
    if (!user || user.status !== Status.active) {
      throw new UnauthorizedException(
        'User is not registered or is inactive',
      );
    }
  }

  private assertAllowedDomain(email: string): void {
    const allowedDomain = this.configService.getOrThrow<string>(
      'ALLOWED_EMAIL_DOMAIN',
    );
    const domain = email.split('@')[1];

    if (domain !== allowedDomain) {
      throw new ForbiddenException('Email domain is not allowed');
    }
  }
}
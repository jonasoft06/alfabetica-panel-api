import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Prisma, UserStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_ERROR_CODES, authError } from './auth-error';
import type { FirebaseUser } from './guards/firebase-auth.guard';
import { normalizeEmail } from './utils/normalize-email.util';

// Permissions are granted per user; the role is only a team label and carries
// no authorization weight, so it is loaded for display purposes alone.
const userAuthInclude = {
  role: true,
  permissions: { include: { permission: true } },
} satisfies Prisma.UserInclude;

type AuthenticatedUser = Prisma.UserGetPayload<{
  include: typeof userAuthInclude;
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
    const email = normalizeEmail(firebaseUser.email);

    this.assertAllowedDomain(email);

    if (!firebaseUser.emailVerified) {
      throw authError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
    }

    const linked = await this.prisma.user.findUnique({
      where: { firebaseUid: firebaseUser.uid },
      include: userAuthInclude,
    });

    // Already linked to Firebase: the only thing left to check is that the
    // account has not been deactivated since the last login.
    const user = linked
      ? await this.touchLastLogin(this.assertActive(linked))
      : await this.linkInvitedUser(firebaseUser, email);

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

    // Re-read from the database rather than trusting the refresh token: status
    // changes and permission grants must take effect on the next refresh.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: userAuthInclude,
    });

    if (!user) {
      throw new UnauthorizedException('User is not registered');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw authError(AUTH_ERROR_CODES.USER_INACTIVE);
    }

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

  /**
   * First login of an invited collaborator: the row already exists (created by
   * an administrator) but has no firebaseUid yet. This is the only place where
   * a user goes from INVITED to ACTIVE.
   */
  private async linkInvitedUser(
    firebaseUser: FirebaseUser,
    email: string,
  ): Promise<AuthenticatedUser> {
    const invited = await this.prisma.user.findUnique({
      where: { email },
      include: userAuthInclude,
    });

    if (!invited) {
      throw authError(AUTH_ERROR_CODES.USER_NOT_INVITED);
    }

    // A different Firebase account already owns this email. Linking would hand
    // one person's panel account to another, so it is always refused.
    if (invited.firebaseUid !== null) {
      throw authError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
    }

    if (invited.status === UserStatus.INACTIVE) {
      throw authError(AUTH_ERROR_CODES.USER_INACTIVE);
    }

    // ACTIVE without a firebaseUid should not exist; treat it as corrupt data
    // rather than silently adopting the account.
    if (invited.status !== UserStatus.INVITED) {
      throw authError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
    }

    if (
      invited.invitationExpiresAt !== null &&
      invited.invitationExpiresAt.getTime() <= Date.now()
    ) {
      throw authError(AUTH_ERROR_CODES.INVITATION_EXPIRED);
    }

    return this.prisma.user.update({
      where: { id: invited.id },
      data: {
        firebaseUid: firebaseUser.uid,
        status: UserStatus.ACTIVE,
        lastLogin: new Date(),
        // The administrator may have typed a name when inviting; only fall back
        // to the Google display name when the field is still empty.
        ...(invited.name === null && firebaseUser.name !== null
          ? { name: firebaseUser.name }
          : {}),
      },
      include: userAuthInclude,
    });
  }

  private async touchLastLogin(
    user: AuthenticatedUser,
  ): Promise<AuthenticatedUser> {
    return this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
      include: userAuthInclude,
    });
  }

  private signAccessToken(user: AuthenticatedUser): string {
    const permissions = user.permissions.map(
      (userPermission) => userPermission.permission.key,
    );

    // Access token: short-lived, carries the authorization payload used by
    // every protected endpoint (permissions) so guards never hit the DB.
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role?.name ?? null,
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

  private assertActive(user: AuthenticatedUser): AuthenticatedUser {
    if (user.status !== UserStatus.ACTIVE) {
      throw authError(AUTH_ERROR_CODES.USER_INACTIVE);
    }

    return user;
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

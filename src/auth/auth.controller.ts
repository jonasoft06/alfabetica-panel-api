import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { LoginResponseDto } from './dto/login-response.dto';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';
import type { FirebaseAuthenticatedRequest } from './guards/firebase-auth.guard';
import { parseDurationToMs } from './utils/parse-duration.util';

const REFRESH_TOKEN_COOKIE = 'refreshToken';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @UseGuards(FirebaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() request: FirebaseAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const { accessToken, refreshToken } = await this.authService.login(
      request.firebaseUser,
    );

    const refreshExpiresIn = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );

    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...this.refreshCookieOptions(),
      maxAge: parseDurationToMs(refreshExpiresIn),
    });

    return { accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request): Promise<LoginResponseDto> {
    const refreshToken = this.extractRefreshToken(request);
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    return this.authService.refreshAccessToken(refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = this.extractRefreshToken(request);
    await this.authService.logout(refreshToken);
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.refreshCookieOptions());
  }

  private extractRefreshToken(request: Request): string | undefined {
    return request.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
  }

  private refreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
    };
  }
}
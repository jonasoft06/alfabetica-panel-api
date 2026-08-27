import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { AuthenticatedRequest } from './access-token.guard';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<
      string[] | undefined
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    // Routes without @RequirePermissions only need a valid token (e.g. /users/me).
    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = request.user?.permissions ?? [];

    // AND semantics: every listed permission must be present.
    const missing = requiredPermissions.filter(
      (permission) => !granted.includes(permission),
    );

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required permission(s): ${missing.join(', ')}`,
      );
    }

    return true;
  }
}

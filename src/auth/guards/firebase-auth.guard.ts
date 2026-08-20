import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FIREBASE_ADMIN_APP } from '../../firebase/firebase-admin.provider';

export interface FirebaseUser {
  uid: string;
  email: string;
}

export type FirebaseAuthenticatedRequest = Request & {
  firebaseUser: FirebaseUser;
};

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(@Inject(FIREBASE_ADMIN_APP) private readonly firebaseApp: App) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FirebaseAuthenticatedRequest>();

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing Firebase ID token');
    }

    const decoded = await getAuth(this.firebaseApp)
      .verifyIdToken(token)
      .catch(() => {
        throw new UnauthorizedException(
          'Invalid or expired Firebase ID token',
        );
      });

    if (!decoded.email) {
      throw new UnauthorizedException('Firebase token has no email');
    }

    request.firebaseUser = { uid: decoded.uid, email: decoded.email };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length).trim();
  }
}
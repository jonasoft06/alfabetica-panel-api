import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

export const FIREBASE_ADMIN_APP = Symbol('FIREBASE_ADMIN_APP');

export const firebaseAdminProvider: Provider = {
  provide: FIREBASE_ADMIN_APP,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): App => {
    const existingApp = getApps()[0];
    if (existingApp) {
      return existingApp;
    }

    const serviceAccountB64 = configService.getOrThrow<string>(
      'FIREBASE_SERVICE_ACCOUNT_B64',
    );
    const serviceAccount = JSON.parse(
      Buffer.from(serviceAccountB64, 'base64').toString('utf-8'),
    );

    return initializeApp({
      credential: cert(serviceAccount),
    });
  },
};
import { Global, Module } from '@nestjs/common';
import { firebaseAdminProvider } from './firebase-admin.provider';

@Global()
@Module({
  providers: [firebaseAdminProvider],
  exports: [firebaseAdminProvider],
})
export class FirebaseAdminModule {}
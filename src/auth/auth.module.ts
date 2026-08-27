import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    FirebaseAuthGuard,
    AccessTokenGuard,
    PermissionsGuard,
  ],
  exports: [AccessTokenGuard, PermissionsGuard, JwtModule],
})
export class AuthModule {}

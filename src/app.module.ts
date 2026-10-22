import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { envValidationSchema } from './config/env.validation';
import { FirebaseAdminModule } from './firebase/firebase-admin.module';
import { HealthController } from './health.controller';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    PrismaModule,
    FirebaseAdminModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    MediaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

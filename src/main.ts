import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Trust one hop (Dokku's nginx) so req.secure/req.protocol follow
  // X-Forwarded-Proto. Cloudflare sits in front of nginx.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      // Required for @Type()/nested DTO validation to run.
      transform: true,
    }),
  );
  // Closes Prisma's pool on SIGTERM when Dokku swaps containers.
  app.enableShutdownHooks();

  // PORT default lives in the Joi schema (single source of truth).
  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
}
void bootstrap();

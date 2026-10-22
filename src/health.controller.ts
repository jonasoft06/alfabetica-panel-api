import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

// Liveness + database check for Dokku/uptime probes. No auth on purpose: it
// answers only `ok` or a generic 503, never driver details.
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error('Database health check failed', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database is unavailable',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok' };
  }
}

import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma/prisma.service';

// Factory mock: Jest can't resolve the generated client's `.js` imports.
jest.mock('./prisma/prisma.service', () => ({ PrismaService: class {} }));

describe('HealthController', () => {
  let controller: HealthController;
  const prisma = { $queryRaw: jest.fn() };

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = module.get(HealthController);
  });

  it('returns ok when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(controller.check()).resolves.toEqual({ status: 'ok' });
  });

  it('responds 503 when the database query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(controller.check()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    await expect(controller.check()).rejects.toBeInstanceOf(HttpException);
  });
});

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClickUpModule } from '../integrations/clickup/clickup.module';
import { ProductionSyncService } from './production-sync.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  imports: [AuthModule, ClickUpModule],
  controllers: [ProductionController],
  providers: [ProductionService, ProductionSyncService],
  exports: [ProductionService],
})
export class ProductionModule {}

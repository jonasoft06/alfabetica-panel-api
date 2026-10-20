import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { StorageModule } from '../storage/storage.module';
import { PortfolioController } from './portfolio.controller';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';

@Module({
  imports: [AuthModule, MediaModule, StorageModule],
  controllers: [PortfoliosController, PortfolioController],
  providers: [PortfoliosService],
  exports: [PortfoliosService],
})
export class PortfoliosModule {}

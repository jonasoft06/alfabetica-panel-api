import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { CoverService } from './covers/cover.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [MediaController],
  providers: [MediaService, CoverService],
  exports: [CoverService],
})
export class MediaModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { StorageModule } from '../storage/storage.module';
import { PublicationController } from './publication.controller';
import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';
import { PublicationSectionsController } from './sections/publication-sections.controller';
import { PublicationSectionsService } from './sections/publication-sections.service';

@Module({
  imports: [AuthModule, MediaModule, StorageModule],
  controllers: [
    PublicationsController,
    PublicationController,
    PublicationSectionsController,
  ],
  providers: [PublicationsService, PublicationSectionsService],
  exports: [PublicationsService],
})
export class PublicationsModule {}

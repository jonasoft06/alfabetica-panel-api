import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { PublicationSectionsController } from './publication-sections.controller';
import { PublicationSectionsService } from './publication-sections.service';
import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    ProjectsController,
    PublicationSectionsController,
    PortfoliosController,
    PublicationsController,
  ],
  providers: [
    ProjectsService,
    PublicationSectionsService,
    PortfoliosService,
    PublicationsService,
  ],
})
export class ProjectsModule {}

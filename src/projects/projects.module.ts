import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortfoliosModule } from '../portfolios/portfolios.module';
import { PublicationsModule } from '../publications/publications.module';
import { StorageModule } from '../storage/storage.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

// Aggregate root: project create and soft delete orchestrate the facets
// through their exported services. Facet modules never import this one.
@Module({
  imports: [AuthModule, StorageModule, PortfoliosModule, PublicationsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}

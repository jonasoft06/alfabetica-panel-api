import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import type { CreateMediaResult } from '../media/media.service';
import { ConfirmPortfolioCoverDto } from './dto/confirm-portfolio-cover.dto';
import { CreatePortfolioCoverDto } from './dto/create-portfolio-cover.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { CreatePublicationDto } from './dto/create-publication.dto';
import { FindProjectsQueryDto } from './dto/find-projects-query.dto';
import type { PortfolioDetailDto } from './dto/portfolio-detail.dto';
import type { ProjectDetailDto } from './dto/project-detail.dto';
import type { ProjectListItemDto } from './dto/project-list-item.dto';
import type { PublicationDetailDto } from './dto/publication-detail.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpsertPortfolioDto } from './dto/upsert-portfolio.dto';
import { UpsertPublicationDto } from './dto/upsert-publication.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // Seeding facets from this body is part of creating the project, so it needs
  // no permission beyond 'projects'. Editing a facet afterwards is what
  // requires the facet's own permission.
  @Post()
  @RequirePermissions('projects')
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProjectDetailDto> {
    return this.projectsService.create(dto, user.sub);
  }

  // Read-only: any authenticated user can list/view projects regardless of
  // module permission. Module permissions (projects, portfolio, publication,
  // production, etc.) only gate writes (create/update/delete).
  @Get()
  async findAll(
    @Query() query: FindProjectsQueryDto,
  ): Promise<ProjectListItemDto[]> {
    return this.projectsService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ProjectDetailDto> {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('projects')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectDetailDto> {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.projectsService.remove(id);
  }

  // Adding or removing a facet changes the project's shape, so it belongs to
  // 'projects'. Editing the facet's own content belongs to the facet.
  @Post(':id/portfolio')
  @RequirePermissions('projects')
  async createPortfolio(@Param('id') id: string): Promise<PortfolioDetailDto> {
    return this.projectsService.createPortfolio(id);
  }

  @Delete(':id/portfolio')
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePortfolio(@Param('id') id: string): Promise<void> {
    return this.projectsService.deletePortfolio(id);
  }

  // Read-only, same as findAll/findOne above.
  @Get(':id/portfolio')
  async findPortfolio(@Param('id') id: string): Promise<PortfolioDetailDto> {
    return this.projectsService.findPortfolio(id);
  }

  @Put(':id/portfolio')
  @RequirePermissions('portfolio')
  async updatePortfolio(
    @Param('id') id: string,
    @Body() dto: UpsertPortfolioDto,
  ): Promise<PortfolioDetailDto> {
    return this.projectsService.updatePortfolio(id, dto);
  }

  @Post(':id/publication')
  @RequirePermissions('projects')
  async createPublication(
    @Param('id') id: string,
    @Body() dto: CreatePublicationDto,
  ): Promise<PublicationDetailDto> {
    return this.projectsService.createPublication(id, dto);
  }

  @Delete(':id/publication')
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePublication(@Param('id') id: string): Promise<void> {
    return this.projectsService.deletePublication(id);
  }

  @Put(':id/publication')
  @RequirePermissions('publication')
  async updatePublication(
    @Param('id') id: string,
    @Body() dto: UpsertPublicationDto,
  ): Promise<PublicationDetailDto> {
    return this.projectsService.updatePublication(id, dto);
  }

  // Read-only, same as findAll/findOne above: any authenticated user can view
  // publication details regardless of module permission. Writes still go
  // through PUT :id/publication, gated on 'publication'.
  @Get(':id/publication')
  async findPublication(
    @Param('id') id: string,
  ): Promise<PublicationDetailDto> {
    return this.projectsService.findPublication(id);
  }

  @Post(':id/portfolio/cover')
  @RequirePermissions('portfolio')
  async createPortfolioCover(
    @Param('id') id: string,
    @Body() dto: CreatePortfolioCoverDto,
  ): Promise<CreateMediaResult> {
    return this.projectsService.createPortfolioCover(id, dto);
  }

  @Patch(':id/portfolio/cover/confirm')
  @RequirePermissions('portfolio')
  async confirmPortfolioCover(
    @Param('id') id: string,
    @Body() dto: ConfirmPortfolioCoverDto,
  ): Promise<ProjectDetailDto> {
    return this.projectsService.confirmPortfolioCover(id, dto);
  }

  @Post(':id/portfolio/publish')
  @RequirePermissions('portfolio')
  @HttpCode(HttpStatus.OK)
  async publish(@Param('id') id: string): Promise<ProjectDetailDto> {
    return this.projectsService.publishPortfolio(id);
  }

  @Post(':id/portfolio/unpublish')
  @RequirePermissions('portfolio')
  @HttpCode(HttpStatus.OK)
  async unpublish(@Param('id') id: string): Promise<ProjectDetailDto> {
    return this.projectsService.unpublishPortfolio(id);
  }
}

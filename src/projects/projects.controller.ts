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
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import type { ProjectDetailDto } from '../common/dto/project-detail.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { FindProjectsQueryDto } from './dto/find-projects-query.dto';
import type { ProjectListItemDto } from './dto/project-list-item.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
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
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProjectDetailDto> {
    return this.projectsService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<void> {
    return this.projectsService.remove(id, user.sub);
  }
}

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
import type { ProjectDetailDto } from './dto/project-detail.dto';
import type { ProjectListItemDto } from './dto/project-list-item.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpsertPortfolioDto } from './dto/upsert-portfolio.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @RequirePermissions('projects')
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProjectDetailDto> {
    // @RequirePermissions can only describe the route, and this rule depends on
    // the body: creating a project is 'projects', but seeding a publication
    // alongside it also requires 'publication'. A decorator evaluated before the
    // handler cannot see dto.publication, so the check lives here.
    if (dto.publication && !user.permissions.includes('publication')) {
      throw new ForbiddenException(
        'Missing required permission(s): publication',
      );
    }

    return this.projectsService.create(dto, user.sub);
  }

  @Get()
  @RequirePermissions('projects')
  async findAll(): Promise<ProjectListItemDto[]> {
    return this.projectsService.findAll();
  }

  @Get(':id')
  @RequirePermissions('projects')
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

  @Put(':id/portfolio')
  @RequirePermissions('projects')
  async upsertPortfolio(
    @Param('id') id: string,
    @Body() dto: UpsertPortfolioDto,
  ): Promise<ProjectDetailDto> {
    return this.projectsService.upsertPortfolio(id, dto);
  }

  @Post(':id/portfolio/cover')
  @RequirePermissions('projects')
  async createPortfolioCover(
    @Param('id') id: string,
    @Body() dto: CreatePortfolioCoverDto,
  ): Promise<CreateMediaResult> {
    return this.projectsService.createPortfolioCover(id, dto);
  }

  @Patch(':id/portfolio/cover/confirm')
  @RequirePermissions('projects')
  async confirmPortfolioCover(
    @Param('id') id: string,
    @Body() dto: ConfirmPortfolioCoverDto,
  ): Promise<ProjectDetailDto> {
    return this.projectsService.confirmPortfolioCover(id, dto);
  }

  @Post(':id/portfolio/publish')
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.OK)
  async publish(@Param('id') id: string): Promise<ProjectDetailDto> {
    return this.projectsService.publishPortfolio(id);
  }

  @Post(':id/portfolio/unpublish')
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.OK)
  async unpublish(@Param('id') id: string): Promise<ProjectDetailDto> {
    return this.projectsService.unpublishPortfolio(id);
  }
}

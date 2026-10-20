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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import type { ProjectDetailDto } from '../common/dto/project-detail.dto';
import { ConfirmCoverDto } from '../media/covers/dto/confirm-cover.dto';
import type { CoverResponseDto } from '../media/covers/dto/cover-response.dto';
import { CreateCoverDto } from '../media/covers/dto/create-cover.dto';
import type { CreateMediaResult } from '../media/media.service';
import type { PortfolioDetailDto } from './dto/portfolio-detail.dto';
import { UpsertPortfolioDto } from './dto/upsert-portfolio.dto';
import { PortfoliosService } from './portfolios.service';

// The portfolio facet of a single project. The flat list lives in
// PortfoliosController (GET /portfolios).
@Controller('projects/:projectId/portfolio')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PortfolioController {
  constructor(private readonly portfoliosService: PortfoliosService) {}

  // Adding or removing a facet changes the project's shape, so it belongs to
  // 'projects'. Editing the facet's own content belongs to the facet.
  @Post()
  @RequirePermissions('projects')
  async create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PortfolioDetailDto> {
    return this.portfoliosService.create(projectId, user.sub);
  }

  @Delete()
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<void> {
    return this.portfoliosService.remove(projectId, user.sub);
  }

  // Read-only, same as GET /projects and GET /projects/:id.
  @Get()
  async findOne(
    @Param('projectId') projectId: string,
  ): Promise<PortfolioDetailDto> {
    return this.portfoliosService.findOne(projectId);
  }

  @Put()
  @RequirePermissions('portfolio')
  async update(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertPortfolioDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PortfolioDetailDto> {
    return this.portfoliosService.update(projectId, dto, user.sub);
  }

  // Read-only, same as the other facet GETs: any authenticated user.
  @Get('cover')
  async findCover(
    @Param('projectId') projectId: string,
  ): Promise<CoverResponseDto> {
    return this.portfoliosService.findCover(projectId);
  }

  @Post('cover')
  @RequirePermissions('portfolio')
  async createCover(
    @Param('projectId') projectId: string,
    @Body() dto: CreateCoverDto,
  ): Promise<CreateMediaResult> {
    return this.portfoliosService.createCover(projectId, dto);
  }

  @Patch('cover/confirm')
  @RequirePermissions('portfolio')
  async confirmCover(
    @Param('projectId') projectId: string,
    @Body() dto: ConfirmCoverDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProjectDetailDto> {
    return this.portfoliosService.confirmCover(
      projectId,
      dto.mediaId,
      user.sub,
    );
  }

  @Post('publish')
  @RequirePermissions('portfolio')
  @HttpCode(HttpStatus.OK)
  async publish(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProjectDetailDto> {
    return this.portfoliosService.publish(projectId, user.sub);
  }

  @Post('unpublish')
  @RequirePermissions('portfolio')
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProjectDetailDto> {
    return this.portfoliosService.unpublish(projectId, user.sub);
  }
}

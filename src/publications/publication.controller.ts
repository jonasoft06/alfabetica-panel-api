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
import { CreatePublicationDto } from './dto/create-publication.dto';
import type { PublicationDetailDto } from './dto/publication-detail.dto';
import { UpsertPublicationDto } from './dto/upsert-publication.dto';
import { PublicationsService } from './publications.service';

// The publication facet of a single project. The flat list lives in
// PublicationsController (GET /publications); sections live in
// PublicationSectionsController.
@Controller('projects/:projectId/publication')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PublicationController {
  constructor(private readonly publicationsService: PublicationsService) {}

  // Adding or removing a facet changes the project's shape, so it belongs to
  // 'projects'. Editing the facet's own content belongs to the facet.
  @Post()
  @RequirePermissions('projects')
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreatePublicationDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PublicationDetailDto> {
    return this.publicationsService.create(projectId, dto, user.sub);
  }

  @Delete()
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<void> {
    return this.publicationsService.remove(projectId, user.sub);
  }

  @Put()
  @RequirePermissions('publication')
  async update(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertPublicationDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PublicationDetailDto> {
    return this.publicationsService.update(projectId, dto, user.sub);
  }

  // Read-only, same as GET /projects and GET /projects/:id: any authenticated
  // user can view publication details regardless of module permission.
  // Writes still go through PUT, gated on 'publication'.
  @Get()
  async findOne(
    @Param('projectId') projectId: string,
  ): Promise<PublicationDetailDto> {
    return this.publicationsService.findOne(projectId);
  }

  // Read-only, same as the other facet GETs: any authenticated user.
  @Get('cover')
  async findCover(
    @Param('projectId') projectId: string,
  ): Promise<CoverResponseDto> {
    return this.publicationsService.findCover(projectId);
  }

  @Post('cover')
  @RequirePermissions('publication')
  async createCover(
    @Param('projectId') projectId: string,
    @Body() dto: CreateCoverDto,
  ): Promise<CreateMediaResult> {
    return this.publicationsService.createCover(projectId, dto);
  }

  @Patch('cover/confirm')
  @RequirePermissions('publication')
  async confirmCover(
    @Param('projectId') projectId: string,
    @Body() dto: ConfirmCoverDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProjectDetailDto> {
    return this.publicationsService.confirmCover(
      projectId,
      dto.mediaId,
      user.sub,
    );
  }
}

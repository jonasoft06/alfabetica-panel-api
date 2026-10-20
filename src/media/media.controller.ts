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
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthenticatedRequest } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateMediaDto } from './dto/create-media.dto';
import { FindProjectMediaQueryDto } from './dto/find-project-media-query.dto';
import type { ProjectGalleryResponseDto } from './dto/project-gallery-response.dto';
import type {
  CleanupPendingMediaResult,
  ConfirmMediaResult,
  CreateMediaResult,
} from './media.service';
import { MediaService } from './media.service';

@Controller()
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  // Read-only, same as GET /projects/:id: any authenticated user can view a
  // facet's gallery regardless of module permission. The cover is served by
  // GET /projects/:id/<facet>/cover.
  @Get('projects/:id/media')
  async findProjectMedia(
    @Param('id') projectId: string,
    @Query() query: FindProjectMediaQueryDto,
  ): Promise<ProjectGalleryResponseDto> {
    return this.mediaService.findProjectMedia(projectId, query.scope);
  }

  // These three carry no @RequirePermissions on purpose: the required
  // permission depends on the media's scope (PORTFOLIO -> portfolio,
  // PUBLICATION -> publication), which the service resolves from the body or
  // the stored row before doing anything else.
  @Post('projects/:id/media')
  async create(
    @Param('id') projectId: string,
    @Body() dto: CreateMediaDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CreateMediaResult> {
    return this.mediaService.createMedia(projectId, dto, req.user);
  }

  @Patch('media/:id/confirm')
  async confirm(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfirmMediaResult> {
    return this.mediaService.confirmMedia(id, req.user);
  }

  @Delete('media/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.mediaService.deleteMedia(id, req.user);
  }

  // Gated on 'settings' as a stand-in — this is a maintenance operation, not
  // a project-scoped one. Migrate to a superadmin break-glass guard once
  // that exists; there is no such guard yet.
  @Post('media/cleanup-pending')
  @RequirePermissions('settings')
  async cleanupPending(
    @Req() req: AuthenticatedRequest,
  ): Promise<CleanupPendingMediaResult> {
    return this.mediaService.cleanupPendingMedia(req.user);
  }
}

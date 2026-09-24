import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthenticatedRequest } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateMediaDto } from './dto/create-media.dto';
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
  async cleanupPending(): Promise<CleanupPendingMediaResult> {
    return this.mediaService.cleanupPendingMedia();
  }
}

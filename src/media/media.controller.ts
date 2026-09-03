import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthenticatedRequest } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateMediaDto } from './dto/create-media.dto';
import type { CreateMediaResult } from './media.service';
import { MediaService } from './media.service';

@Controller()
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('projects/:id/media')
  @RequirePermissions('projects')
  async create(
    @Param('id') projectId: string,
    @Body() dto: CreateMediaDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CreateMediaResult> {
    return this.mediaService.createMedia(projectId, dto, req.user);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import type { ProductionDetailDto } from './dto/production-detail.dto';
import type { ProductionListItemDto } from './dto/production-list-item.dto';
import type { ProductionPhaseDto } from './dto/production-phase.dto';
import type { SyncResultDto } from './dto/sync-result.dto';
import { UpsertProductionDto } from './dto/upsert-production.dto';
import { ProductionSyncService } from './production-sync.service';
import { ProductionService } from './production.service';

// One controller for the whole facet (target pattern; portfolios and
// publications will be migrated to it). The full URL is on each handler.
@Controller()
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ProductionController {
  constructor(
    private readonly productionService: ProductionService,
    private readonly syncService: ProductionSyncService,
  ) {}

  // Read-only: any authenticated user.
  @Get('productions')
  async findAll(): Promise<ProductionListItemDto[]> {
    return this.productionService.findAll();
  }

  // Reads ClickUp, writes only to this API's database. Sequential and
  // tolerant: one failing production does not stop the rest.
  @Post('productions/sync')
  @RequirePermissions('production')
  @HttpCode(HttpStatus.OK)
  async syncAll(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<SyncResultDto> {
    return this.syncService.syncAll(user.sub);
  }

  // Hyphenated on purpose (exception to the one-word rule): /phases alone
  // would be ambiguous, and /productions/phases could collide with a future
  // /productions/:id.
  @Get('production-phases')
  async findPhases(): Promise<ProductionPhaseDto[]> {
    return this.productionService.findPhases();
  }

  // Adding or removing a facet changes the project's shape, so it belongs to
  // 'projects'. Editing the facet's own content belongs to the facet.
  @Post('projects/:projectId/production')
  @RequirePermissions('projects')
  async create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProductionDetailDto> {
    return this.productionService.create(projectId, user.sub);
  }

  @Delete('projects/:projectId/production')
  @RequirePermissions('projects')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<void> {
    return this.productionService.remove(projectId, user.sub);
  }

  // Read-only: any authenticated user.
  @Get('projects/:projectId/production')
  async findOne(
    @Param('projectId') projectId: string,
  ): Promise<ProductionDetailDto> {
    return this.productionService.findOne(projectId);
  }

  // Edits authorName and links/unlinks the ClickUp list (linking syncs it
  // right away).
  @Put('projects/:projectId/production')
  @RequirePermissions('production')
  async update(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertProductionDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProductionDetailDto> {
    return this.productionService.update(projectId, dto, user.sub);
  }

  // Re-reads this production's ClickUp list now. Works on FINISHED
  // productions too, unlike POST /productions/sync.
  @Post('projects/:projectId/production/sync')
  @RequirePermissions('production')
  @HttpCode(HttpStatus.OK)
  async syncOne(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ProductionDetailDto> {
    return this.productionService.sync(projectId, user.sub);
  }
}

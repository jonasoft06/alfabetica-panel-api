import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { PermissionDto } from './dto/permission.dto';
import { PermissionsService } from './permissions.service';

@Controller('permissions')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  // Read-only: any authenticated user.
  @Get()
  async findAll(): Promise<PermissionDto[]> {
    return this.permissionsService.findAll();
  }
}

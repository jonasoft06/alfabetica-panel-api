import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { RoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // Read-only: any authenticated user.
  @Get()
  async findAll(): Promise<RoleDto[]> {
    return this.rolesService.findAll();
  }
}

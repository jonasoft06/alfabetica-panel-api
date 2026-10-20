import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { UserListItemDto } from './dto/user-list-item.dto';
import type { UserMeResponseDto } from './dto/user-me-response.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Read-only: any authenticated user can see the collaborator list, same as
  // every other GET. Managing collaborators requires 'users'.
  @Get()
  async findAll(): Promise<UserListItemDto[]> {
    return this.usersService.findAll();
  }

  @Get('me')
  async getMe(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<UserMeResponseDto> {
    return this.usersService.findMe(user.sub);
  }

  @Post('invitations')
  @RequirePermissions('users')
  async invite(
    @Body() dto: InviteUserDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<UserListItemDto> {
    return this.usersService.invite(dto, user.sub);
  }

  @Patch(':id/status')
  @RequirePermissions('users')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<UserListItemDto> {
    return this.usersService.updateStatus(id, dto, user.sub);
  }
}

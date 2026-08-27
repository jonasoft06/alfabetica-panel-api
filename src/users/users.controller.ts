import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import type { UserMeResponseDto } from './dto/user-me-response.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async getMe(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<UserMeResponseDto> {
    return this.usersService.findMe(user.sub);
  }
}

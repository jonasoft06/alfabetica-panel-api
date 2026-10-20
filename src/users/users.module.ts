import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Collaborator management: users, plus the role labels and the permission
// catalog the invite form picks from.
@Module({
  imports: [AuthModule],
  controllers: [UsersController, RolesController, PermissionsController],
  providers: [UsersService, RolesService, PermissionsService],
})
export class UsersModule {}

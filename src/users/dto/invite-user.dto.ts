import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Body of POST /users/invitations. The email is normalized (trim + lowercase)
 * in UsersService; trimming here only lets IsEmail accept surrounding spaces.
 * Permission keys are checked against the catalog in the service.
 */
export class InviteUserDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];
}

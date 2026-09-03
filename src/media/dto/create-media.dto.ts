import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { MediaScope, MediaType } from '../../../generated/prisma/enums';

export class CreateMediaDto {
  @IsEnum(MediaScope)
  scope: MediaScope;

  @IsEnum(MediaType)
  type: MediaType;

  @IsString()
  mimeType: string;

  @IsInt()
  @IsPositive()
  sizeBytes: number;

  @IsOptional()
  @IsString()
  alt?: string;

  @IsOptional()
  @IsString()
  caption?: string;
}

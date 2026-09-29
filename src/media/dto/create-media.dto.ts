import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Min,
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

  // Required for IMAGE and forbidden for PDF. That rule depends on `type`, so
  // it is enforced in MediaService; the DTO only checks the value's shape.
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}

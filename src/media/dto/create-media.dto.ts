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

  // Required: this route only creates images (PDFs are rejected in
  // MediaService). The DTO only checks the value's shape.
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}

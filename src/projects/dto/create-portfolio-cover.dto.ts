import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreatePortfolioCoverDto {
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

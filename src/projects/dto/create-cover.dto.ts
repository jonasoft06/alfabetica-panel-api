import { IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';

// Shared by the portfolio and publication cover flows.
export class CreateCoverDto {
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

  // Must match the facet's cover size exactly; checked in ProjectsService so
  // the failure carries the COVER_INVALID_DIMENSIONS reason.
  @IsInt()
  @Min(1)
  width: number;

  @IsInt()
  @Min(1)
  height: number;
}

import { IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';

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

  // Must match PORTFOLIO_COVER_WIDTH × PORTFOLIO_COVER_HEIGHT exactly; checked
  // in ProjectsService so the failure carries the COVER_INVALID_DIMENSIONS reason.
  @IsInt()
  @Min(1)
  width: number;

  @IsInt()
  @Min(1)
  height: number;
}

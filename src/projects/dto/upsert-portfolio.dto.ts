import { IsOptional, IsString } from 'class-validator';

export class UpsertPortfolioDto {
  // If omitted, the service generates one from the project title.
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsString()
  coverStorageKey?: string;
}

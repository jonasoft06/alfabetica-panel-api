import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Body of PUT /projects/:id/portfolio. `slug` and `coverMediaId` are not
 * writable here: the slug is generated once when the facet is created, and the
 * cover is written only by the dedicated cover flow.
 */
export class UpsertPortfolioDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

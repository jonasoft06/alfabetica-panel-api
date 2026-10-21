import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Body of PUT /projects/:projectId/production. Each field: absent = leave as
 * is, null = clear. A clickupListId links (and syncs) the list; null unlinks.
 */
export class UpsertProductionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  authorName?: string | null;

  // ClickUp list ids are numeric strings; anything else is rejected before
  // calling ClickUp.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\d+$/)
  clickupListId?: string | null;
}

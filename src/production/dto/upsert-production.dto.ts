import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { BookType, ProductionStatus } from '../../../generated/prisma/enums';

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Body of PUT /projects/:projectId/production. Each field: absent = leave as
 * is, null = clear. A clickupListId links (and syncs) the list; null unlinks.
 *
 * bookType, status, currentPhaseCode and the two dates are the manual fields:
 * only accepted while the production is not linked to ClickUp (checked in
 * ProductionService, together with the status/phase consistency rules).
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

  @IsOptional()
  @IsEnum(BookType)
  bookType?: BookType | null;

  // Never null: every production has a status.
  @ValidateIf((dto: UpsertProductionDto) => dto.status !== undefined)
  @IsEnum(ProductionStatus)
  status?: ProductionStatus;

  // Checked against the ProductionPhase catalog in the service.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentPhaseCode?: string | null;

  // Calendar dates: the pattern pins the format, strict ISO 8601 rejects days
  // that do not exist (2026-02-30).
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  currentStageDueDate?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  estimatedEndDate?: string | null;
}

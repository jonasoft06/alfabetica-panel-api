import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Body of PATCH /projects/:id/publication/sections/:sectionId. sortOrder
 * changes go through PUT .../sections/order and the PDF through the section
 * PDF routes; any other key is rejected by the global forbidNonWhitelisted pipe.
 */
export class UpdatePublicationSectionDto {
  // Optional but never null: unlike @IsOptional, this still rejects null.
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  label?: string;

  // null clears it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// The PDF is not part of this body: a section is created empty and its PDF is
// attached later via POST .../sections/:sectionId/pdf.
export class CreatePublicationSectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(17)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  description?: string;

  // Omitted -> appended after the current last section.
  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;
}

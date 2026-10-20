import {
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

// Body of POST .../sections/:sectionId/pdf. mimeType and size limits are
// checked in PublicationSectionsService, same as the cover flow.
export class CreateSectionPdfDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalName: string;

  @IsString()
  mimeType: string;

  @IsInt()
  @IsPositive()
  sizeBytes: number;
}

import { IsEnum, IsOptional } from 'class-validator';
import { PublicationType } from '../../../generated/prisma/enums';
import { PublicationFieldsDto } from './publication-fields.dto';

/**
 * Body of PUT /projects/:id/publication. The publication must already exist —
 * this endpoint never creates it — so `type` is optional here and defaults to
 * the stored one. Changing it clears the fields belonging to the previous type.
 */
export class UpsertPublicationDto extends PublicationFieldsDto {
  @IsOptional()
  @IsEnum(PublicationType)
  type?: PublicationType;
}

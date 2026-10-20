import { IsEnum } from 'class-validator';
import { PublicationType } from '../../../generated/prisma/enums';
import { PublicationFieldsDto } from './publication-fields.dto';

/**
 * Body of POST /projects/:id/publication. Same fields and type-dependent rules
 * as the update DTO, except `type` is required: there is no stored value to
 * fall back on when the facet is being created.
 */
export class CreatePublicationDto extends PublicationFieldsDto {
  @IsEnum(PublicationType)
  type: PublicationType;
}

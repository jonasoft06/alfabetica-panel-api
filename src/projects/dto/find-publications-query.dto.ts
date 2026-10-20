import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PublicationType } from '../../../generated/prisma/enums';
import {
  FACET_STATUS_FILTERS,
  type FacetStatusFilter,
} from './facet-status-filter';

export class FindPublicationsQueryDto {
  @IsOptional()
  @IsEnum(PublicationType)
  type?: PublicationType;

  @IsOptional()
  @IsIn(FACET_STATUS_FILTERS)
  status?: FacetStatusFilter;
}

import { IsIn, IsOptional } from 'class-validator';
import {
  FACET_STATUS_FILTERS,
  type FacetStatusFilter,
} from '../../common/dto/facet-status-filter';

export class FindPortfoliosQueryDto {
  @IsOptional()
  @IsIn(FACET_STATUS_FILTERS)
  status?: FacetStatusFilter;
}

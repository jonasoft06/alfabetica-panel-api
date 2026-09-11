import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class FindProjectsQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasPortfolio?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasPublication?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasProduction?: boolean;
}

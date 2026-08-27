import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PublicationType } from '../../../generated/prisma/enums';

export class CreatePortfolioInputDto {
  // Intentionally empty: creating a project only flags that a portfolio should
  // exist. Its fields are filled later via PUT /projects/:id/portfolio, but the
  // class exists so the body contract can grow without a breaking change.
}

export class CreatePublicationInputDto {
  @IsEnum(PublicationType)
  type: PublicationType;
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  client?: string;

  @IsOptional()
  @IsInt()
  issueYear?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePortfolioInputDto)
  portfolio?: CreatePortfolioInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePublicationInputDto)
  publication?: CreatePublicationInputDto;
}

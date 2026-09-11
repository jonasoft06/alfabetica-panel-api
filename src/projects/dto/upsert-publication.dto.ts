import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';
import { PublicationType } from '../../../generated/prisma/enums';

type ScopedFieldKind = 'integer' | 'number' | 'string';

function matchesKind(value: unknown, kind: ScopedFieldKind): boolean {
  switch (kind) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'string':
      return typeof value === 'string';
  }
}

// A field required (and validated as `kind`) when `type` is `scopedType`,
// and forbidden (must be null/absent) for every other type. Covers
// price/quantity for SALE and externalUrl for LINK.
@ValidatorConstraint({ name: 'requiredForPublicationType', async: false })
class RequiredForPublicationTypeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [scopedType, kind] = args.constraints as [
      PublicationType,
      ScopedFieldKind,
    ];
    const dto = args.object as UpsertPublicationDto;

    if (dto.type === scopedType) {
      return kind === 'string'
        ? typeof value === 'string' && value.trim().length > 0
        : matchesKind(value, kind);
    }

    return value === null || value === undefined;
  }

  defaultMessage(args: ValidationArguments): string {
    const [scopedType] = args.constraints as [PublicationType, ScopedFieldKind];
    return `${args.property} is required when type is ${scopedType} and must not be provided otherwise`;
  }
}

function RequiredForPublicationType(
  scopedType: PublicationType,
  kind: ScopedFieldKind,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [scopedType, kind],
      validator: RequiredForPublicationTypeConstraint,
    });
  };
}

// A field allowed (but optional) when `type` is `scopedType`, and forbidden
// (must be null/absent) for every other type. Covers sku/compareAtPrice,
// which are exclusive to SALE but never mandatory.
@ValidatorConstraint({ name: 'optionalForPublicationType', async: false })
class OptionalForPublicationTypeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    const [scopedType, kind] = args.constraints as [
      PublicationType,
      ScopedFieldKind,
    ];
    const dto = args.object as UpsertPublicationDto;

    return dto.type === scopedType && matchesKind(value, kind);
  }

  defaultMessage(args: ValidationArguments): string {
    const [scopedType] = args.constraints as [PublicationType, ScopedFieldKind];
    return `${args.property} is only allowed when type is ${scopedType}`;
  }
}

function OptionalForPublicationType(
  scopedType: PublicationType,
  kind: ScopedFieldKind,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [scopedType, kind],
      validator: OptionalForPublicationTypeConstraint,
    });
  };
}

// coverMediaId is intentionally absent: it's read-only from this endpoint,
// same as ProjectPortfolio.coverMediaId — it's written only by the dedicated
// cover flow.
export class UpsertPublicationDto {
  @IsOptional()
  @IsEnum(PublicationType)
  type?: PublicationType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authors?: string[];

  @IsOptional()
  @IsString()
  editionNumber?: string;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsString()
  collection?: string;

  @IsOptional()
  @IsString()
  measures?: string;

  @IsOptional()
  @IsString()
  presentation?: string;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @ValidateIf((o: UpsertPublicationDto) => o.type !== undefined)
  @OptionalForPublicationType(PublicationType.SALE, 'string')
  sku?: string;

  @ValidateIf((o: UpsertPublicationDto) => o.type !== undefined)
  @RequiredForPublicationType(PublicationType.SALE, 'number')
  price?: number;

  @ValidateIf((o: UpsertPublicationDto) => o.type !== undefined)
  @RequiredForPublicationType(PublicationType.SALE, 'integer')
  quantity?: number;

  @ValidateIf((o: UpsertPublicationDto) => o.type !== undefined)
  @OptionalForPublicationType(PublicationType.SALE, 'number')
  compareAtPrice?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @ValidateIf((o: UpsertPublicationDto) => o.type !== undefined)
  @RequiredForPublicationType(PublicationType.LINK, 'string')
  externalUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

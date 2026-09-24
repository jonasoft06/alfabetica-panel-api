import { Prisma } from '../../../generated/prisma/client';
import { PublicationType } from '../../../generated/prisma/enums';

export class PublicationDetailDto {
  id: string;
  slug: string;
  type: PublicationType;
  coverMediaId: string | null;
  authors: string[];
  editionNumber: string | null;
  format: string | null;
  collection: string | null;
  measures: string | null;
  presentation: string | null;
  audience: string | null;
  language: string | null;
  isbn: string | null;
  sku: string | null;
  price: Prisma.Decimal | null;
  quantity: number | null;
  compareAtPrice: Prisma.Decimal | null;
  currency: string | null;
  externalUrl: string | null;
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

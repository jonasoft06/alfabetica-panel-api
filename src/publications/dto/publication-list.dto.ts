import { Prisma } from '../../../generated/prisma/client';
import { PublicationType } from '../../../generated/prisma/enums';
import { MediaItemDto } from '../../media/dto/media-item.dto';

export class PublicationListItemDto {
  id: string;
  projectId: string;
  title: string;
  subtitle: string | null;
  slug: string;
  type: PublicationType;
  isPublished: boolean;
  price: Prisma.Decimal | null;
  currency: string | null;
  quantity: number | null;
  externalUrl: string | null;
  cover: MediaItemDto | null;
  sectionsCount: number;
  updatedAt: Date;
}

// counts cover every publication of an active project, regardless of the
// query filters, so the summary cards stay stable while filtering.
export class PublicationListResponseDto {
  items: PublicationListItemDto[];
  counts: {
    total: number;
    published: number;
    byType: Record<PublicationType, number>;
  };
}

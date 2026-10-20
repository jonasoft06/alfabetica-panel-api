import { MediaItemDto } from '../../media/dto/media-item.dto';

export class PortfolioListItemDto {
  id: string;
  projectId: string;
  title: string;
  subtitle: string | null;
  slug: string;
  isPublished: boolean;
  displayOrder: number | null;
  publishedAt: Date | null;
  cover: MediaItemDto | null;
  galleryCount: number;
  updatedAt: Date;
}

// counts cover every portfolio of an active project, regardless of the query
// filters, so the summary cards stay stable while filtering.
export class PortfolioListResponseDto {
  items: PortfolioListItemDto[];
  counts: {
    total: number;
    published: number;
    unpublished: number;
    withoutCover: number;
  };
  maxItems: number;
}

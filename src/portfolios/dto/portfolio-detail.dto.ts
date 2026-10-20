export class PortfolioDetailDto {
  id: string;
  slug: string;
  coverMediaId: string | null;
  isPublished: boolean;
  displayOrder: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

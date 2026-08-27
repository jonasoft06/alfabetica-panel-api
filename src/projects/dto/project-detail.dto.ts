export class ProjectDetailDto {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  client: string | null;
  issueYear: number | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  portfolio: {
    slug: string;
    coverUrl: string | null;
    isPublished: boolean;
    displayOrder: number | null;
    publishedAt: Date | null;
  } | null;
  publication: {
    id: string;
    slug: string;
    type: string;
    isPublished: boolean;
  } | null;
  production: {
    id: string;
    publicCode: string;
  } | null;
}

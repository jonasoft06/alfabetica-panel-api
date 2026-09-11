export class ProjectListItemDto {
  id: string;
  title: string;
  client: string | null;
  issueYear: number | null;
  createdAt: Date;
  isPublished: boolean;
  hasPortfolio: boolean;
  hasPublication: boolean;
  hasProduction: boolean;
}

export class PublicationSectionPdfDto {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
}

export class PublicationSectionDto {
  id: string;
  label: string;
  description: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  pdf: PublicationSectionPdfDto | null;
}

import { MediaType } from '../../../generated/prisma/enums';

// storageKey and status are internal: the client only ever needs the public
// URL, and only CONFIRMED media is returned.
export class MediaItemDto {
  id: string;
  type: MediaType;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  displayOrder: number | null;
  url: string;
  createdAt: Date;
}

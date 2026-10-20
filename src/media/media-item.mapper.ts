import { Prisma } from '../../generated/prisma/client';
import { StorageService } from '../storage/storage.service';
import type { MediaItemDto } from './dto/media-item.dto';

// Single source for every endpoint that returns media to the client (cover
// and gallery): select these fields, then map them with toMediaItem.
export const mediaItemSelect = {
  id: true,
  type: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  displayOrder: true,
  storageKey: true,
  createdAt: true,
} satisfies Prisma.ProjectMediaSelect;

type MediaItemRow = Prisma.ProjectMediaGetPayload<{
  select: typeof mediaItemSelect;
}>;

export function toMediaItem(
  storageService: StorageService,
  { storageKey, ...media }: MediaItemRow,
): MediaItemDto {
  return { ...media, url: storageService.publicUrl(storageKey) };
}

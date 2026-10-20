import { Prisma } from '../../generated/prisma/client';
import {
  MediaScope,
  MediaStatus,
  MediaType,
} from '../../generated/prisma/enums';
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

// For a cover read through its facet relation: a to-one relation cannot be
// filtered in the query, so status is selected and checked in toCoverItem.
export const coverItemSelect = {
  ...mediaItemSelect,
  status: true,
} satisfies Prisma.ProjectMediaSelect;

type MediaItemRow = Prisma.ProjectMediaGetPayload<{
  select: typeof mediaItemSelect;
}>;

type CoverItemRow = Prisma.ProjectMediaGetPayload<{
  select: typeof coverItemSelect;
}>;

export function toMediaItem(
  storageService: StorageService,
  { storageKey, ...media }: MediaItemRow,
): MediaItemDto {
  return { ...media, url: storageService.publicUrl(storageKey) };
}

// Only a CONFIRMED cover is exposed; status itself never leaves the API.
export function toCoverItem(
  storageService: StorageService,
  row: CoverItemRow | null,
): MediaItemDto | null {
  if (!row) {
    return null;
  }

  const { status, ...media } = row;

  return status === MediaStatus.CONFIRMED
    ? toMediaItem(storageService, media)
    : null;
}

// What counts as a gallery item for a facet. Covers and section PDFs are
// created with a null displayOrder, so this already leaves them out.
export function galleryMediaWhere(
  scope: MediaScope,
): Prisma.ProjectMediaWhereInput {
  return {
    scope,
    status: MediaStatus.CONFIRMED,
    type: MediaType.IMAGE,
    displayOrder: { not: null },
  };
}

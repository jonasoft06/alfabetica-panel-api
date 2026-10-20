import { MediaScope } from '../../generated/prisma/enums';
import type { CoverFacetConfig } from '../media/covers/cover.service';

// Exact pixel size a publication cover must have (square).
export const PUBLICATION_COVER_WIDTH = 1600;
export const PUBLICATION_COVER_HEIGHT = 1600;

export const PUBLICATION_COVER: CoverFacetConfig = {
  facet: 'publication',
  scope: MediaScope.PUBLICATION,
  width: PUBLICATION_COVER_WIDTH,
  height: PUBLICATION_COVER_HEIGHT,
  action: 'publication.cover_set',
  findByProject: (client, projectId) =>
    client.publication.findUnique({
      where: { projectId },
      select: { id: true, coverMediaId: true },
    }),
  setCover: (tx, facetId, mediaId, userId) =>
    tx.publication.updateMany({
      where: { id: facetId, coverMediaId: null },
      data: { coverMediaId: mediaId, updatedById: userId },
    }),
};

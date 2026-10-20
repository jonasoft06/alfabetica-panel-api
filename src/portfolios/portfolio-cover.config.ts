import { MediaScope } from '../../generated/prisma/enums';
import type { CoverFacetConfig } from '../media/covers/cover.service';

// Exact pixel size a portfolio cover must have (3:4 portrait).
export const PORTFOLIO_COVER_WIDTH = 1200;
export const PORTFOLIO_COVER_HEIGHT = 1600;

export const PORTFOLIO_COVER: CoverFacetConfig = {
  facet: 'portfolio',
  scope: MediaScope.PORTFOLIO,
  width: PORTFOLIO_COVER_WIDTH,
  height: PORTFOLIO_COVER_HEIGHT,
  action: 'portfolio.cover_set',
  findByProject: (client, projectId) =>
    client.portfolio.findUnique({
      where: { projectId },
      select: { id: true, coverMediaId: true },
    }),
  setCover: (tx, facetId, mediaId, userId) =>
    tx.portfolio.updateMany({
      where: { id: facetId, coverMediaId: null },
      data: { coverMediaId: mediaId, updatedById: userId },
    }),
};

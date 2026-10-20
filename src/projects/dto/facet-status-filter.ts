export const FACET_STATUS_FILTERS = ['published', 'unpublished'] as const;

export type FacetStatusFilter = (typeof FACET_STATUS_FILTERS)[number];

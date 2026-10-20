import type { PrismaClientLike } from '../../common/project-existence.util';

// Mirrors the schema default for SiteSettings.portfolioMaxItems, used when the
// singleton settings row has not been created yet.
const DEFAULT_PORTFOLIO_MAX_ITEMS = 10;

const SITE_SETTINGS_ID = 1;

export async function findPortfolioMaxItems(
  client: PrismaClientLike,
): Promise<number> {
  const settings = await client.siteSettings.findUnique({
    where: { id: SITE_SETTINGS_ID },
    select: { portfolioMaxItems: true },
  });

  return settings?.portfolioMaxItems ?? DEFAULT_PORTFOLIO_MAX_ITEMS;
}

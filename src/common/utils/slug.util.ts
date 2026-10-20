export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      // Strip the combining diacritical marks NFD split off (á -> a + U+0301).
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

// Appends -2, -3… to base until isTaken says the candidate is free. Each slug
// namespace (portfolios, publications) passes its own isTaken.
export async function uniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  // slugify() returns '' for titles with no alphanumeric characters.
  const root = base || 'project';
  let candidate = root;
  let suffix = 1;

  while (await isTaken(candidate)) {
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }

  return candidate;
}

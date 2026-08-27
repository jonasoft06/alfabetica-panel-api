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

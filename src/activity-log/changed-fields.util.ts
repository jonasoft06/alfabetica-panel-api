import { Prisma } from '../../generated/prisma/client';

function isSameValue(current: unknown, next: unknown): boolean {
  if (Array.isArray(current) && Array.isArray(next)) {
    return (
      current.length === next.length &&
      current.every((value, index) => value === next[index])
    );
  }

  // Decimal columns come back as Decimal instances while DTOs carry numbers.
  if (Prisma.Decimal.isDecimal(current)) {
    return (
      next !== null &&
      next !== undefined &&
      current.equals(next as number | string)
    );
  }

  return current === next;
}

// Names of the keys in `next` whose value differs from the stored row. Keys
// set to undefined are ignored, same as Prisma ignores them on update.
export function changedFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  return Object.entries(next)
    .filter(
      ([key, value]) =>
        value !== undefined && !isSameValue(current[key], value),
    )
    .map(([key]) => key);
}

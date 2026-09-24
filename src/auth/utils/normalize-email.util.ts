/**
 * Single normalization rule for emails, applied everywhere an address is stored
 * or compared. Firebase may hand back a different casing than the one the
 * administrator typed when inviting, and the `users.email` unique index is
 * case-sensitive, so both sides must agree on one form.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

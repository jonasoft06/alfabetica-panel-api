export interface AccessTokenPayload {
  sub: string;
  email: string;
  /** Team label only, never used for authorization. Null when no role is assigned. */
  role: string | null;
  permissions: string[];
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
}

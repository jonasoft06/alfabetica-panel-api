import { ForbiddenException } from '@nestjs/common';

/**
 * Stable reason codes for login/refresh rejections. The panel shows a different
 * screen per code, so these strings are part of the API contract: rename them
 * and the frontend breaks.
 */
export const AUTH_ERROR_CODES = {
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  USER_NOT_INVITED: 'USER_NOT_INVITED',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  USER_INACTIVE: 'USER_INACTIVE',
  ACCOUNT_CONFLICT: 'ACCOUNT_CONFLICT',
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  EMAIL_NOT_VERIFIED: 'Email address is not verified',
  USER_NOT_INVITED: 'This email has not been invited to the panel',
  INVITATION_EXPIRED: 'The invitation for this email has expired',
  USER_INACTIVE: 'This account is inactive',
  ACCOUNT_CONFLICT: 'This email is already linked to a different account',
};

/**
 * Keeps Nest's default error body ({ statusCode, message, error }) and adds the
 * machine-readable `code` on top, so existing clients keep working unchanged.
 */
export function authError(code: AuthErrorCode): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code,
    message: AUTH_ERROR_MESSAGES[code],
    error: 'Forbidden',
  });
}

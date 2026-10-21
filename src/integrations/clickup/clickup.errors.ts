// Thrown by ClickUpClient; callers translate them into HTTP responses. The
// ClickUp error body is logged server-side only and never carried here.

// Network failure, timeout, invalid token, rate limit or 5xx.
export class ClickUpUnavailableError extends Error {
  constructor() {
    super('ClickUp is unavailable');
    this.name = 'ClickUpUnavailableError';
  }
}

// The list does not exist or the token cannot see it. ClickUp answers both
// with 401 OAUTH_027 ("Team not authorized"), not 404.
export class ClickUpListNotFoundError extends Error {
  constructor() {
    super('ClickUp list not found');
    this.name = 'ClickUpListNotFoundError';
  }
}

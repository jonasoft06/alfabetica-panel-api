import { HttpException, HttpStatus } from '@nestjs/common';

// New endpoints answer errors with a machine `code` (the facets built before
// this still use `reason`). Messages stay generic: ClickUp details are logged
// server-side, never returned.
const PRODUCTION_ERRORS = {
  PRODUCTION_ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    message: 'Project already has a production',
  },
  PRODUCTION_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Project has no production',
  },
  PRODUCTION_MANAGED_BY_CLICKUP: {
    status: HttpStatus.CONFLICT,
    message: 'Production data is managed by ClickUp while a list is linked',
  },
  PRODUCTION_PHASE_NOT_FOUND: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Production phase not found',
  },
  PRODUCTION_INCONSISTENT_STATE: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Production status and phase are inconsistent',
  },
  PRODUCTION_NOT_LINKED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Production is not linked to a ClickUp list',
  },
  CLICKUP_LIST_ALREADY_LINKED: {
    status: HttpStatus.CONFLICT,
    message: 'ClickUp list is already linked to another production',
  },
  CLICKUP_LIST_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'ClickUp list not found',
  },
  CLICKUP_LIST_NOT_IN_PRODUCTION: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'ClickUp list is not in a production folder',
  },
  CLICKUP_LIST_UNMAPPED_STAGE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'ClickUp list stages cannot be mapped to production phases',
  },
  CLICKUP_UNAVAILABLE: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'ClickUp is unavailable',
  },
} as const;

export type ProductionErrorCode = keyof typeof PRODUCTION_ERRORS;

// Same body shape as auth errors: Nest's default fields plus `code`.
export function productionError(code: ProductionErrorCode): HttpException {
  const { status, message } = PRODUCTION_ERRORS[code];

  return new HttpException({ statusCode: status, code, message }, status);
}

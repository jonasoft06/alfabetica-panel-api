import { ProductionStatus } from '../../../generated/prisma/enums';

// Manual mode (no ClickUp list): status and phase are typed in by hand and
// kept consistent here. Pure, like production-state.ts.
//
//   PUBLISHED phase  <=>  FINISHED status
//   NOT_STARTED      =>   no phase
//   IN_PRODUCTION    =>   any phase but PUBLISHED, or none yet

export interface StatusAndPhase {
  status: ProductionStatus;
  phaseCode: string | null;
}

export class InconsistentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InconsistentStateError';
  }
}

const PUBLISHED = 'PUBLISHED';

function isConsistent({ status, phaseCode }: StatusAndPhase): boolean {
  if (status === ProductionStatus.FINISHED) {
    return phaseCode === PUBLISHED;
  }
  if (status === ProductionStatus.NOT_STARTED) {
    return phaseCode === null;
  }
  return phaseCode !== PUBLISHED;
}

// Merges what the request sends (undefined = not sent) onto the current
// values. Setting one side adjusts the other; sending both requires them to
// agree.
export function resolveStatusAndPhase(
  current: StatusAndPhase,
  input: { status?: ProductionStatus; phaseCode?: string | null },
): StatusAndPhase {
  const hasStatus = input.status !== undefined;
  const hasPhase = input.phaseCode !== undefined;

  if (hasStatus && hasPhase) {
    const next = {
      status: input.status as ProductionStatus,
      phaseCode: input.phaseCode as string | null,
    };
    if (!isConsistent(next)) {
      throw new InconsistentStateError(
        `Status ${next.status} does not allow phase ${next.phaseCode ?? 'none'}`,
      );
    }
    return next;
  }

  if (hasStatus) {
    const status = input.status as ProductionStatus;

    if (status === ProductionStatus.FINISHED) {
      return { status, phaseCode: PUBLISHED };
    }
    if (status === ProductionStatus.NOT_STARTED) {
      return { status, phaseCode: null };
    }
    // Back to IN_PRODUCTION from FINISHED: which phase it is in is unknown, so
    // it is left unset rather than guessed.
    return {
      status,
      phaseCode: current.phaseCode === PUBLISHED ? null : current.phaseCode,
    };
  }

  if (hasPhase) {
    const phaseCode = input.phaseCode as string | null;

    if (phaseCode === PUBLISHED) {
      return { status: ProductionStatus.FINISHED, phaseCode };
    }
    if (phaseCode === null) {
      // FINISHED needs PUBLISHED; clearing it leaves no status to infer.
      if (current.status === ProductionStatus.FINISHED) {
        throw new InconsistentStateError(
          'A finished production keeps PUBLISHED',
        );
      }
      return { status: current.status, phaseCode };
    }
    // Any other phase means the book is being worked on.
    return { status: ProductionStatus.IN_PRODUCTION, phaseCode };
  }

  return current;
}

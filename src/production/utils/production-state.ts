import { BookType } from '../../../generated/prisma/enums';
import type { ClickUpStageTask } from '../../integrations/clickup/clickup.types';
import { phaseForStage, type PhaseCode } from './phase-mapping';

// Where a production is, derived from its ClickUp list. Pure: no I/O, so the
// rules can be read (and tested) in isolation.
export interface InProductionState {
  bookType: BookType;
  phase: PhaseCode;
  currentStageName: string;
  // YYYY-MM-DD or null; a stage without due date is normal.
  currentStageDueDate: string | null;
  estimatedEndDate: string | null;
}

// The list cannot be turned into a state: no numbered stages, or a stage
// number outside the phase mapping.
export class UnmappedStagesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnmappedStagesError';
  }
}

export function computeInProductionState(
  bookType: BookType,
  tasks: ClickUpStageTask[],
): InProductionState {
  if (tasks.length === 0) {
    throw new UnmappedStagesError('List has no numbered stages');
  }

  const unmapped = tasks.filter(
    (task) => phaseForStage(bookType, task.number) === null,
  );
  if (unmapped.length > 0) {
    throw new UnmappedStagesError(
      `Stage numbers outside the ${bookType} mapping: ${unmapped
        .map((task) => task.number)
        .join(', ')}`,
    );
  }

  const ordered = [...tasks].sort((a, b) => a.number - b.number);
  const last = ordered[ordered.length - 1];
  // Active stage = lowest-numbered task not done yet.
  const active = ordered.find((task) => !task.isDone);

  return {
    bookType,
    // Everything done but the list not archived yet: it is at the printer.
    phase: active
      ? (phaseForStage(bookType, active.number) as PhaseCode)
      : 'PRINTING',
    currentStageName: (active ?? last).name,
    currentStageDueDate: (active ?? last).dueDate,
    estimatedEndDate: last.dueDate,
  };
}

// YYYY-MM-DD -> Date at UTC midnight, which Prisma stores as that same day in
// a @db.Date column.
export function toDbDate(date: string | null): Date | null {
  return date === null ? null : new Date(`${date}T00:00:00.000Z`);
}

// Inverse of toDbDate: a @db.Date column comes back as UTC midnight, so its
// ISO date part is the stored calendar day. Responses carry YYYY-MM-DD, never
// a timestamp, so no client shifts the day by its own timezone.
export function fromDbDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

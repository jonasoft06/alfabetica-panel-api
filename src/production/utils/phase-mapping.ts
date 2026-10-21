import { BookType } from '../../../generated/prisma/enums';

// Codes of the seeded ProductionPhase catalog (prisma/seed.ts).
export type PhaseCode =
  | 'CONTENT_REVIEW'
  | 'COPYEDITING'
  | 'LAYOUT'
  | 'FINAL_REVIEW'
  | 'PRINTING'
  | 'PUBLISHED';

interface StageRange {
  from: number;
  to: number;
  phase: PhaseCode;
}

// ClickUp stage number -> client-facing phase, per book type. A stage number
// outside these ranges means the ClickUp template changed and the mapping has
// to be updated here.
const PHASE_RANGES: Record<BookType, StageRange[]> = {
  ACADEMIC: [
    { from: 1, to: 1, phase: 'CONTENT_REVIEW' },
    { from: 2, to: 2, phase: 'COPYEDITING' },
    { from: 3, to: 7, phase: 'LAYOUT' },
    { from: 8, to: 9, phase: 'FINAL_REVIEW' },
    { from: 10, to: 12, phase: 'PRINTING' },
  ],
  TEXTBOOK: [
    { from: 1, to: 2, phase: 'CONTENT_REVIEW' },
    { from: 3, to: 3, phase: 'COPYEDITING' },
    { from: 4, to: 9, phase: 'LAYOUT' },
    { from: 10, to: 13, phase: 'FINAL_REVIEW' },
    { from: 14, to: 16, phase: 'PRINTING' },
  ],
};

export function phaseForStage(
  bookType: BookType,
  stageNumber: number,
): PhaseCode | null {
  const range = PHASE_RANGES[bookType].find(
    ({ from, to }) => stageNumber >= from && stageNumber <= to,
  );
  return range?.phase ?? null;
}

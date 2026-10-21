import type { ClickUpRawTask, ClickUpStageTask } from './clickup.types';

// Stage tasks are named "07 · Captura de correcciones 2as pruebas". The number
// is the stage; orderindex is not used because it changes when tasks are
// dragged around in ClickUp.
const STAGE_NUMBER_PATTERN = /^(\d{1,2})\s*·/;

// ClickUp status names are free text (lowercase Spanish here); the type is the
// stable part.
const DONE_STATUS_TYPES = new Set(['closed', 'done']);

const mexicoCityDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toMexicoCityDate(dueDate: string | null): string | null {
  if (dueDate === null) {
    return null;
  }

  const ms = Number(dueDate);
  // en-CA formats as YYYY-MM-DD.
  return Number.isFinite(ms) ? mexicoCityDate.format(new Date(ms)) : null;
}

// Maps a raw task to the only fields the API keeps. Returns null for tasks
// without a stage number, which are ignored.
export function toStageTask(task: ClickUpRawTask): ClickUpStageTask | null {
  const match = STAGE_NUMBER_PATTERN.exec(task.name.trim());

  if (!match) {
    return null;
  }

  return {
    number: Number(match[1]),
    name: task.name.trim(),
    isDone: DONE_STATUS_TYPES.has(task.status?.type ?? ''),
    dueDate: toMexicoCityDate(task.due_date),
  };
}

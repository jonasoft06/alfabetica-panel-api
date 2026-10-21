// Raw ClickUp API v2 shapes (input model). Only the fields this integration
// reads are declared; they never leave src/integrations/clickup — callers get
// the mapped types below.

export interface ClickUpRawList {
  id: string;
  folder: { id: string } | null;
}

export interface ClickUpRawTask {
  name: string;
  status: { type: string } | null;
  // Milliseconds since epoch, as a string, or null when unset.
  due_date: string | null;
}

export interface ClickUpRawTasksPage {
  tasks: ClickUpRawTask[];
  last_page?: boolean;
}

export interface ClickUpRawError {
  err?: string;
  ECODE?: string;
}

// Mapped output model: everything the rest of the API may know about ClickUp.

export interface ClickUpList {
  id: string;
  folderId: string | null;
}

export interface ClickUpStageTask {
  // Stage number parsed from the task name ("07 · …" -> 7).
  number: number;
  name: string;
  isDone: boolean;
  // YYYY-MM-DD in America/Mexico_City, or null.
  dueDate: string | null;
}

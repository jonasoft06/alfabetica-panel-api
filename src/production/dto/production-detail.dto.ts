import { BookType, ProductionStatus } from '../../../generated/prisma/enums';

export type ProductionSource = 'CLICKUP' | 'MANUAL';

export class ProductionPhaseRefDto {
  code: string;
  label: string;
}

// Returned by every /projects/:projectId/production endpoint.
export class ProductionDetailDto {
  id: string;
  projectId: string;
  publicCode: string;
  authorName: string | null;
  clickupListId: string | null;
  bookType: BookType | null;
  // CLICKUP while a list is linked (data read from ClickUp), MANUAL otherwise.
  source: ProductionSource;
  status: ProductionStatus;
  currentPhase: ProductionPhaseRefDto | null;
  currentStageName: string | null;
  // YYYY-MM-DD (calendar dates, not timestamps).
  currentStageDueDate: string | null;
  estimatedEndDate: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

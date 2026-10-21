import { BookType, ProductionStatus } from '../../../generated/prisma/enums';

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

import { BookType, ProductionStatus } from '../../../generated/prisma/enums';
import { ProductionPhaseRefDto } from './production-detail.dto';

// Item of GET /productions.
export class ProductionListItemDto {
  projectId: string;
  projectTitle: string;
  publicCode: string;
  authorName: string | null;
  status: ProductionStatus;
  bookType: BookType | null;
  currentPhase: ProductionPhaseRefDto | null;
  currentStageName: string | null;
  // YYYY-MM-DD (calendar dates, not timestamps).
  currentStageDueDate: string | null;
  estimatedEndDate: string | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
}

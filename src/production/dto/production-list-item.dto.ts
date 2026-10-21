import { BookType, ProductionStatus } from '../../../generated/prisma/enums';
import type {
  ProductionPhaseRefDto,
  ProductionSource,
} from './production-detail.dto';

// Item of GET /productions.
export class ProductionListItemDto {
  projectId: string;
  projectTitle: string;
  publicCode: string;
  authorName: string | null;
  // CLICKUP while a list is linked (data read from ClickUp), MANUAL otherwise.
  source: ProductionSource;
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

import { Prisma } from '../../generated/prisma/client';

export type ActivityEntityType =
  'project' | 'portfolio' | 'publication' | 'media';

// Stable keys: stored as-is and queried by the panel, so never rename one.
export type ActivityAction =
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'portfolio.create'
  | 'portfolio.update'
  | 'portfolio.delete'
  | 'portfolio.publish'
  | 'portfolio.unpublish'
  | 'portfolio.cover_set'
  | 'publication.create'
  | 'publication.update'
  | 'publication.delete'
  | 'publication.cover_set'
  | 'publication.section_create'
  | 'publication.section_update'
  | 'publication.section_delete'
  | 'publication.sections_reorder'
  | 'publication.section_pdf_set'
  | 'publication.section_pdf_removed'
  | 'media.confirm'
  | 'media.delete'
  | 'media.cleanup';

export interface ActivityLogEntry {
  actorId: string;
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId: string;
  projectId?: string;
  // Small summaries only (changed field names, counts) — never whole rows.
  metadata?: Prisma.InputJsonObject;
}

// Takes the transaction client of the action being logged, so the log row and
// the change it describes commit or roll back together.
export async function logActivity(
  tx: Prisma.TransactionClient,
  entry: ActivityLogEntry,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      projectId: entry.projectId,
      metadata: entry.metadata,
    },
  });
}

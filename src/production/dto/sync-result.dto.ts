// Response of POST /productions/sync. Counts only: which production failed
// and why is in the server log.
export class SyncResultDto {
  syncedAt: Date;
  updated: number;
  failed: number;
}

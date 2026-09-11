import { StorageService } from './storage.service';

export async function deleteStorageObjectSilently(
  storageService: StorageService,
  storageKey: string,
): Promise<void> {
  try {
    await storageService.deleteObject(storageKey);
  } catch {
    // Orphaned object in Spaces is harmless; the DB is already consistent.
  }
}

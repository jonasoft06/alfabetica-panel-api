import { MediaScope } from '../../generated/prisma/enums';

interface BuildStorageKeyParams {
  scope: MediaScope;
  projectId: string;
  mediaId: string;
  extension: string;
}

// Spaces' bucket policy is applied once over public/* — private files will
// later live under private/, uncovered by that policy.
export function buildStorageKey({
  scope,
  projectId,
  mediaId,
  extension,
}: BuildStorageKeyParams): string {
  return `public/${scope.toLowerCase()}/${projectId}/${mediaId}.${extension}`;
}

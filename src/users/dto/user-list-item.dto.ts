import { UserStatus } from '../../../generated/prisma/enums';

// Shape of every collaborator returned by GET /users, POST /users/invitations
// and PATCH /users/:id/status.
export class UserListItemDto {
  id: string;
  name: string | null;
  email: string;
  status: UserStatus;
  // Team label only; authorization comes from `permissions`.
  role: { id: string; name: string } | null;
  permissions: string[];
  lastLogin: Date | null;
  invitedAt: Date | null;
  invitationExpiresAt: Date | null;
  createdAt: Date;
}

import { IsIn } from 'class-validator';
import { UserStatus } from '../../../generated/prisma/enums';

// INVITED is never set by hand: a user only becomes INVITED when invited.
const SETTABLE_STATUSES = [UserStatus.ACTIVE, UserStatus.INACTIVE] as const;

export class UpdateUserStatusDto {
  @IsIn(SETTABLE_STATUSES)
  status: (typeof SETTABLE_STATUSES)[number];
}

import { IsUUID } from 'class-validator';

export class ConfirmCoverDto {
  @IsUUID()
  mediaId: string;
}

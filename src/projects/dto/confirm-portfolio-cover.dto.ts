import { IsUUID } from 'class-validator';

export class ConfirmPortfolioCoverDto {
  @IsUUID()
  mediaId: string;
}

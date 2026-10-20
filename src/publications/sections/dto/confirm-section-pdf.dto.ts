import { IsUUID } from 'class-validator';

export class ConfirmSectionPdfDto {
  @IsUUID()
  mediaId: string;
}

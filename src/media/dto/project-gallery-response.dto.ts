import { MediaScope } from '../../../generated/prisma/enums';
import { MediaItemDto } from './media-item.dto';

export class ProjectGalleryResponseDto {
  scope: MediaScope;
  items: MediaItemDto[];
}

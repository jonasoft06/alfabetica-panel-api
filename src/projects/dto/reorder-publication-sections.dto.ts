import { IsArray, IsUUID } from 'class-validator';

export class ReorderPublicationSectionsDto {
  // Every section of the publication exactly once, in the new order. Missing,
  // extra or duplicate ids are checked in the service so the failure carries
  // the SECTIONS_ORDER_MISMATCH reason.
  @IsArray()
  @IsUUID('all', { each: true })
  sectionIds: string[];
}

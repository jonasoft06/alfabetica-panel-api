import { IsEnum } from 'class-validator';
import { MediaScope } from '../../../generated/prisma/enums';

export class FindProjectMediaQueryDto {
  @IsEnum(MediaScope)
  scope: MediaScope;
}

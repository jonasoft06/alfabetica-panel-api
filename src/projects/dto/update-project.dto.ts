import { PartialType, PickType } from '@nestjs/mapped-types';
import { CreateProjectDto } from './create-project.dto';

// Only the core fields are updatable here. Portfolio and publication are
// managed through their own endpoints, so they are excluded from the pick.
export class UpdateProjectDto extends PartialType(
  PickType(CreateProjectDto, [
    'title',
    'subtitle',
    'description',
    'client',
    'issueYear',
    'tags',
  ] as const),
) {}

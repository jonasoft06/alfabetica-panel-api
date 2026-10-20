import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { FindPublicationsQueryDto } from './dto/find-publications-query.dto';
import type { PublicationListResponseDto } from './dto/publication-list.dto';
import { PublicationsService } from './publications.service';

@Controller('publications')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PublicationsController {
  constructor(private readonly publicationsService: PublicationsService) {}

  // Read-only, same as the other facet GETs: any authenticated user.
  @Get()
  async findAll(
    @Query() query: FindPublicationsQueryDto,
  ): Promise<PublicationListResponseDto> {
    return this.publicationsService.findAll(query);
  }
}

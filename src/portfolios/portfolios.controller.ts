import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { FindPortfoliosQueryDto } from './dto/find-portfolios-query.dto';
import type { PortfolioListResponseDto } from './dto/portfolio-list.dto';
import { PortfoliosService } from './portfolios.service';

@Controller('portfolios')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PortfoliosController {
  constructor(private readonly portfoliosService: PortfoliosService) {}

  // Read-only, same as the other facet GETs: any authenticated user.
  @Get()
  async findAll(
    @Query() query: FindPortfoliosQueryDto,
  ): Promise<PortfolioListResponseDto> {
    return this.portfoliosService.findAll(query);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import type { CreateMediaResult } from '../media/media.service';
import { ConfirmSectionPdfDto } from './dto/confirm-section-pdf.dto';
import { CreatePublicationSectionDto } from './dto/create-publication-section.dto';
import { CreateSectionPdfDto } from './dto/create-section-pdf.dto';
import type { PublicationSectionDto } from './dto/publication-section.dto';
import { ReorderPublicationSectionsDto } from './dto/reorder-publication-sections.dto';
import { UpdatePublicationSectionDto } from './dto/update-publication-section.dto';
import { PublicationSectionsService } from './publication-sections.service';

@Controller('projects/:id/publication/sections')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PublicationSectionsController {
  constructor(private readonly sectionsService: PublicationSectionsService) {}

  // Read-only, same as the other facet GETs: any authenticated user.
  @Get()
  async findAll(@Param('id') id: string): Promise<PublicationSectionDto[]> {
    return this.sectionsService.findAll(id);
  }

  @Post()
  @RequirePermissions('publication')
  async create(
    @Param('id') id: string,
    @Body() dto: CreatePublicationSectionDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PublicationSectionDto> {
    return this.sectionsService.create(id, dto, user.sub);
  }

  // Declared before the :sectionId routes so "order" is never captured as a
  // section id.
  @Put('order')
  @RequirePermissions('publication')
  async reorder(
    @Param('id') id: string,
    @Body() dto: ReorderPublicationSectionsDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PublicationSectionDto[]> {
    return this.sectionsService.reorder(id, dto, user.sub);
  }

  @Patch(':sectionId')
  @RequirePermissions('publication')
  async update(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdatePublicationSectionDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PublicationSectionDto> {
    return this.sectionsService.update(id, sectionId, dto, user.sub);
  }

  @Delete(':sectionId')
  @RequirePermissions('publication')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<void> {
    return this.sectionsService.remove(id, sectionId, user.sub);
  }

  // Same two-step contract as the cover routes: create a PENDING media row and
  // upload to the presigned URL, then confirm to link it to the section.
  // Removing the PDF goes through DELETE /media/:id.
  @Post(':sectionId/pdf')
  @RequirePermissions('publication')
  async createPdf(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: CreateSectionPdfDto,
  ): Promise<CreateMediaResult> {
    return this.sectionsService.createPdf(id, sectionId, dto);
  }

  @Patch(':sectionId/pdf/confirm')
  @RequirePermissions('publication')
  async confirmPdf(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: ConfirmSectionPdfDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PublicationSectionDto> {
    return this.sectionsService.confirmPdf(
      id,
      sectionId,
      dto.mediaId,
      user.sub,
    );
  }
}

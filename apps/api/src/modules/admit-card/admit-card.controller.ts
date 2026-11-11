import { Body, Controller, Get, Header, HttpCode, Post, Query, StreamableFile } from '@nestjs/common';
import type { AdmitCard, AdmitCardPdfStatus } from '@sirat/shared';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AdmitCardPdfDto } from './admit-card-pdf.dto';
import { AdmitCardPdfService } from './admit-card-pdf.service';
import { AdmitCardService } from './admit-card.service';

/** The caller's own admit card (06-API "Admit card"). No id: the user comes from the session. */
@Controller('admit-card')
@Roles('student', 'ambassador')
export class AdmitCardController {
  constructor(
    private readonly admitCard: AdmitCardService,
    private readonly pdf: AdmitCardPdfService,
  ) {}

  /** The full participant ID is in this answer: never cached by a browser or a proxy. */
  @Get()
  @Header('Cache-Control', 'no-store')
  mine(@CurrentUser() user: AuthUser): Promise<AdmitCard> {
    return this.admitCard.forUser(user.id);
  }

  /** Asks for the PDF (core A2): `ready` now, or `pending` while the worker renders it. */
  @Post('pdf')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  requestPdf(@CurrentUser() user: AuthUser, @Body() body: AdmitCardPdfDto): Promise<AdmitCardPdfStatus> {
    return this.pdf.request(user.id, body.locale);
  }

  /** The PDF holds the full participant ID: the owner's only, never cached, saved as a file. */
  @Get('pdf')
  @Header('Cache-Control', 'no-store')
  async downloadPdf(@CurrentUser() user: AuthUser, @Query() query: AdmitCardPdfDto): Promise<StreamableFile> {
    const file = await this.pdf.file(user.id, query.locale);
    return new StreamableFile(file, {
      type: 'application/pdf',
      disposition: 'attachment; filename="admit-card.pdf"',
      length: file.length,
    });
  }
}

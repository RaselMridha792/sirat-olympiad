import { ADMIT_CARD_PDF_LOCALES, type AdmitCardPdfLocale } from '@sirat/shared';
import { IsIn } from 'class-validator';

/** POST /admit-card/pdf (body) and GET /admit-card/pdf (query): the PDF's language, the page's own. */
export class AdmitCardPdfDto {
  @IsIn(ADMIT_CARD_PDF_LOCALES)
  locale!: AdmitCardPdfLocale;
}

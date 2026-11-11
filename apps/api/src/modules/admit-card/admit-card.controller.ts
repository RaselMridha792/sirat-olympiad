import { Controller, Get, Header } from '@nestjs/common';
import type { AdmitCard } from '@sirat/shared';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AdmitCardService } from './admit-card.service';

/** The caller's own admit card (06-API "Admit card"). No id: the user comes from the session. */
@Controller('admit-card')
@Roles('student', 'ambassador')
export class AdmitCardController {
  constructor(private readonly admitCard: AdmitCardService) {}

  /** The full participant ID is in this answer: never cached by a browser or a proxy. */
  @Get()
  @Header('Cache-Control', 'no-store')
  mine(@CurrentUser() user: AuthUser): Promise<AdmitCard> {
    return this.admitCard.forUser(user.id);
  }
}

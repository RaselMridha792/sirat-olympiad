import { Module } from '@nestjs/common';
import { AdmitCardController } from './admit-card.controller';
import { AdmitCardService } from './admit-card.service';

/**
 * The admit card (core A1): one read of the caller's own registration (payments'), name, category and class, and
 * exam's next round exam. The PDF (A2) reuses the service. Contract: docs/06-API.md "Admit card".
 */
@Module({
  controllers: [AdmitCardController],
  providers: [AdmitCardService],
  exports: [AdmitCardService],
})
export class AdmitCardModule {}

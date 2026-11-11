import { Module } from '@nestjs/common';
import { AdmitCardPdfQueue } from './admit-card-pdf.queue';
import { AdmitCardPdfService } from './admit-card-pdf.service';
import { AdmitCardController } from './admit-card.controller';
import { AdmitCardService } from './admit-card.service';

/**
 * The admit card (core A1): one read of the caller's own registration (payments'), name, category and class, and
 * exam's next round exam. The PDF (A2) reuses the service: the API queues it, the worker renders it
 * (AdmitCardPdfWorkerModule, worker.ts). Contract: docs/06-API.md "Admit card".
 */
@Module({
  controllers: [AdmitCardController],
  providers: [AdmitCardService, AdmitCardPdfService, AdmitCardPdfQueue],
  exports: [AdmitCardService],
})
export class AdmitCardModule {}

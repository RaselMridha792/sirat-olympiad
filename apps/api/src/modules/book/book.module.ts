import { Module } from '@nestjs/common';
import { AdminBookController, BookController } from './book.controller';
import { BookService } from './book.service';

/**
 * The free book after payment (docs/plans/PAYMENTS-PLAN.md section 16). Imported by PaymentsModule, so
 * app.module.ts does not change (plan 16.9).
 */
@Module({
  controllers: [BookController, AdminBookController],
  providers: [BookService],
})
export class BookModule {}

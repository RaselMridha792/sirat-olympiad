import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsCoreModule } from '../payments/payments-core.module';
import { AdminDemoController } from './demo.controller';
import { DemoQueue } from './demo.queue';
import { DemoService } from './demo.service';

/**
 * Demo data, loaded and removed with one click (DECISIONS 2026-11-08): the admin card's API. The jobs run in the
 * worker (demo.worker.ts); the CLI (src/cli/demo.ts) does the same at the server.
 */
@Module({
  imports: [AuthModule, PaymentsCoreModule],
  controllers: [AdminDemoController],
  providers: [DemoService, DemoQueue],
})
export class DemoModule {}

import { Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { BackgroundModule } from '../../common/background/background-tasks';
import { PrismaModule } from '../../prisma/prisma.module';
import { REDIS_CACHE, RedisModule } from '../../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import {
  AdminPaymentsController,
  AdminSettingsController,
} from './admin/admin-payments.controller';
import { AdminPaymentsService } from './admin/admin-payments.service';
import { AdminSettingsService } from './admin/admin-settings.service';
import { PaymentsCoreModule } from './payments-core.module';
import { PaymentsBootCheck } from './payments-boot-check';
import { PayStationHooks } from './paystation/paystation-hooks.service';
import { PayStationController } from './paystation/paystation.controller';
import {
  MyPaymentsController,
  RegistrationController,
} from './registration/registration.controller';
import { RegistrationGuards } from './registration/registration-guards';
import { RegistrationService } from './registration/registration.service';
import { PaymentReconciler } from './verify/payment-reconciler';
import { PaymentVerifier } from './verify/payment-verifier';
import { PaymentsWorker } from './verify/payments.worker';

export { PAYMENT_CONFIG } from './payments-boot-check';

/** Start or retry attempts one email or one phone may make per hour (the IP has its own throttle tier). */
const ATTEMPTS_PER_HOUR = 10;

/**
 * Registration and PayStation payments, API side (docs/plans/PAYMENTS-PLAN.md): registration, the callback and IPN,
 * the student's own payments, and the admin payments and settings. Status checks never run here: they go to the
 * worker's queue (PaymentsWorkerModule). Everything lives in this module, so app.module.ts does not change (plan D10).
 */
@Module({
  imports: [PaymentsCoreModule, AuthModule],
  controllers: [
    RegistrationController,
    MyPaymentsController,
    PayStationController,
    AdminPaymentsController,
    AdminSettingsController,
  ],
  providers: [
    {
      provide: RegistrationGuards,
      inject: [REDIS_CACHE],
      useFactory: (redis: Redis) => new RegistrationGuards(redis, ATTEMPTS_PER_HOUR),
    },
    PaymentsBootCheck,
    RegistrationService,
    PayStationHooks,
    AdminPaymentsService,
    AdminSettingsService,
  ],
  exports: [PaymentsCoreModule, RegistrationService],
})
export class PaymentsModule {}

/** Worker side (worker.ts): verify jobs and the reconciliation scheduler (plan 6.3, 6.5). */
@Module({
  imports: [PrismaModule, RedisModule, BackgroundModule, PaymentsCoreModule],
  providers: [PaymentVerifier, PaymentReconciler, PaymentsWorker],
})
export class PaymentsWorkerModule {}

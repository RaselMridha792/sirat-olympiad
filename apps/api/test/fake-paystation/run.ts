/**
 * Runs the fake PayStation on this machine for local development (DEV ONLY; plan D5):
 *   pnpm --filter @sirat/api exec tsx test/fake-paystation/run.ts
 * with PAYSTATION_ENV=fake and PAYSTATION_BASE_URL=http://127.0.0.1:18090 in apps/api/.env. Optional:
 * FAKE_PAYSTATION_PORT, FAKE_PAYSTATION_IPN_URL (where Pay posts the IPN). Any credentials are accepted.
 * Scenarios: POST http://127.0.0.1:18090/__fake/scenario with JSON (see FakeScenario), POST /__fake/reset.
 */
import { startFakePaystation } from './fake-paystation';

startFakePaystation({
  port: Number(process.env.FAKE_PAYSTATION_PORT ?? 18090),
  ipnUrl: process.env.FAKE_PAYSTATION_IPN_URL || undefined,
})
  .then((fake) => console.log(`fake PayStation on ${fake.url} (DEV ONLY)`))
  .catch((err: unknown) => {
    console.error(
      'fake PayStation failed to start:',
      err instanceof Error ? err.message : 'unknown',
    );
    process.exit(1);
  });

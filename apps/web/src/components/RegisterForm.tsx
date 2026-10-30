'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Field } from '@sirat/ui';

/**
 * Registration is a 3-step wizard (details -> education -> account), then PayStation payment.
 * Old UI: reference/zero-olympiad-ui/app/registration-full/Step1_Auth, Step2_Auth, Step3_Auth.
 * RULES: never send `role` from the client; form data is stored SERVER-SIDE against the pending
 * payment (not only localStorage); grade->category mapping is done by the server from a config table.
 * This scaffold only renders step 1 so layout and fields can be checked.
 */
export function RegisterForm() {
  const [step] = useState(1);
  return (
    <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
      <h2 className="text-center text-3xl font-bold">Create account</h2>
      <p className="text-center text-sm text-ink-muted">Step {step} of 3 — your details</p>
      <Field label="Full name" name="name" required />
      <Field label="Phone" name="phone" type="tel" required />
      <Field label="District" name="district" required />
      <Field label="Institution" name="institution" required />
      <Field label="Referral code (optional)" name="promoCode" />
      <Button type="submit" size="lg" className="w-full">Continue</Button>
      <p className="text-center text-sm text-ink-muted">
        Already registered?{' '}
        <Link href="/login" className="font-bold text-secondary hover:underline">Sign in</Link>
      </p>
    </form>
  );
}

import type { Metadata } from 'next';
import { Button, Field } from '@sirat/ui';

export const metadata: Metadata = { title: 'Forgot password' };
export default function ForgotPasswordPage() {
  // Response must be identical whether or not the email exists (no account enumeration).
  return (
    <form className="space-y-5">
      <h2 className="text-center text-3xl font-bold">Reset password</h2>
      <Field label="Email" name="email" type="email" required />
      <Button type="submit" size="lg" className="w-full">Send reset link</Button>
    </form>
  );
}

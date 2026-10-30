'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock } from 'lucide-react';
import { Button, Field } from '@sirat/ui';
import { api, ApiRequestError } from '@/lib/api';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      router.replace('/dashboard'); // cookie is set by the server; no token handling here
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <h2 className="text-center text-3xl font-bold">Sign in</h2>
      <p className="text-center text-sm text-ink-muted">Log in to your account to continue.</p>
      <Field label="Email" name="email" type="email" autoComplete="email" required value={email}
        onChange={(e) => setEmail(e.target.value)} icon={<Mail size={18} />} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required
        value={password} onChange={(e) => setPassword(e.target.value)} icon={<Lock size={18} />} />
      <Link href="/forgot-password" className="block text-sm font-semibold text-secondary hover:underline">
        Forgot password?
      </Link>
      {error ? <p role="alert" className="text-center text-sm font-medium text-danger">{error}</p> : null}
      <Button type="submit" size="lg" loading={loading} className="w-full">Sign in</Button>
      <p className="text-center text-sm text-ink-muted">
        No account?{' '}
        <Link href="/register" className="font-bold text-secondary hover:underline">Register</Link>
      </p>
    </form>
  );
}

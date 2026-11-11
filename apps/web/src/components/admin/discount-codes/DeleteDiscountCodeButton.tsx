'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminDiscountCodesMessages } from '@/i18n/messages/admin-discount-codes';
import { api, SessionExpiredError } from '@/lib/api';
import { discountCodeProblem, type DiscountCodeProblem } from './discount-code-problem';

/** Deletes a code nobody has used (DELETE /api/admin/discount-codes/:id); a used one answers CODE_IN_USE. */
export function DeleteDiscountCodeButton({ locale, id }: { locale: Locale; id: string }) {
  const m = pick(adminDiscountCodesMessages, locale);
  const r = m.remove;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<DiscountCodeProblem | null>(null);

  async function remove() {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      await api<void>(`/admin/discount-codes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setOpen(false);
      router.push('/admin/discount-codes');
      router.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      setProblem(discountCodeProblem(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {r.button}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={r.title}
        closeLabel={r.cancel}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{r.text}</p>
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {r.cancel}
            </Button>
            <Button type="button" variant="danger" onClick={() => void remove()} disabled={pending}>
              {pending ? r.pending : r.confirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

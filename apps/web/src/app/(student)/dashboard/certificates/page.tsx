import type { Metadata } from 'next';
import Link from 'next/link';
import { Medal } from 'lucide-react';
import { Badge, Card, EmptyState, PageHeader } from '@sirat/ui';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { formatDate } from '@/i18n/format';
import { certificatesMessages } from '@/i18n/messages/certificates';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(certificatesMessages);
  return { title: m.student.title };
}

/**
 * The student's certificates (core C6c-1, old dashboard/certificates): the award, the number, the check code with a
 * link to the public check. The PDF comes with C6c-2 (the owner approves its library first).
 */
export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/dashboard/certificates');
  const params = await searchParams;
  const [{ locale, m }, data] = await Promise.all([
    getMessages(certificatesMessages),
    getData(params),
  ]);
  const list = await data.student.listMyCertificates();

  return (
    <>
      <PageHeader title={m.student.title} subtitle={m.student.subtitle} />
      {list.length === 0 ? (
        <EmptyState
          icon={<Medal aria-hidden="true" size={24} />}
          title={m.student.empty.title}
          description={m.student.empty.text}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.map((c) => (
            <li key={c.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-lg font-bold text-ink">{m.types[c.type]}</h2>
                  {c.revoked ? <Badge tone="neutral">{m.student.revoked}</Badge> : null}
                </div>
                <p className="text-sm text-ink">
                  {c.nameOnCertificate} · {c.round.name}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-ink-muted">{m.student.serial}</dt>
                  <dd className="font-mono text-ink">{c.serial}</dd>
                  <dt className="text-ink-muted">{m.student.code}</dt>
                  <dd className="font-mono text-ink">{c.verificationCode}</dd>
                </dl>
                <p className="text-xs text-ink-faint">
                  {m.student.issued(formatDate(locale, c.issuedAt))}
                </p>
                {c.revoked ? null : (
                  <Link
                    href={`/verify/${c.verificationCode}`}
                    className="text-sm font-semibold text-secondary hover:underline"
                  >
                    {m.student.check}
                  </Link>
                )}
                <p className="mt-auto text-xs text-ink-muted">{m.student.pdfSoon}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

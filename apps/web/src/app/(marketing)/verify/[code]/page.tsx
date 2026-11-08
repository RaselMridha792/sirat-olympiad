import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@sirat/ui';
import { CertificateCheck } from '@/components/certificates/CertificateCheck';
import { publicPath, site } from '@/content/site';
import { certificatesMessages } from '@/i18n/messages/certificates';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(certificatesMessages);
  // A check page is never a search result: the code is the certificate holder's to share.
  return { title: m.check.title, robots: { index: false, follow: false } };
}

/**
 * The public certificate check (core C6c-1): a plain page, not the marketing design (Phase D). The code comes from the
 * link printed on the certificate; the browser asks the API, which answers only the name and the award.
 */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { locale, m } = await getMessages(certificatesMessages);
  return (
    <main
      id="main"
      lang={locale}
      className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-4 py-12"
    >
      <Card className="flex flex-col gap-5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{m.check.title}</h1>
        <p className="break-all font-mono text-sm text-ink-muted">{code.toUpperCase()}</p>
        <CertificateCheck locale={locale} code={code} />
      </Card>
      <Link
        href={publicPath('home', locale)}
        className="mt-6 inline-flex min-h-6 items-center justify-center text-sm font-semibold text-secondary hover:underline"
      >
        {site.name[locale]}
      </Link>
    </main>
  );
}

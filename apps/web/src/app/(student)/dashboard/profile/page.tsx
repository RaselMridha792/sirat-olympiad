import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { CircleCheck, GraduationCap, SquarePen, Trophy, UserRound } from 'lucide-react';
import { Avatar, buttonClasses, Card, DetailList, PageHeader } from '@sirat/ui';
import { getData } from '@/data';
import { first, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDate } from '@/i18n/format';
import { profileMessages } from '@/i18n/messages/profile';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(profileMessages);
  return { title: m.title };
}

/** Card heading with a tinted icon tile (old profile section headers). */
function SectionTitle({
  icon,
  tone,
  children,
}: {
  icon: ReactNode;
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control ${tone}`}
      >
        {icon}
      </span>
      <h2 className="text-lg font-bold text-ink">{children}</h2>
    </div>
  );
}

// Read-only view. Edits go through the allow-list form at /dashboard/profile/edit; role, category
// and email are never client-writable.
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(profileMessages),
    getMessages(common),
    getData(params),
  ]);
  const profile = await data.student.getProfile();
  const saved = first(params.saved) === '1';

  const missing = <span className="text-ink-faint">{c.notProvided}</span>;
  const orMissing = (value: string | null | undefined): ReactNode => value || missing;

  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />

      {saved ? (
        <p
          role="status"
          className="mb-6 flex items-center gap-2 rounded-card bg-success-soft px-4 py-3 text-sm font-semibold text-success-strong"
        >
          <CircleCheck size={18} aria-hidden="true" className="shrink-0" />
          {m.saved}
        </p>
      ) : null}

      <section className="flex flex-col gap-6 rounded-[2rem] border border-line bg-surface p-6 shadow-card md:flex-row md:items-center md:justify-between md:p-8">
        <div className="flex min-w-0 flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <div className="relative shrink-0">
            <Avatar name={profile.name} size="lg" />
            <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-surface bg-secondary px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              {c.roles[profile.role]}
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-black tracking-tight text-ink md:text-3xl">
              {profile.name}
            </h2>
            <p className="mt-1 break-all font-medium text-ink-muted">{profile.email}</p>
          </div>
        </div>
        <Link
          href="/dashboard/profile/edit"
          className={buttonClasses({
            variant: 'secondary',
            size: 'lg',
            className: 'w-full md:w-auto',
          })}
        >
          <SquarePen size={18} aria-hidden="true" />
          {m.editProfile}
        </Link>
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <SectionTitle icon={<UserRound size={20} />} tone="bg-info-soft text-info-strong">
            {m.sections.personal}
          </SectionTitle>
          <DetailList
            columns={1}
            items={[
              { label: m.fields.email, value: profile.email },
              { label: m.fields.phone, value: orMissing(profile.phone) },
              { label: m.fields.district, value: orMissing(profile.district) },
            ]}
          />
        </Card>

        <Card>
          <SectionTitle
            icon={<GraduationCap size={20} />}
            tone="bg-success-soft text-success-strong"
          >
            {m.sections.academic}
          </SectionTitle>
          <DetailList
            columns={1}
            items={[
              { label: m.fields.institution, value: orMissing(profile.institution) },
              { label: m.fields.educationType, value: orMissing(profile.educationType) },
              { label: m.fields.gradeLevel, value: orMissing(profile.gradeLevel?.label) },
              {
                label: m.fields.category,
                value: profile.category ? c.categories[profile.category] : missing,
              },
            ]}
          />
        </Card>

        <Card className="md:col-span-2">
          <SectionTitle icon={<Trophy size={20} />} tone="bg-primary-soft text-primary-strong">
            {m.sections.competition}
          </SectionTitle>
          <DetailList
            columns={2}
            items={[
              { label: m.fields.role, value: c.roles[profile.role] },
              { label: m.fields.currentRound, value: profile.currentRound?.name ?? m.notStarted },
              { label: m.fields.memberSince, value: formatDate(locale, profile.createdAt) },
              {
                label: m.fields.emailVerification,
                value: profile.emailVerifiedAt
                  ? m.verifiedOn(formatDate(locale, profile.emailVerifiedAt))
                  : m.notVerified,
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Avatar, Card, PageHeader } from '@sirat/ui';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { getData } from '@/data';
import { toProfileFormProps } from '@/data/profile';
import type { SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { profileMessages } from '@/i18n/messages/profile';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(profileMessages);
  return { title: m.edit.title };
}

// No photo upload: the schema has no photo field yet (avatars are initials).
export default async function EditProfilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/dashboard/profile/edit');
  const params = await searchParams;
  const [{ m }, { m: c }, data] = await Promise.all([
    getMessages(profileMessages),
    getMessages(common),
    getData(params),
  ]);
  const [profile, options] = await Promise.all([
    data.student.getProfile(),
    data.student.getProfileOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href="/dashboard/profile"
        className="mb-4 inline-flex min-h-6 items-center gap-1.5 text-sm font-semibold text-secondary hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {m.edit.back}
      </Link>
      <Card className="md:p-8">
        <PageHeader title={m.edit.title} subtitle={m.edit.subtitle} />
        <div className="mb-8 flex justify-center">
          <Avatar name={profile.name} size="lg" />
        </div>
        <ProfileForm
          {...toProfileFormProps(profile, options)}
          text={{ ...m.form, saving: c.states.saving }}
        />
      </Card>
    </div>
  );
}

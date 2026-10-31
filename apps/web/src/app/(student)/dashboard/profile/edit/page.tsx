import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Avatar, Card, PageHeader } from '@sirat/ui';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { getData } from '@/data';
import { profileSelectOptions } from '@/data/profile';
import type { SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { profileMessages } from '@/i18n/messages/profile';
import { getMessages } from '@/i18n/server';
import { updateProfileAction } from './actions';
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
  // A stored value missing from the server lists stays selected instead of silently becoming empty.
  const { educationTypes, gradeLevels } = profileSelectOptions(profile, options);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href="/dashboard/profile"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-secondary hover:underline"
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
          action={updateProfileAction}
          email={profile.email}
          initial={{
            name: profile.name,
            phone: profile.phone ?? '',
            district: profile.district ?? '',
            institution: profile.institution ?? '',
            educationType: profile.educationType ?? '',
            gradeLevelId: profile.gradeLevel?.id ?? '',
          }}
          educationTypes={educationTypes}
          gradeLevels={gradeLevels}
          text={{ ...m.form, saving: c.states.saving }}
        />
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import { Card, PageHeader } from '@sirat/ui';

export const metadata: Metadata = { title: 'My Profile' };

// Profile update uses an explicit allow-list DTO: name, phone, district, institution, education, grade, photo.
// role / points / rank / payment fields are NEVER client-writable.
export default function ProfilePage() {
  return (
    <>
      <PageHeader title="My Profile" />
      <Card className="max-w-2xl text-sm text-ink-muted">Profile view/edit goes here.</Card>
    </>
  );
}

import type { Metadata } from 'next';
import { DataTable, PageHeader, Badge } from '@sirat/ui';
import { getData } from '@/data';
import { parsePageQuery, type SearchParams } from '@/data/query';

export const metadata: Metadata = { title: 'Users' };

// Interim: reads the data layer (server-paged). The full port (search, role filter, detail
// dialog, i18n) replaces this page. Role changes only via the admin endpoint, audit-logged.
export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const data = await getData(params);
  const users = await data.admin.listUsers(parsePageQuery(params));
  return (
    <>
      <PageHeader title="Users" />
      <DataTable
        rows={users.items}
        rowKey={(u) => u.id}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (u) => <span className="font-semibold">{u.name}</span>,
          },
          { key: 'email', header: 'Email', render: (u) => u.email },
          {
            key: 'role',
            header: 'Role',
            render: (u) => <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role}</Badge>,
          },
          {
            key: 'status',
            header: 'Status',
            render: (u) => (
              <Badge tone={u.isBlocked ? 'danger' : 'success'}>
                {u.isBlocked ? 'blocked' : 'active'}
              </Badge>
            ),
          },
        ]}
      />
    </>
  );
}

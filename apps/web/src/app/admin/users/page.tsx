import type { Metadata } from 'next';
import { DataTable, PageHeader, Badge } from '@sirat/ui';
import { mockUsers } from '@/lib/mock';

export const metadata: Metadata = { title: 'Users' };

// Real version: server-side pagination/search/role filter. Role changes only via admin endpoint, audit-logged.
export default function AdminUsers() {
  return (
    <>
      <PageHeader title="Users" />
      <DataTable
        rows={mockUsers}
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
              <Badge tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge>
            ),
          },
        ]}
      />
    </>
  );
}

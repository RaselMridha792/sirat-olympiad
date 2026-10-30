import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/**
 * Presentational table. Pagination, search and sorting are SERVER-SIDE (never load all rows).
 * Replaces old admin/components/Table.jsx and the in-browser paging of the old leaderboard.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="border-b border-line bg-page">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-ink-faint"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-page">
                {columns.map((c) => (
                  <td key={c.key} className={c.className ?? 'px-5 py-4 text-sm text-ink'}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

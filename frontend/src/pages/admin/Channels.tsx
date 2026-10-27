import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';

interface Channel {
  id: string;
  code: string;
  name: string;
  category: string;
  kind: string;
  active: boolean;
  docsUrl: string;
  _count: { connections: number };
}

export function AdminChannelsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-channels'],
    queryFn: () => api<{ channels: Channel[] }>('/admin/platform/channels'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/admin/platform/channels/${id}`, { method: 'PATCH', json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-channels'] }),
  });

  return (
    <div>
      <PageHeader
        title="Channel & PMS catalogue"
        subtitle="Platform-wide OTA and property-management-system definitions every organization connects to. Disabling one hides it from all tenants."
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}
      {data && (
        <Table
          head={
            <>
              <th className="th">Channel</th>
              <th className="th">Category</th>
              <th className="th">Kind</th>
              <th className="th">Active connections</th>
              <th className="th">Docs</th>
              <th className="th">Enabled</th>
            </>
          }
        >
          {data.channels.map((c) => (
            <tr key={c.id}>
              <td className="td font-medium">{c.name}</td>
              <td className="td capitalize text-slate-500">{c.category === 'pms' ? 'PMS' : c.category.replace('_', ' ')}</td>
              <td className="td text-slate-500">{c.kind}</td>
              <td className="td">{c._count.connections}</td>
              <td className="td">
                {c.docsUrl && c.docsUrl !== 'internal' && (
                  <a href={c.docsUrl} target="_blank" rel="noreferrer" className="text-brand-500 underline">
                    docs
                  </a>
                )}
              </td>
              <td className="td">
                <input
                  type="checkbox"
                  checked={c.active}
                  onChange={(e) => toggle.mutate({ id: c.id, active: e.target.checked })}
                />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

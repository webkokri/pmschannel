import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, ErrorNote, PageHeader, Spinner, StatCard } from '@/components/ui';
import { date } from '@/lib/format';

interface AcceleratorStatus {
  active: boolean;
  activatedAt: string | null;
  boostedChannelCodes: string[];
  connectedCount: number;
  bundle: { code: string; name: string; category: string }[];
}

export function AcceleratorPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['accelerator'],
    queryFn: () => api<AcceleratorStatus>('/accelerator'),
  });

  const activate = useMutation({
    mutationFn: () => api<{ applied: boolean }>('/accelerator/activate', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accelerator'] }),
  });

  return (
    <div>
      <PageHeader
        title="Accelerator"
        subtitle="One click to instantly connect every active property to a bundle of extra distribution channels"
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Status" value={<Badge status={data.active ? 'active' : 'not_started'}>{data.active ? 'Active' : 'Inactive'}</Badge>} />
            <StatCard label="Channels in bundle" value={String(data.bundle.length)} />
            <StatCard label="Live connections" value={String(data.connectedCount)} />
          </div>

          {data.active && data.activatedAt && (
            <p className="mt-3 text-sm text-slate-500">Activated {date(data.activatedAt)} — boosted channels stay enabled across every active property.</p>
          )}

          <h3 className="mb-2 mt-6 text-sm font-semibold">Bundle</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.bundle.map((c) => (
              <div key={c.code} className="card flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs capitalize text-slate-500">{c.category}</p>
                </div>
                {data.boostedChannelCodes.includes(c.code) && <Badge status="active">connected</Badge>}
              </div>
            ))}
          </div>

          {!data.active && (
            <div className="card mt-6 p-4">
              <h3 className="mb-1 text-sm font-semibold">Activate the Accelerator</h3>
              <p className="text-sm text-slate-500">
                We'll connect every active property to all {data.bundle.length} bundle channels above — no per-channel
                setup needed, and no charge (this is an in-house feature, not a purchase).
              </p>
              <button className="btn-primary mt-3" disabled={activate.isPending} onClick={() => activate.mutate()}>
                Activate
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

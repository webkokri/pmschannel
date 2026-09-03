import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { date, timeAgo } from '@/lib/format';

interface Conflict {
  id: string;
  type: string;
  severity: string;
  status: string;
  fromDate: string | null;
  toDate: string | null;
  createdAt: string;
  resolutionNote: string;
  details: { message?: string; oversoldDates?: { date: string; demand: number; capacity: number }[] };
  roomType?: { name: string; property: { name: string } } | null;
  bookings: {
    id: string;
    externalRef: string;
    guestName: string;
    checkIn: string;
    checkOut: string;
    status: string;
    sourceChannel: { name: string };
  }[];
}

export function ConflictsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');

  const { data, isLoading, error } = useQuery({
    queryKey: ['conflicts', status],
    queryFn: () => api<{ conflicts: Conflict[] }>(`/conflicts${status ? `?status=${status}` : ''}`),
    refetchInterval: 15_000,
  });

  const update = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: string; note?: string }) =>
      api(`/conflicts/${id}`, { method: 'PATCH', json: { status, resolutionNote: note } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conflicts'] }),
  });

  const sweep = useMutation({
    mutationFn: () => api('/conflicts/sweep', { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conflicts'] }),
  });

  return (
    <div>
      <PageHeader
        title="Conflicts"
        subtitle="Overbooking, double-booking and rate-mismatch alerts raised by the sync engine"
        actions={
          <div className="flex gap-2">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="">All</option>
            </select>
            <button className="btn-ghost" onClick={() => sweep.mutate()} disabled={sweep.isPending}>
              Re-scan inventory
            </button>
          </div>
        }
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}

      <div className="space-y-3">
        {data?.conflicts.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge status={c.severity} />
                <span className="font-semibold capitalize">{c.type.replace('_', ' ')}</span>
                <Badge status={c.status} />
                <span className="text-xs text-slate-400">{timeAgo(c.createdAt)}</span>
              </div>
              <div className="flex gap-1.5">
                {c.status !== 'acknowledged' && c.status !== 'resolved' && (
                  <button
                    className="btn-ghost !py-1.5"
                    onClick={() => update.mutate({ id: c.id, status: 'acknowledged' })}
                  >
                    Acknowledge
                  </button>
                )}
                {c.status !== 'resolved' && (
                  <button
                    className="btn-primary !py-1.5"
                    onClick={() =>
                      update.mutate({ id: c.id, status: 'resolved', note: 'Resolved from admin panel' })
                    }
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>

            <p className="mt-2 text-sm">{c.details?.message}</p>
            {c.roomType && (
              <p className="text-xs text-slate-500">
                {c.roomType.property.name} · {c.roomType.name}
                {c.fromDate && ` · ${date(c.fromDate)} → ${date(c.toDate!)}`}
              </p>
            )}

            {c.bookings.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {c.bookings.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{b.guestName}</span>
                      <Badge status={b.status} />
                    </div>
                    <p className="text-slate-500">
                      {b.sourceChannel.name} · {b.externalRef}
                    </p>
                    <p className="text-slate-500">
                      {date(b.checkIn)} → {date(b.checkOut)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {c.resolutionNote && (
              <p className="mt-2 text-xs italic text-slate-400">“{c.resolutionNote}”</p>
            )}
          </div>
        ))}
        {data && data.conflicts.length === 0 && (
          <div className="card p-10 text-center text-sm text-emerald-600 dark:text-emerald-400">
            No {status || ''} conflicts. Inventory is consistent across channels.
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ErrorNote, PageHeader, Spinner } from '@/components/ui';

interface Target {
  id: string;
  channel: { name: string; code: string; kind: string };
  property: { name: string; code: string };
  _count: { roomMappings: number };
}
interface Autopilot {
  enabled: boolean;
  lambdaByChannel: Record<string, number>;
}

export function SimulatorPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['sim-targets'],
    queryFn: () => api<{ connections: Target[]; autopilot: Autopilot }>('/simulator/targets'),
    refetchInterval: 10_000,
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(15);
  const [rate, setRate] = useState(8);

  useEffect(() => {
    if (data && selected.length === 0) setSelected(data.connections.slice(0, 5).map((c) => c.id));
  }, [data, selected.length]);

  const invalidateAll = () => {
    ['dashboard', 'bookings', 'calendar', 'conflicts', 'sync-logs', 'sync-jobs', 'sync-health', 'sim-targets'].forEach(
      (k) => qc.invalidateQueries({ queryKey: [k] }),
    );
  };

  const generate = useMutation({
    mutationFn: () =>
      api<{ generated: number; created: number; rejected: number; totalFanout: number; conflicts: string[] }>(
        '/simulator/generate',
        { method: 'POST', json: { connectionIds: selected, count } },
      ),
    onSuccess: invalidateAll,
  });
  const overbooking = useMutation({
    mutationFn: () =>
      api<{ overbookingDetected: boolean; autoProtected: boolean; conflict: { details: { message: string } } | null; roomType: { name: string } }>(
        '/simulator/overbooking',
        { method: 'POST', json: {} },
      ),
    onSuccess: invalidateAll,
  });
  const autopilot = useMutation({
    mutationFn: (enabled: boolean) =>
      api('/simulator/autopilot', { method: 'POST', json: { enabled, ratePerMinute: rate } }),
    onSuccess: invalidateAll,
  });
  const reset = useMutation({
    mutationFn: () => api<{ deletedBookings: number }>('/simulator/reset', { method: 'POST' }),
    onSuccess: invalidateAll,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'error'} />;

  const apOn = data.autopilot?.enabled;

  return (
    <div>
      <PageHeader
        title="Booking simulator"
        subtitle="Drive the mock OTAs to exercise ingestion, conflict prevention and ARI fan-out end-to-end"
        actions={
          <button className="btn-ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
            Reset simulated data
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Generate random bookings</h3>
          <div className="mb-3 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800">
            {data.connections.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))
                  }
                />
                <span className="font-medium">{c.channel.name}</span>
                <span className="text-slate-400">
                  · {c.property.code} · {c._count.roomMappings} rooms
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm">
              Count
              <input
                type="number"
                className="input ml-2 w-20"
                value={count}
                min={1}
                max={200}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <button
              className="btn-primary"
              onClick={() => generate.mutate()}
              disabled={generate.isPending || selected.length === 0}
            >
              {generate.isPending ? 'Generating…' : `Generate ${count}`}
            </button>
          </div>
          {generate.data && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
              Created <b>{generate.data.created}</b> · rejected <b>{generate.data.rejected}</b> · fanned out to{' '}
              <b>{generate.data.totalFanout}</b> channel jobs · <b>{generate.data.conflicts.length}</b> conflicts.
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Scenarios</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Fill a room to capacity from one channel, then push one more reservation from a different channel for the
            same dates. The engine should catch it.
          </p>
          <button
            className="btn-primary mt-3"
            onClick={() => overbooking.mutate()}
            disabled={overbooking.isPending}
          >
            {overbooking.isPending ? 'Running…' : 'Force an overbooking'}
          </button>
          {overbooking.data && (
            <div
              className={`mt-3 rounded-lg border p-3 text-sm ${
                overbooking.data.overbookingDetected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              <p className="font-medium">
                {overbooking.data.overbookingDetected
                  ? `Caught it on ${overbooking.data.roomType.name}.`
                  : 'Not detected (check settings).'}
              </p>
              {overbooking.data.conflict && <p className="mt-1">{overbooking.data.conflict.details.message}</p>}
              <p className="mt-1 text-xs">
                Auto-protect {overbooking.data.autoProtected ? 'rejected the extra booking' : 'is off — booking kept, conflict raised'}.
              </p>
            </div>
          )}

          <hr className="my-4 border-slate-200 dark:border-slate-800" />

          <h3 className="mb-2 text-sm font-semibold">Autopilot</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            The worker's poll loop invents bookings on pull channels continuously. Watch the dashboard fill up.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <label className="text-sm">
              ~bookings / min
              <input
                type="number"
                className="input ml-2 w-20"
                value={rate}
                min={0}
                max={60}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </label>
            <button
              className={apOn ? 'btn-ghost' : 'btn-primary'}
              onClick={() => autopilot.mutate(!apOn)}
              disabled={autopilot.isPending}
            >
              {apOn ? 'Stop autopilot' : 'Start autopilot'}
            </button>
            <span className={`badge ${apOn ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
              {apOn ? 'running' : 'stopped'}
            </span>
          </div>
        </div>
      </div>

      {reset.data && (
        <p className="mt-4 text-sm text-slate-500">Deleted {reset.data.deletedBookings} simulated bookings.</p>
      )}
    </div>
  );
}

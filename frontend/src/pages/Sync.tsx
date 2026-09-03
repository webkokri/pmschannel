import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, ErrorNote, PageHeader, Spinner, StatCard, Table } from '@/components/ui';
import { dateTime, timeAgo } from '@/lib/format';

interface Log {
  id: string;
  direction: string;
  entityType: string;
  ok: boolean;
  attempt: number;
  message: string;
  durationMs: number;
  request: unknown;
  response: unknown;
  createdAt: string;
  channelConnection?: { channel: { name: string }; property: { name: string } } | null;
}
interface Job {
  id: string;
  direction: string;
  entityType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: string | null;
  updatedAt: string;
  channelConnection?: { channel: { name: string }; property: { name: string } } | null;
}

export function SyncPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'logs' | 'jobs'>('logs');
  const [okFilter, setOkFilter] = useState('');

  const health = useQuery({
    queryKey: ['sync-health'],
    queryFn: () => api<{ pending: number; failed: number; dead: number; succeeded24h: number; failed24h: number }>('/sync/health'),
    refetchInterval: 10_000,
  });
  const logs = useQuery({
    queryKey: ['sync-logs', okFilter],
    queryFn: () => api<{ logs: Log[] }>(`/sync/logs?pageSize=100${okFilter ? `&ok=${okFilter}` : ''}`),
    refetchInterval: 10_000,
    enabled: view === 'logs',
  });
  const jobs = useQuery({
    queryKey: ['sync-jobs'],
    queryFn: () => api<{ jobs: Job[] }>('/sync/jobs'),
    refetchInterval: 10_000,
    enabled: view === 'jobs',
  });

  const runNow = useMutation({
    mutationFn: () => api('/sync/run', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
      qc.invalidateQueries({ queryKey: ['sync-health'] });
    },
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/sync/jobs/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Sync engine"
        subtitle="Every availability / rate / restriction push and booking pull, with retries"
        actions={
          <button className="btn-primary" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            {runNow.isPending ? 'Running…' : 'Run worker now'}
          </button>
        }
      />

      {health.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Pending" value={health.data.pending} tone={health.data.pending > 20 ? 'warn' : 'default'} />
          <StatCard label="Failed (retrying)" value={health.data.failed} tone={health.data.failed ? 'warn' : 'default'} />
          <StatCard label="Dead" value={health.data.dead} tone={health.data.dead ? 'bad' : 'good'} />
          <StatCard label="OK · 24h" value={health.data.succeeded24h} tone="good" />
          <StatCard label="Failed · 24h" value={health.data.failed24h} tone={health.data.failed24h ? 'warn' : 'default'} />
        </div>
      )}

      <div className="mb-3 flex gap-1.5">
        <button className={view === 'logs' ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'} onClick={() => setView('logs')}>
          Logs
        </button>
        <button className={view === 'jobs' ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'} onClick={() => setView('jobs')}>
          Queue
        </button>
        {view === 'logs' && (
          <select className="input ml-2 w-auto" value={okFilter} onChange={(e) => setOkFilter(e.target.value)}>
            <option value="">All results</option>
            <option value="true">Successful</option>
            <option value="false">Failed</option>
          </select>
        )}
      </div>

      {view === 'logs' &&
        (logs.isLoading ? (
          <Spinner />
        ) : logs.error ? (
          <ErrorNote error={logs.error} />
        ) : (
          <Table
            head={
              <>
                <th className="th">When</th>
                <th className="th">Channel</th>
                <th className="th">Direction</th>
                <th className="th">Entity</th>
                <th className="th">Result</th>
                <th className="th">Message</th>
              </>
            }
          >
            {logs.data!.logs.map((l) => (
              <Fragment key={l.id}>
                <tr
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                >
                  <td className="td text-slate-500">{timeAgo(l.createdAt)}</td>
                  <td className="td">{l.channelConnection?.channel.name ?? '—'}</td>
                  <td className="td">{l.direction}</td>
                  <td className="td">{l.entityType}</td>
                  <td className="td">
                    <Badge status={l.ok ? 'succeeded' : 'failed'}>{l.ok ? 'ok' : `fail #${l.attempt}`}</Badge>
                  </td>
                  <td className="td max-w-xs truncate text-slate-500">{l.message}</td>
                </tr>
                {expanded === l.id && (
                  <tr>
                    <td colSpan={6} className="bg-slate-50 px-3 py-2 dark:bg-slate-900/60">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-400">Request</p>
                          <pre className="max-h-52 overflow-auto text-[11px]">{JSON.stringify(l.request, null, 2)}</pre>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-400">Response</p>
                          <pre className="max-h-52 overflow-auto text-[11px]">{JSON.stringify(l.response, null, 2)}</pre>
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {dateTime(l.createdAt)} · {l.durationMs}ms
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        ))}

      {view === 'jobs' &&
        (jobs.isLoading ? (
          <Spinner />
        ) : (
          <Table
            head={
              <>
                <th className="th">Channel</th>
                <th className="th">Entity</th>
                <th className="th">Status</th>
                <th className="th">Attempts</th>
                <th className="th">Next run</th>
                <th className="th">Last error</th>
                <th className="th" />
              </>
            }
          >
            {jobs.data!.jobs.map((j) => (
              <tr key={j.id}>
                <td className="td">{j.channelConnection?.channel.name ?? '—'}</td>
                <td className="td">
                  {j.direction}/{j.entityType}
                </td>
                <td className="td">
                  <Badge status={j.status} />
                </td>
                <td className="td text-slate-500">
                  {j.attempts}/{j.maxAttempts}
                </td>
                <td className="td text-slate-500">
                  {j.status === 'failed' || j.status === 'pending' ? dateTime(j.nextRunAt) : '—'}
                </td>
                <td className="td max-w-xs truncate text-rose-500">{j.lastError ?? ''}</td>
                <td className="td text-right">
                  {(j.status === 'failed' || j.status === 'dead') && (
                    <button className="text-brand-500 hover:underline" onClick={() => retry.mutate(j.id)}>
                      retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {jobs.data!.jobs.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={7}>
                  Queue is empty.
                </td>
              </tr>
            )}
          </Table>
        ))}
    </div>
  );
}

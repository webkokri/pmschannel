import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Badge, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { timeAgo } from '@/lib/format';

interface Channel {
  id: string;
  code: string;
  name: string;
  category: string;
  kind: string;
  authType: string;
  markets: string[];
  capabilities: string[];
  docsUrl: string;
  notes: string;
  connectedCount: number;
}
interface Connection {
  id: string;
  channelId: string;
  propertyId: string;
  enabled: boolean;
  status: string;
  lastPushAt: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  driver: string;
  channel: { code: string; name: string };
  _count: { roomMappings: number };
}

export function ChannelsPage() {
  const { selectedId } = useProperty();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>('all');

  const catalogue = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ categories: Record<string, string>; channels: Channel[] }>('/channels'),
  });
  const connections = useQuery({
    queryKey: ['connections', selectedId],
    queryFn: () => api<{ connections: Connection[] }>(`/channels/connections?propertyId=${selectedId}`),
    enabled: !!selectedId,
  });

  const connByChannelId = useMemo(() => {
    const m = new Map<string, Connection>();
    (connections.data?.connections ?? []).forEach((c) => m.set(c.channelId, c));
    return m;
  }, [connections.data]);

  const connect = useMutation({
    mutationFn: (channelId: string) =>
      api('/channels/connections', {
        method: 'POST',
        json: { propertyId: selectedId, channelId, enabled: true },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api(`/channels/connections/${id}`, { method: 'PATCH', json: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const test = useMutation({
    mutationFn: (id: string) => api<{ result: { ok: boolean; message: string } }>(`/channels/connections/${id}/test`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  if (catalogue.isLoading) return <Spinner />;
  if (catalogue.error) return <ErrorNote error={catalogue.error} />;

  const categories = catalogue.data!.categories;
  const channels = catalogue.data!.channels.filter((c) => tab === 'all' || c.category === tab);

  return (
    <div>
      <PageHeader
        title="Channels"
        subtitle="Connect OTAs for the selected property. In this environment every channel runs on the built-in mock driver."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {['all', ...Object.keys(categories)].map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === c ? 'bg-brand-600 text-white' : 'btn-ghost'
            }`}
          >
            {c === 'all' ? 'All' : categories[c]}
          </button>
        ))}
      </div>

      {test.data && (
        <div
          className={`mb-3 rounded-lg border p-3 text-sm ${
            test.data.result.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
          }`}
        >
          {test.data.result.message}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {channels.map((ch) => {
          const conn = connByChannelId.get(ch.id);
          return (
            <div key={ch.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{ch.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {ch.kind} · {ch.authType} · {ch.markets.join('/')}
                  </p>
                </div>
                {conn ? (
                  <Badge status={conn.status} />
                ) : (
                  <span className="badge bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                    not connected
                  </span>
                )}
              </div>

              <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{ch.notes}</p>

              <div className="mt-3 flex flex-wrap gap-1">
                {ch.capabilities.map((c) => (
                  <span key={c} className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {c}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex flex-1 items-end justify-between gap-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {conn ? (
                    <>
                      {conn._count.roomMappings} mappings
                      {conn.lastPushAt && <> · pushed {timeAgo(conn.lastPushAt)}</>}
                      {conn.lastError && <div className="text-rose-500">{conn.lastError}</div>}
                    </>
                  ) : (
                    <a href={ch.docsUrl} target="_blank" rel="noreferrer" className="underline">
                      docs
                    </a>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {conn ? (
                    <>
                      <button className="btn-ghost !py-1.5" onClick={() => test.mutate(conn.id)} disabled={test.isPending}>
                        Test
                      </button>
                      <button
                        className="btn-ghost !py-1.5"
                        onClick={() => toggle.mutate({ id: conn.id, enabled: !conn.enabled })}
                      >
                        {conn.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <Link className="btn-primary !py-1.5" to={`/channels/${conn.id}`}>
                        Configure
                      </Link>
                    </>
                  ) : (
                    <button
                      className="btn-primary !py-1.5"
                      onClick={() => connect.mutate(ch.id)}
                      disabled={!selectedId || connect.isPending}
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

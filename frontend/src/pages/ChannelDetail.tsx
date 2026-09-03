import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';

interface Detail {
  connection: {
    id: string;
    propertyId: string;
    enabled: boolean;
    status: string;
    driver: string;
    syncAvailability: boolean;
    syncRates: boolean;
    syncRestrictions: boolean;
    importBookings: boolean;
    pushEnabled: boolean;
    pullIntervalSec: number;
    webhookUrl: string;
    channel: { name: string; code: string; kind: string; docsUrl: string; capabilities: string[] };
    property: { id: string; name: string };
    roomMappings: {
      id: string;
      externalRoomId: string;
      externalRatePlanId: string;
      active: boolean;
      roomType: { id: string; name: string };
    }[];
  };
}

interface PropertyDetail {
  property: { roomTypes: { id: string; name: string; code: string }[] };
}

export function ChannelDetailPage() {
  const { connectionId } = useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['connection', connectionId],
    queryFn: () => api<Detail>(`/channels/connections/${connectionId}`),
  });

  const propertyId = data?.connection.propertyId;
  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api<PropertyDetail>(`/properties/${propertyId}`),
    enabled: !!propertyId,
  });

  const patch = useMutation({
    mutationFn: (json: Record<string, unknown>) =>
      api(`/channels/connections/${connectionId}`, { method: 'PATCH', json }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connection', connectionId] }),
  });

  const addMapping = useMutation({
    mutationFn: (json: Record<string, unknown>) => api('/channels/mappings', { method: 'POST', json }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connection', connectionId] }),
  });
  const delMapping = useMutation({
    mutationFn: (id: string) => api(`/channels/mappings/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connection', connectionId] }),
  });

  const [newRoom, setNewRoom] = useState('');
  const [newExtRoom, setNewExtRoom] = useState('');
  const [newExtRate, setNewExtRate] = useState('');

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'Not found'} />;

  const c = data.connection;
  const rooms = propertyQ.data?.property.roomTypes ?? [];

  const toggleField = (field: string, value: boolean) => patch.mutate({ [field]: value });

  return (
    <div>
      <PageHeader
        title={`${c.channel.name} · ${c.property.name}`}
        subtitle={`${c.channel.kind} channel · driver: ${c.driver}`}
        actions={
          <Link to="/channels" className="btn-ghost">
            ← All channels
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Connection</h3>
            <Badge status={c.status} />
          </div>
          <div className="space-y-2 text-sm">
            {[
              ['enabled', 'Connection enabled'],
              ['pushEnabled', 'Push ARI to this channel'],
              ['syncAvailability', 'Sync availability'],
              ['syncRates', 'Sync rates'],
              ['syncRestrictions', 'Sync restrictions'],
              ['importBookings', 'Import bookings'],
            ].map(([field, label]) => (
              <label key={field} className="flex items-center justify-between gap-3">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean((c as unknown as Record<string, boolean>)[field])}
                  onChange={(e) => toggleField(field, e.target.checked)}
                  className="h-4 w-4"
                />
              </label>
            ))}
            <label className="flex items-center justify-between gap-3 pt-1">
              <span>Poll interval (seconds)</span>
              <input
                type="number"
                className="input w-24"
                defaultValue={c.pullIntervalSec}
                onBlur={(e) => patch.mutate({ pullIntervalSec: Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
            <p className="mb-1 font-medium">Inbound webhook URL</p>
            <code className="break-all text-slate-500 dark:text-slate-400">{c.webhookUrl}</code>
            <p className="mt-2 text-slate-500 dark:text-slate-400">
              Real integration:{' '}
              <a className="underline" href={c.channel.docsUrl} target="_blank" rel="noreferrer">
                {c.channel.docsUrl}
              </a>
            </p>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Room mappings ({c.roomMappings.length})</h3>
          <Table
            head={
              <>
                <th className="th">Room type</th>
                <th className="th">External room id</th>
                <th className="th">External rate plan</th>
                <th className="th" />
              </>
            }
          >
            {c.roomMappings.map((m) => (
              <tr key={m.id}>
                <td className="td font-medium">{m.roomType.name}</td>
                <td className="td text-slate-500">{m.externalRoomId}</td>
                <td className="td text-slate-500">{m.externalRatePlanId || '—'}</td>
                <td className="td text-right">
                  <button className="text-rose-500 hover:underline" onClick={() => delMapping.mutate(m.id)}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="td">
                <select className="input" value={newRoom} onChange={(e) => setNewRoom(e.target.value)}>
                  <option value="">Select room…</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="td">
                <input
                  className="input"
                  placeholder="e.g. 1234567"
                  value={newExtRoom}
                  onChange={(e) => setNewExtRoom(e.target.value)}
                />
              </td>
              <td className="td">
                <input
                  className="input"
                  placeholder="optional"
                  value={newExtRate}
                  onChange={(e) => setNewExtRate(e.target.value)}
                />
              </td>
              <td className="td text-right">
                <button
                  className="btn-primary !py-1.5"
                  disabled={!newRoom || !newExtRoom || addMapping.isPending}
                  onClick={() => {
                    addMapping.mutate({
                      channelConnectionId: c.id,
                      roomTypeId: newRoom,
                      externalRoomId: newExtRoom,
                      externalRatePlanId: newExtRate,
                    });
                    setNewRoom('');
                    setNewExtRoom('');
                    setNewExtRate('');
                  }}
                >
                  Add
                </button>
              </td>
            </tr>
          </Table>
        </div>
      </div>
    </div>
  );
}

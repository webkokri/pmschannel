import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';

/** Which credential fields to collect per auth scheme — a generic form, not one per provider. */
const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; secret?: boolean }[]> = {
  none: [],
  api_key: [
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'propertyId', label: 'External property / hotel ID' },
    { key: 'baseUrl', label: 'API base URL (optional)' },
  ],
  basic: [
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ],
  oauth2: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'propertyId', label: 'External property ID' },
  ],
  hotel_id_password: [
    { key: 'hotelId', label: 'Hotel ID' },
    { key: 'password', label: 'Password', secret: true },
  ],
  ical_url: [{ key: 'icalUrl', label: 'iCal feed URL' }],
  gds_pseudo_city: [
    { key: 'pseudoCityCode', label: 'Pseudo-city code' },
    { key: 'chainCode', label: 'Chain code' },
    { key: 'propertyCode', label: 'Property code' },
  ],
};

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
    icalExportUrl: string | null;
    credentials: Record<string, string>;
    channel: { name: string; code: string; kind: string; category: string; authType: string; docsUrl: string; capabilities: string[] };
    property: { id: string; name: string };
    roomMappings: {
      id: string;
      externalRoomId: string;
      externalRatePlanId: string;
      ratePlanId: string | null;
      active: boolean;
      roomType: { id: string; name: string };
      ratePlan: { id: string; name: string } | null;
    }[];
  };
}

interface PropertyDetail {
  property: { roomTypes: { id: string; name: string; code: string; ratePlans: { id: string; name: string }[] }[] };
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
  const [newRatePlan, setNewRatePlan] = useState('');
  const [credForm, setCredForm] = useState<Record<string, string>>({});
  const [driver, setDriver] = useState<'mock' | 'real'>('mock');
  const [credSaved, setCredSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setCredForm({});
      setDriver((data.connection.driver as 'mock' | 'real') ?? 'mock');
    }
  }, [data?.connection.id, data?.connection.driver]);

  const saveCredentials = useMutation({
    mutationFn: (json: Record<string, unknown>) => api(`/channels/connections/${connectionId}`, { method: 'PATCH', json }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connection', connectionId] });
      setCredForm({});
      setCredSaved(true);
      setTimeout(() => setCredSaved(false), 3000);
    },
  });

  const rotateSecret = useMutation({
    mutationFn: () => api(`/channels/connections/${connectionId}/webhook-secret/rotate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connection', connectionId] }),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'Not found'} />;

  const c = data.connection;
  const rooms = propertyQ.data?.property.roomTypes ?? [];
  const credFields = CREDENTIAL_FIELDS[c.channel.authType] ?? CREDENTIAL_FIELDS.api_key;

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

          {c.icalExportUrl && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <p className="mb-1 font-medium text-emerald-700 dark:text-emerald-300">Your calendar feed (export)</p>
              <code className="break-all text-emerald-700 dark:text-emerald-300">{c.icalExportUrl}</code>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Paste this into the other platform's "subscribe to an external calendar" field. Every confirmed booking on
                this room — from any channel, including this portal's direct bookings — shows up there as a blocked date, no
                guest details included. This is a live feature: fetching it right now returns real data.
              </p>
            </div>
          )}

          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-medium">Inbound webhook URL</p>
              <button
                className="text-rose-500 hover:underline disabled:opacity-50"
                disabled={rotateSecret.isPending}
                onClick={() => {
                  if (confirm('Rotate the webhook secret? The old URL (wherever it was pasted into the OTA) will stop working immediately.')) {
                    rotateSecret.mutate();
                  }
                }}
              >
                Rotate secret
              </button>
            </div>
            <code className="break-all text-slate-500 dark:text-slate-400">{c.webhookUrl}</code>
            <p className="mt-2 text-amber-600 dark:text-amber-400">
              Treat this URL as a secret — anyone who has it can submit bookings for this property. Paste it into the OTA's
              webhook configuration panel, not anywhere public.
            </p>
            <p className="mt-2 text-slate-500 dark:text-slate-400">
              {!['internal', 'vendor-provided', ''].includes(c.channel.docsUrl) ? (
                <>
                  Real integration:{' '}
                  <a className="underline" href={c.channel.docsUrl} target="_blank" rel="noreferrer">
                    {c.channel.docsUrl}
                  </a>
                </>
              ) : c.channel.docsUrl === 'vendor-provided' ? (
                'Get current API credentials and endpoint docs from your PMS account rep.'
              ) : null}
            </p>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Room mappings ({c.roomMappings.length})</h3>
          <p className="mb-3 text-xs text-slate-500">
            Pin a mapping to an internal rate plan to push that plan's own price to this OTA (e.g. a non-refundable rate at
            a discount) instead of the room's base rate — manage rate plans from Properties & rooms.
          </p>
          <Table
            head={
              <>
                <th className="th">Room type</th>
                <th className="th">External room id</th>
                <th className="th">External rate plan</th>
                <th className="th">Internal rate plan</th>
                <th className="th" />
              </>
            }
          >
            {c.roomMappings.map((m) => (
              <tr key={m.id}>
                <td className="td font-medium">{m.roomType.name}</td>
                <td className="td text-slate-500">{m.externalRoomId}</td>
                <td className="td text-slate-500">{m.externalRatePlanId || '—'}</td>
                <td className="td text-slate-500">{m.ratePlan?.name ?? <span className="italic">base rate</span>}</td>
                <td className="td text-right">
                  <button className="text-rose-500 hover:underline" onClick={() => delMapping.mutate(m.id)}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="td">
                <select className="input" value={newRoom} onChange={(e) => { setNewRoom(e.target.value); setNewRatePlan(''); }}>
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
              <td className="td">
                <select className="input" value={newRatePlan} onChange={(e) => setNewRatePlan(e.target.value)} disabled={!newRoom}>
                  <option value="">Base rate</option>
                  {(rooms.find((r) => r.id === newRoom)?.ratePlans ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
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
                      ratePlanId: newRatePlan || null,
                    });
                    setNewRoom('');
                    setNewExtRoom('');
                    setNewExtRate('');
                    setNewRatePlan('');
                  }}
                >
                  Add
                </button>
              </td>
            </tr>
          </Table>
        </div>
      </div>

      <div className="card mt-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Credentials & driver</h3>
          {credSaved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
        </div>
        {credFields.length === 0 ? (
          <p className="text-sm text-slate-500">This connection type needs no credentials.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {credFields.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <input
                  className="input"
                  type={f.secret ? 'password' : 'text'}
                  placeholder={c.credentials[f.key] ? `saved: ${c.credentials[f.key]}` : 'not set'}
                  value={credForm[f.key] ?? ''}
                  onChange={(e) => setCredForm({ ...credForm, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-end gap-3">
          <div>
            <label className="label">Driver</label>
            <select className="input" value={driver} onChange={(e) => setDriver(e.target.value as 'mock' | 'real')}>
              <option value="mock">Mock (simulated — no external calls)</option>
              <option value="real">Real (uses the credentials above)</option>
            </select>
          </div>
          <button
            className="btn-primary"
            disabled={saveCredentials.isPending}
            onClick={() => saveCredentials.mutate({ credentials: { ...credForm, driver } })}
          >
            Save credentials
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Fields left blank keep their current saved value. Switch the driver to "Real" once credentials are verified with{' '}
          <b>Test</b> from the Channels list — until then this connection runs on the mock driver regardless of what's saved here.
        </p>
      </div>
    </div>
  );
}

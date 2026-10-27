import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Drawer, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { dateTime, timeAgo } from '@/lib/format';

interface Staff {
  id: string;
  name: string;
  email: string;
  active: boolean;
  assignedOrgs: number;
}
interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
  actor: { name: string; email: string } | null;
  organization: { name: string } | null;
}

export function AdminSettingsPage() {
  const qc = useQueryClient();
  const [addStaff, setAddStaff] = useState(false);

  const settings = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () => api<{ settings: Record<string, unknown> }>('/admin/platform/settings'),
  });
  const staff = useQuery({
    queryKey: ['admin-support-managers'],
    queryFn: () => api<{ staff: Staff[] }>('/admin/platform/support-managers'),
  });
  const audit = useQuery({
    queryKey: ['platform-audit'],
    queryFn: () => api<{ logs: AuditRow[] }>('/admin/platform/audit-log?take=50'),
  });

  const saveSetting = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api('/admin/platform/settings', { method: 'PATCH', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-settings'] }),
  });

  const createStaff = useMutation({
    mutationFn: (v: { name: string; email: string; password: string }) =>
      api('/admin/platform/support-managers', { method: 'POST', json: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-support-managers'] });
      setAddStaff(false);
    },
  });
  const toggleStaff = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/admin/platform/support-managers/${id}`, { method: 'PATCH', json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-support-managers'] }),
  });

  const maintenanceMode = Boolean(settings.data?.settings.maintenanceMode);
  const signupEnabled = settings.data?.settings.signupEnabled !== false;

  return (
    <div>
      <PageHeader title="Platform settings" subtitle="Global controls, the support-manager pool, and the platform audit log" />

      <div className="grid gap-4 lg:grid-cols-2">
        <CommissionAcceleratorCard settings={settings.data?.settings} onSave={(patch) => saveSetting.mutate(patch)} saving={saveSetting.isPending} />

        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">Global controls</h3>
          <label className="flex items-center justify-between text-sm">
            <span>Self-serve signup enabled</span>
            <input
              type="checkbox"
              checked={signupEnabled}
              onChange={(e) => saveSetting.mutate({ signupEnabled: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>Maintenance mode banner</span>
            <input
              type="checkbox"
              checked={maintenanceMode}
              onChange={(e) => saveSetting.mutate({ maintenanceMode: e.target.checked })}
            />
          </label>
          {settings.isLoading && <Spinner />}
          {settings.error && <ErrorNote error={settings.error} />}
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Support manager pool</h3>
            <button className="btn-ghost !py-1.5" onClick={() => setAddStaff(true)}>
              + Add
            </button>
          </div>
          {staff.isLoading ? (
            <Spinner />
          ) : (
            <div className="space-y-1.5">
              {staff.data?.staff.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-slate-400">
                      {s.email} · {s.assignedOrgs} org{s.assignedOrgs === 1 ? '' : 's'}
                    </p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs">
                    active
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) => toggleStaff.mutate({ id: s.id, active: e.target.checked })}
                    />
                  </label>
                </div>
              ))}
              {staff.data?.staff.length === 0 && <p className="text-sm text-slate-500">No support managers yet.</p>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold">Platform audit log</h3>
        {audit.isLoading && <Spinner />}
        {audit.data && (
          <Table
            head={
              <>
                <th className="th">When</th>
                <th className="th">Actor</th>
                <th className="th">Organization</th>
                <th className="th">Action</th>
                <th className="th">Entity</th>
              </>
            }
          >
            {audit.data.logs.map((l) => (
              <tr key={l.id}>
                <td className="td text-slate-500" title={dateTime(l.createdAt)}>
                  {timeAgo(l.createdAt)}
                </td>
                <td className="td">{l.actor ? `${l.actor.name} (${l.actor.email})` : 'system'}</td>
                <td className="td">{l.organization?.name ?? '—'}</td>
                <td className="td">{l.action}</td>
                <td className="td text-slate-500">
                  {l.entity} · {l.entityId.slice(0, 8)}
                </td>
              </tr>
            ))}
            {audit.data.logs.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={5}>
                  No audit events recorded yet.
                </td>
              </tr>
            )}
          </Table>
        )}
      </div>

      {addStaff && (
        <Drawer open onClose={() => setAddStaff(false)} title="Add support manager">
          <StaffForm busy={createStaff.isPending} onSubmit={(v) => createStaff.mutate(v)} />
        </Drawer>
      )}
    </div>
  );
}

function CommissionAcceleratorCard({
  settings,
  onSave,
  saving,
}: {
  settings: Record<string, unknown> | undefined;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [rate, setRate] = useState('');
  const [price, setPrice] = useState('');
  const [codes, setCodes] = useState('');

  useEffect(() => {
    if (!settings) return;
    if (typeof settings['commission:defaultRateBps'] === 'number') setRate(String((settings['commission:defaultRateBps'] as number) / 100));
    if (typeof settings['accelerator:priceCents'] === 'number') setPrice(String((settings['accelerator:priceCents'] as number) / 100));
    if (Array.isArray(settings['accelerator:channelCodes'])) setCodes((settings['accelerator:channelCodes'] as string[]).join(', '));
  }, [settings]);

  return (
    <div className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold">Commission & Accelerator defaults</h3>
      <div>
        <label className="label">Default platform commission (%)</label>
        <div className="flex gap-2">
          <input className="input" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
          <button
            className="btn-ghost !py-1.5"
            disabled={saving || !rate}
            onClick={() => onSave({ 'commission:defaultRateBps': Math.round(Number(rate) * 100) })}
          >
            Save
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Applies to every org without a per-organization override.</p>
      </div>
      <div>
        <label className="label">Accelerator price ($, one-time)</label>
        <div className="flex gap-2">
          <input className="input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          <button
            className="btn-ghost !py-1.5"
            disabled={saving || !price}
            onClick={() => onSave({ 'accelerator:priceCents': Math.round(Number(price) * 100) })}
          >
            Save
          </button>
        </div>
      </div>
      <div>
        <label className="label">Accelerator bundle (channel codes, comma-separated)</label>
        <div className="flex gap-2">
          <input className="input" value={codes} onChange={(e) => setCodes(e.target.value)} />
          <button
            className="btn-ghost !py-1.5"
            disabled={saving || !codes}
            onClick={() =>
              onSave({
                'accelerator:channelCodes': codes
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean),
              })
            }
          >
            Save
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Must match channel codes in the OTA catalogue (see Channels).</p>
      </div>
    </div>
  );
}

function StaffForm({ onSubmit, busy }: { onSubmit: (v: { name: string; email: string; password: string }) => void; busy: boolean }) {
  const [f, setF] = useState({ name: '', email: '', password: '' });
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </div>
      <div>
        <label className="label">Temporary password</label>
        <input className="input" type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </div>
      <button className="btn-primary w-full" disabled={busy || !f.name || !f.email || f.password.length < 8} onClick={() => onSubmit(f)}>
        Add to pool
      </button>
    </div>
  );
}

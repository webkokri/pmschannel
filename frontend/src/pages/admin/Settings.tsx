import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { dateTime, timeAgo } from '@/lib/format';

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

  const settings = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () => api<{ settings: Record<string, unknown> }>('/admin/platform/settings'),
  });
  const audit = useQuery({
    queryKey: ['platform-audit'],
    queryFn: () => api<{ logs: AuditRow[] }>('/admin/platform/audit-log?take=50'),
  });

  const saveSetting = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api('/admin/platform/settings', { method: 'PATCH', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-settings'] }),
  });

  const maintenanceMode = Boolean(settings.data?.settings.maintenanceMode);

  return (
    <div>
      <PageHeader title="Platform settings" subtitle="Global controls, commission defaults, and the platform audit log" />

      <div className="grid gap-4 lg:grid-cols-2">
        <CommissionAcceleratorCard settings={settings.data?.settings} onSave={(patch) => saveSetting.mutate(patch)} saving={saveSetting.isPending} />

        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">Global controls</h3>
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
  const [codes, setCodes] = useState('');

  useEffect(() => {
    if (!settings) return;
    if (typeof settings['commission:defaultRateBps'] === 'number') setRate(String((settings['commission:defaultRateBps'] as number) / 100));
    if (Array.isArray(settings['accelerator:channelCodes'])) setCodes((settings['accelerator:channelCodes'] as string[]).join(', '));
  }, [settings]);

  return (
    <div className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold">Commission & Accelerator defaults</h3>
      <div>
        <label className="label">Default commission (%) — 0 to 100, any rate</label>
        <div className="flex gap-2">
          <input className="input" type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)} />
          <button
            className="btn-ghost !py-1.5"
            disabled={saving || !rate}
            onClick={() => onSave({ 'commission:defaultRateBps': Math.round(Number(rate) * 100) })}
          >
            Save
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Applied to every booking payment unless the portfolio has its own override (set from Properties). In-house,
          so there's no ceiling other than 100%.
        </p>
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

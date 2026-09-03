import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth, roleAtLeast } from '@/lib/auth';
import { ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';

interface Settings {
  autoProtectOverbooking: boolean;
  detectRateMismatch: boolean;
  rateMismatchAbs: number;
  rateMismatchPct: number;
  defaultCurrency: string;
  stopSellOnZero: boolean;
  retryBackoffSec: number[];
}

export function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = roleAtLeast(user?.role, 'admin');

  const { data, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ settings: Settings }>('/settings'),
  });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api('/settings', { method: 'PATCH', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: { id: string; email: string; name: string; role: string; active: boolean }[] }>('/users'),
    enabled: isAdmin,
  });

  if (isLoading || !form) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const toggle = (k: keyof Settings) => {
    const next = { ...form, [k]: !form[k] };
    setForm(next);
    save.mutate({ [k]: next[k] });
  };
  const setNum = (k: keyof Settings, v: number) => {
    setForm({ ...form, [k]: v });
    save.mutate({ [k]: v });
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle={isAdmin ? 'Engine behaviour & users' : 'Engine behaviour (read-only)'} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">Conflict prevention</h3>
          {(
            [
              ['autoProtectOverbooking', 'Auto-protect: reject inbound bookings that would oversell'],
              ['detectRateMismatch', 'Flag rate mismatches between bookings and the calendar'],
              ['stopSellOnZero', 'Close a room on all channels the moment it hits zero availability'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-3 text-sm">
              <span>{label}</span>
              <input type="checkbox" className="h-4 w-4" disabled={!isAdmin} checked={form[k]} onChange={() => toggle(k)} />
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <label className="text-sm">
              <span className="label">Rate tolerance ($)</span>
              <input
                type="number"
                className="input"
                disabled={!isAdmin}
                value={form.rateMismatchAbs}
                onChange={(e) => setNum('rateMismatchAbs', Number(e.target.value))}
              />
            </label>
            <label className="text-sm">
              <span className="label">Rate tolerance (%)</span>
              <input
                type="number"
                step="0.01"
                className="input"
                disabled={!isAdmin}
                value={form.rateMismatchPct}
                onChange={(e) => setNum('rateMismatchPct', Number(e.target.value))}
              />
            </label>
          </div>
          {save.isPending && <p className="text-xs text-slate-400">Saving…</p>}
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Retry backoff</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Failed sync jobs retry after these delays (seconds), then move to <b>dead</b>.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {form.retryBackoffSec.map((s, i) => (
              <span key={i} className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                #{i + 1}: {s}s
              </span>
            ))}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Users</h3>
          {users.isLoading ? (
            <Spinner />
          ) : (
            <Table
              head={
                <>
                  <th className="th">Name</th>
                  <th className="th">Email</th>
                  <th className="th">Role</th>
                  <th className="th">Active</th>
                </>
              }
            >
              {users.data?.users.map((u) => (
                <tr key={u.id}>
                  <td className="td font-medium">{u.name}</td>
                  <td className="td text-slate-500">{u.email}</td>
                  <td className="td capitalize">{u.role}</td>
                  <td className="td">{u.active ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

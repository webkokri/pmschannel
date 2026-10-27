import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { roleAtLeast, useAuth } from '@/lib/auth';
import { Drawer, ErrorNote, LimitBanner, PageHeader, Spinner, Table } from '@/components/ui';

interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'viewer';
  active: boolean;
  title: string;
  department: string;
  phone: string;
  permissions: string[];
}

export function StaffPage() {
  const { user } = useAuth();
  const isAdmin = roleAtLeast(user?.role, 'admin');
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api<{ staff: StaffMember[]; availablePermissions: string[] }>('/staff'),
  });

  const create = useMutation({
    mutationFn: (v: Record<string, unknown>) => api('/staff', { method: 'POST', json: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      setAdding(false);
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...v }: Record<string, unknown> & { id: string }) => api(`/staff/${id}`, { method: 'PATCH', json: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/staff/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="Your team, their roles, and any extra permissions beyond their base role"
        actions={
          isAdmin && (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              + Add staff
            </button>
          )
        }
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}
      {create.error && <div className="mb-3"><LimitBanner error={create.error} /></div>}

      {data && (
        <Table
          head={
            <>
              <th className="th">Name</th>
              <th className="th">Title / department</th>
              <th className="th">Role</th>
              <th className="th">Extra permissions</th>
              <th className="th">Active</th>
              <th className="th" />
            </>
          }
        >
          {data.staff.map((s) => (
            <tr key={s.id}>
              <td className="td">
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-slate-400">{s.email}</p>
              </td>
              <td className="td text-slate-500">{[s.title, s.department].filter(Boolean).join(' · ') || '—'}</td>
              <td className="td capitalize">{s.role}</td>
              <td className="td">
                <div className="flex flex-wrap gap-1">
                  {s.permissions.length === 0 && <span className="text-slate-400">—</span>}
                  {s.permissions.map((p) => (
                    <span key={p} className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {p}
                    </span>
                  ))}
                </div>
              </td>
              <td className="td">{s.active ? 'yes' : 'no'}</td>
              <td className="td text-right">
                {isAdmin && (
                  <>
                    <button className="mr-3 text-brand-500 hover:underline" onClick={() => setEditing(s)}>
                      edit
                    </button>
                    <button className="text-rose-500 hover:underline" onClick={() => remove.mutate(s.id)}>
                      remove
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {adding && (
        <Drawer open onClose={() => setAdding(false)} title="Add staff member">
          <StaffForm
            permissions={data?.availablePermissions ?? []}
            busy={create.isPending}
            onSubmit={(v) => create.mutate(v)}
          />
        </Drawer>
      )}
      {editing && (
        <Drawer open onClose={() => setEditing(null)} title={`Edit ${editing.name}`}>
          <StaffForm
            initial={editing}
            permissions={data?.availablePermissions ?? []}
            busy={update.isPending}
            onSubmit={(v) => update.mutate({ id: editing.id, ...v })}
          />
        </Drawer>
      )}
    </div>
  );
}

function StaffForm({
  initial,
  permissions,
  onSubmit,
  busy,
}: {
  initial?: StaffMember;
  permissions: string[];
  onSubmit: (v: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [f, setF] = useState({
    email: initial?.email ?? '',
    name: initial?.name ?? '',
    role: initial?.role ?? 'viewer',
    title: initial?.title ?? '',
    department: initial?.department ?? '',
    phone: initial?.phone ?? '',
    password: '',
    permissions: initial?.permissions ?? ([] as string[]),
  });

  const togglePerm = (p: string) => {
    setF((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(p) ? prev.permissions.filter((x) => x !== p) : [...prev.permissions, p],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} disabled={!!initial} />
        </div>
        <div>
          <label className="label">Title</label>
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div>
          <label className="label">Department</label>
          <input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as StaffMember['role'] })}>
            <option value="viewer">Viewer</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">{initial ? 'New password (leave blank to keep current)' : 'Password'}</label>
        <input className="input" type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </div>
      <div>
        <label className="label">Extra permissions (beyond role)</label>
        <div className="flex flex-wrap gap-3 text-sm">
          {permissions.map((p) => (
            <label key={p} className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.permissions.includes(p)} onChange={() => togglePerm(p)} />
              {p}
            </label>
          ))}
        </div>
      </div>
      <button
        className="btn-primary w-full"
        disabled={busy || !f.name || !f.email || (!initial && f.password.length < 8)}
        onClick={() => {
          const payload: Record<string, unknown> = { ...f };
          if (!payload.password) delete payload.password;
          onSubmit(payload);
        }}
      >
        {initial ? 'Save changes' : 'Add staff member'}
      </button>
    </div>
  );
}

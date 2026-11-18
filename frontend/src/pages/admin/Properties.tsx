import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, Drawer, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { date, money } from '@/lib/format';

interface PropertyRow {
  id: string;
  name: string;
  code: string;
  country: string;
  active: boolean;
  createdAt: string;
  assignedManagers: { id: string; name: string; email: string; role: string; active: boolean }[];
  _count: { roomTypes: number; bookings: number };
}

interface PortfolioDetail {
  organization: {
    id: string;
    name: string;
    contactEmail: string;
    active: boolean;
    commissionRateBps: number | null;
    stripeConnectStatus: string;
  };
  usage: { properties: number; users: number; bookings: number };
  effectiveCommissionBps: number;
  platformRevenue: { commissionCents: number; grossCents: number };
  accelerator: { active: boolean; activatedAt: string | null; boostedChannelCodes: string[] } | null;
}

export function AdminPropertiesPage() {
  const qc = useQueryClient();
  const [addProp, setAddProp] = useState(false);
  const [assignFor, setAssignFor] = useState<PropertyRow | null>(null);

  const portfolio = useQuery({ queryKey: ['admin-portfolio'], queryFn: () => api<PortfolioDetail>('/admin/organizations') });
  const properties = useQuery({ queryKey: ['admin-properties'], queryFn: () => api<{ properties: PropertyRow[] }>('/admin/properties') });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-properties'] });
    qc.invalidateQueries({ queryKey: ['admin-portfolio'] });
  };

  const createProperty = useMutation({
    mutationFn: (json: Record<string, unknown>) => api('/admin/properties', { method: 'POST', json }),
    onSuccess: () => {
      invalidate();
      setAddProp(false);
    },
  });
  const deleteProperty = useMutation({
    mutationFn: (id: string) => api(`/admin/properties/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const unassign = useMutation({
    mutationFn: ({ propertyId, userId }: { propertyId: string; userId: string }) =>
      api(`/admin/properties/${propertyId}/unassign-manager/${userId}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const impersonate = useMutation({
    mutationFn: (propertyId: string) => api<{ token: string }>(`/admin/properties/${propertyId}/impersonate`, { method: 'POST' }),
    onSuccess: (r) => openImpersonated(r.token),
  });

  return (
    <div>
      <PageHeader
        title="Properties"
        subtitle={properties.data ? `${properties.data.properties.length} properties in the portfolio` : 'Add properties and assign a dedicated manager to each'}
        actions={
          <button className="btn-primary" onClick={() => setAddProp(true)}>
            + Property
          </button>
        }
      />

      {portfolio.data && <PortfolioCard detail={portfolio.data} onSaved={invalidate} />}

      {properties.isLoading && <Spinner />}
      {properties.error && <ErrorNote error={properties.error} />}
      {properties.data && (
        <Table
          head={
            <>
              <th className="th">Property</th>
              <th className="th">Manager</th>
              <th className="th">Usage</th>
              <th className="th">Added</th>
              <th className="th" />
            </>
          }
        >
          {properties.data.properties.map((p) => (
            <tr key={p.id}>
              <td className="td">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-slate-400">
                  {p.code} · {p.country}
                </p>
              </td>
              <td className="td">
                {p.assignedManagers.length === 0 ? (
                  <span className="text-amber-500">unassigned</span>
                ) : (
                  <div className="space-y-1">
                    {p.assignedManagers.map((m) => (
                      <div key={m.id} className="flex items-center gap-2">
                        <span>
                          {m.name} <span className="text-xs text-slate-400">· {m.email}</span>
                        </span>
                        <button
                          className="text-xs text-rose-500 hover:underline"
                          onClick={() => unassign.mutate({ propertyId: p.id, userId: m.id })}
                        >
                          unassign
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td className="td text-slate-500">
                {p._count.roomTypes} room types · {p._count.bookings} bookings
              </td>
              <td className="td text-slate-500">{date(p.createdAt)}</td>
              <td className="td text-right">
                <div className="flex justify-end gap-3">
                  <button className="text-brand-600 hover:underline dark:text-brand-400" onClick={() => setAssignFor(p)}>
                    assign
                  </button>
                  <button className="text-slate-500 hover:underline" onClick={() => impersonate.mutate(p.id)}>
                    impersonate
                  </button>
                  <button
                    className="text-rose-500 hover:underline"
                    onClick={() => {
                      if (confirm(`Delete ${p.name}? This removes all its data.`)) deleteProperty.mutate(p.id);
                    }}
                  >
                    delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {properties.data.properties.length === 0 && (
            <tr>
              <td className="td text-slate-500" colSpan={5}>
                No properties yet — add the first one.
              </td>
            </tr>
          )}
        </Table>
      )}

      {addProp && (
        <Drawer open onClose={() => setAddProp(false)} title="New property">
          {createProperty.error && <div className="mb-3"><ErrorNote error={createProperty.error} /></div>}
          <PropertyForm busy={createProperty.isPending} onSubmit={(v) => createProperty.mutate(v)} />
        </Drawer>
      )}

      {assignFor && (
        <AssignManagerDrawer
          property={assignFor}
          onClose={() => setAssignFor(null)}
          onAssigned={() => {
            invalidate();
            setAssignFor(null);
          }}
        />
      )}
    </div>
  );
}

function openImpersonated(token: string) {
  const w = window.open('/', '_blank');
  if (w) {
    setTimeout(() => {
      w.localStorage.setItem('cm.token', token);
      w.location.reload();
    }, 300);
  }
}

function PortfolioCard({ detail, onSaved }: { detail: PortfolioDetail; onSaved: () => void }) {
  const [commissionInput, setCommissionInput] = useState(
    detail.organization.commissionRateBps != null ? String(detail.organization.commissionRateBps / 100) : '',
  );
  const setCommission = useMutation({
    mutationFn: (commissionRateBps: number | null) => api('/admin/organizations/commission', { method: 'PATCH', json: { commissionRateBps } }),
    onSuccess: onSaved,
  });
  const compAccelerator = useMutation({
    mutationFn: () => api('/admin/organizations/accelerator/comp', { method: 'POST' }),
    onSuccess: onSaved,
  });
  const deactivateAccelerator = useMutation({
    mutationFn: () => api('/admin/organizations/accelerator/deactivate', { method: 'POST' }),
    onSuccess: onSaved,
  });

  return (
    <div className="card mb-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{detail.organization.name}</h3>
          <p className="text-xs text-slate-400">
            {detail.usage.properties} properties · {detail.usage.users} staff · {detail.usage.bookings} bookings total
          </p>
        </div>
        <Badge status={detail.organization.stripeConnectStatus}>Connect: {detail.organization.stripeConnectStatus}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label">Commission rate — 0% to 100%, in-house</p>
          <div className="flex gap-2">
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder={`platform default (${(detail.effectiveCommissionBps / 100).toFixed(2)}%)`}
              value={commissionInput}
              onChange={(e) => setCommissionInput(e.target.value)}
            />
            <button
              className="btn-ghost !py-1.5"
              disabled={setCommission.isPending}
              onClick={() => setCommission.mutate(commissionInput ? Math.round(Number(commissionInput) * 100) : null)}
            >
              Save
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Effective rate: {(detail.effectiveCommissionBps / 100).toFixed(2)}%</p>
        </div>

        <div>
          <p className="label">Accelerator</p>
          <div className="flex items-center justify-between">
            <span className="text-sm">{detail.accelerator?.active ? 'Active' : 'Inactive'}</span>
            {!detail.accelerator?.active ? (
              <button className="btn-ghost !py-1.5" disabled={compAccelerator.isPending} onClick={() => compAccelerator.mutate()}>
                Activate
              </button>
            ) : (
              <button className="btn-ghost !py-1.5" disabled={deactivateAccelerator.isPending} onClick={() => deactivateAccelerator.mutate()}>
                Deactivate
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Platform revenue: {money(detail.platformRevenue.commissionCents / 100)} commission on{' '}
        {money(detail.platformRevenue.grossCents / 100)} processed.
      </p>
    </div>
  );
}

function AssignManagerDrawer({
  property,
  onClose,
  onAssigned,
}: {
  property: PropertyRow;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [userId, setUserId] = useState('');
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'admin' as 'admin' | 'manager' | 'viewer' });

  const unassigned = useQuery({
    queryKey: ['admin-unassigned-users'],
    queryFn: () => api<{ users: { id: string; name: string; email: string; role: string }[] }>('/admin/properties/unassigned-users'),
  });

  const assign = useMutation({
    mutationFn: (json: Record<string, unknown>) => api(`/admin/properties/${property.id}/assign-manager`, { method: 'POST', json }),
    onSuccess: onAssigned,
  });

  return (
    <Drawer open onClose={onClose} title={`Assign manager — ${property.name}`}>
      {assign.error && <div className="mb-3"><ErrorNote error={assign.error} /></div>}
      <div className="mb-4 flex gap-2">
        <button className={mode === 'new' ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'} onClick={() => setMode('new')}>
          New account
        </button>
        <button className={mode === 'existing' ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'} onClick={() => setMode('existing')}>
          Existing staff
        </button>
      </div>

      {mode === 'existing' ? (
        <div className="space-y-3">
          {unassigned.isLoading ? (
            <Spinner />
          ) : (
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Select a staff member…</option>
              {unassigned.data?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </option>
              ))}
            </select>
          )}
          <button className="btn-primary w-full" disabled={!userId || assign.isPending} onClick={() => assign.mutate({ userId })}>
            Assign
          </button>
        </div>
      ) : (
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
          <div>
            <label className="label">Role</label>
            <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as typeof f.role })}>
              <option value="admin">Admin (full control of this property)</option>
              <option value="manager">Manager</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button
            className="btn-primary w-full"
            disabled={assign.isPending || !f.name || !f.email || f.password.length < 8}
            onClick={() => assign.mutate(f)}
          >
            Create & assign
          </button>
        </div>
      )}
    </Drawer>
  );
}

function PropertyForm({ onSubmit, busy }: { onSubmit: (v: Record<string, unknown>) => void; busy: boolean }) {
  const [f, setF] = useState({
    code: '',
    name: '',
    city: '',
    region: '',
    country: 'US',
    currency: 'USD',
    timezone: 'America/New_York',
  });
  return (
    <div className="space-y-3">
      {(['name', 'code', 'city', 'region'] as const).map((k) => (
        <div key={k}>
          <label className="label">{k}</label>
          <input
            className="input"
            value={f[k]}
            onChange={(e) => setF({ ...f, [k]: k === 'code' ? e.target.value.toUpperCase() : e.target.value })}
          />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Country</label>
          <select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
            <option value="US">US</option>
            <option value="CA">CA</option>
          </select>
        </div>
        <div>
          <label className="label">Currency</label>
          <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option>USD</option>
            <option>CAD</option>
          </select>
        </div>
      </div>
      <button className="btn-primary w-full" disabled={busy || !f.code || !f.name} onClick={() => onSubmit(f)}>
        Create property
      </button>
    </div>
  );
}

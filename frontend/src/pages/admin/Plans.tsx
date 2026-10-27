import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Drawer, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { money } from '@/lib/format';

interface Limits {
  maxProperties: number;
  maxRoomTypesPerProperty: number;
  maxChannelConnections: number;
  maxUsers: number;
  channelCategories: string[];
}
interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  limits: Limits;
  isPublic: boolean;
  sortOrder: number;
  active: boolean;
  _count: { subscriptions: number };
}

const CATEGORIES = ['direct_misc', 'global', 'north_america', 'pms'];

export function AdminPlansPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-plans'],
    queryFn: () => api<{ plans: Plan[] }>('/admin/plans'),
  });

  const save = useMutation({
    mutationFn: ({ id, ...body }: Partial<Plan> & { id?: string }) =>
      id ? api(`/admin/plans/${id}`, { method: 'PATCH', json: body }) : api('/admin/plans', { method: 'POST', json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-plans'] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-plans'] }),
  });

  return (
    <div>
      <PageHeader
        title="Plans"
        subtitle="The subscription packages hotel owners can sign up for or be moved to"
        actions={
          <button className="btn-primary" onClick={() => setEditing('new')}>
            + New plan
          </button>
        }
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}
      {data && (
        <Table
          head={
            <>
              <th className="th">Plan</th>
              <th className="th">Price / mo</th>
              <th className="th">Properties</th>
              <th className="th">Channels</th>
              <th className="th">Users</th>
              <th className="th">Subscribers</th>
              <th className="th">Public</th>
              <th className="th" />
            </>
          }
        >
          {data.plans.map((p) => (
            <tr key={p.id}>
              <td className="td font-medium">
                {p.name} <span className="text-slate-400">({p.code})</span>
              </td>
              <td className="td">{money(p.priceMonthlyCents / 100, p.currency)}</td>
              <td className="td">{p.limits.maxProperties >= 999 ? '∞' : p.limits.maxProperties}</td>
              <td className="td">{p.limits.maxChannelConnections >= 999 ? '∞' : p.limits.maxChannelConnections}</td>
              <td className="td">{p.limits.maxUsers}</td>
              <td className="td">{p._count.subscriptions}</td>
              <td className="td">{p.isPublic ? 'yes' : 'no'}</td>
              <td className="td text-right">
                <button className="mr-3 text-brand-500 hover:underline" onClick={() => setEditing(p)}>
                  edit
                </button>
                <button className="text-rose-500 hover:underline" onClick={() => remove.mutate(p.id)}>
                  delete
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {editing && (
        <PlanDrawer
          plan={editing === 'new' ? null : editing}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(v) => save.mutate(editing === 'new' ? v : { id: editing.id, ...v })}
        />
      )}
    </div>
  );
}

function PlanDrawer({
  plan,
  onClose,
  onSave,
  busy,
}: {
  plan: Plan | null;
  onClose: () => void;
  onSave: (v: Partial<Plan>) => void;
  busy: boolean;
}) {
  const [f, setF] = useState<Partial<Plan> & { limits: Limits }>(
    plan ?? {
      code: '',
      name: '',
      description: '',
      priceMonthlyCents: 0,
      priceYearlyCents: 0,
      currency: 'USD',
      isPublic: true,
      sortOrder: 0,
      limits: {
        maxProperties: 1,
        maxRoomTypesPerProperty: 10,
        maxChannelConnections: 3,
        maxUsers: 2,
        channelCategories: ['direct_misc'],
      },
    },
  );

  const toggleCategory = (c: string) => {
    const has = f.limits.channelCategories.includes(c);
    setF({
      ...f,
      limits: {
        ...f.limits,
        channelCategories: has ? f.limits.channelCategories.filter((x) => x !== c) : [...f.limits.channelCategories, c],
      },
    });
  };

  return (
    <Drawer open onClose={onClose} title={plan ? `Edit ${plan.name}` : 'New plan'}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Code</label>
            <input className="input" value={f.code} disabled={!!plan} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Price / mo (cents)</label>
            <input
              type="number"
              className="input"
              value={f.priceMonthlyCents}
              onChange={(e) => setF({ ...f, priceMonthlyCents: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Price / yr (cents)</label>
            <input
              type="number"
              className="input"
              value={f.priceYearlyCents}
              onChange={(e) => setF({ ...f, priceYearlyCents: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Max properties</label>
            <input
              type="number"
              className="input"
              value={f.limits.maxProperties}
              onChange={(e) => setF({ ...f, limits: { ...f.limits, maxProperties: Number(e.target.value) } })}
            />
          </div>
          <div>
            <label className="label">Max channels</label>
            <input
              type="number"
              className="input"
              value={f.limits.maxChannelConnections}
              onChange={(e) => setF({ ...f, limits: { ...f.limits, maxChannelConnections: Number(e.target.value) } })}
            />
          </div>
          <div>
            <label className="label">Max users</label>
            <input
              type="number"
              className="input"
              value={f.limits.maxUsers}
              onChange={(e) => setF({ ...f, limits: { ...f.limits, maxUsers: Number(e.target.value) } })}
            />
          </div>
        </div>
        <div>
          <label className="label">Room types / property</label>
          <input
            type="number"
            className="input"
            value={f.limits.maxRoomTypesPerProperty}
            onChange={(e) => setF({ ...f, limits: { ...f.limits, maxRoomTypesPerProperty: Number(e.target.value) } })}
          />
        </div>
        <div>
          <label className="label">Allowed channel categories</label>
          <div className="flex flex-wrap gap-3 text-sm">
            {CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="checkbox" checked={f.limits.channelCategories.includes(c)} onChange={() => toggleCategory(c)} />
                {c === 'pms' ? 'PMS' : c.replace('_', ' ')}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isPublic ?? true} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} />
          Public (shown on signup page)
        </label>
        <button className="btn-primary w-full" disabled={busy || !f.code || !f.name} onClick={() => onSave(f)}>
          Save plan
        </button>
      </div>
    </Drawer>
  );
}

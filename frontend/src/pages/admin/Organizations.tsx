import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, Drawer, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { date, money } from '@/lib/format';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  country: string;
  status: string;
  createdAt: string;
  subscription: { status: string; plan: { code: string; name: string; priceMonthlyCents: number } } | null;
  supportManager: { id: string; name: string; email: string } | null;
  _count: { properties: number; users: number; bookings: number };
}

interface Plan {
  id: string;
  code: string;
  name: string;
}

export function AdminOrganizationsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-orgs', search],
    queryFn: () => api<{ organizations: OrgRow[] }>(`/admin/organizations${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle={data ? `${data.organizations.length} tenants` : 'Every hotel/property owner on the platform'}
        actions={
          <input
            className="input"
            placeholder="Search name / email…"
            defaultValue={search}
            onChange={(e) => setParams(e.target.value ? { search: e.target.value } : {})}
          />
        }
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}
      {data && (
        <Table
          head={
            <>
              <th className="th">Organization</th>
              <th className="th">Status</th>
              <th className="th">Plan</th>
              <th className="th">Usage</th>
              <th className="th">Support manager</th>
              <th className="th">Joined</th>
            </>
          }
        >
          {data.organizations.map((o) => (
            <tr key={o.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setOpenId(o.id)}>
              <td className="td">
                <p className="font-medium">{o.name}</p>
                <p className="text-xs text-slate-400">{o.contactEmail}</p>
              </td>
              <td className="td">
                <Badge status={o.status} />
              </td>
              <td className="td">{o.subscription?.plan.name ?? '—'}</td>
              <td className="td text-slate-500">
                {o._count.properties} prop · {o._count.users} users · {o._count.bookings} bookings
              </td>
              <td className="td text-slate-500">{o.supportManager?.name ?? <span className="text-amber-500">unassigned</span>}</td>
              <td className="td text-slate-500">{date(o.createdAt)}</td>
            </tr>
          ))}
          {data.organizations.length === 0 && (
            <tr>
              <td className="td text-slate-500" colSpan={6}>
                No organizations match.
              </td>
            </tr>
          )}
        </Table>
      )}

      {openId && <OrgDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

interface OrgDetail {
  organization: OrgRow & {
    users: { id: string; name: string; email: string; role: string; active: boolean }[];
    properties: { id: string; name: string; code: string; country: string; active: boolean }[];
    commissionRateBps: number | null;
    stripeConnectStatus: string;
    accelerator: { active: boolean; activatedAt: string | null; boostedChannelCodes: string[] } | null;
  };
  usage: { plan: { name: string; limits: Record<string, number> }; usage: Record<string, number> } | null;
  effectiveCommissionBps: number;
  platformRevenue: { commissionCents: number; grossCents: number };
}

function OrgDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-org', id],
    queryFn: () => api<OrgDetail>(`/admin/organizations/${id}`),
  });
  const plans = useQuery({ queryKey: ['admin-plans-lite'], queryFn: () => api<{ plans: Plan[] }>('/admin/plans') });
  const staff = useQuery({
    queryKey: ['admin-support-managers'],
    queryFn: () => api<{ staff: { id: string; name: string; email: string; active: boolean }[] }>('/admin/platform/support-managers'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-org', id] });
    qc.invalidateQueries({ queryKey: ['admin-orgs'] });
  };

  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/admin/organizations/${id}/status`, { method: 'PATCH', json: { status } }),
    onSuccess: invalidate,
  });
  const setPlan = useMutation({
    mutationFn: (planCode: string) => api(`/admin/organizations/${id}/plan`, { method: 'PATCH', json: { planCode } }),
    onSuccess: invalidate,
  });
  const setSupport = useMutation({
    mutationFn: (supportManagerId: string | null) =>
      api(`/admin/organizations/${id}/support-manager`, { method: 'PATCH', json: { supportManagerId } }),
    onSuccess: invalidate,
  });
  const setCommission = useMutation({
    mutationFn: (commissionRateBps: number | null) =>
      api(`/admin/organizations/${id}/commission`, { method: 'PATCH', json: { commissionRateBps } }),
    onSuccess: invalidate,
  });
  const compAccelerator = useMutation({
    mutationFn: () => api(`/admin/organizations/${id}/accelerator/comp`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const deactivateAccelerator = useMutation({
    mutationFn: () => api(`/admin/organizations/${id}/accelerator/deactivate`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const [commissionInput, setCommissionInput] = useState('');
  const impersonate = useMutation({
    mutationFn: () => api<{ token: string; user: { id: string } }>(`/admin/organizations/${id}/impersonate`, { method: 'POST' }),
    onSuccess: (r) => {
      // Open the org portal in a new tab, signed in as this org's admin.
      const w = window.open('/', '_blank');
      if (w) {
        setTimeout(() => {
          w.localStorage.setItem('cm.token', r.token);
          w.location.reload();
        }, 300);
      }
    },
  });

  const o = data?.organization;

  useEffect(() => {
    if (data) setCommissionInput(o?.commissionRateBps != null ? String(o.commissionRateBps / 100) : '');
  }, [data]);

  return (
    <Drawer open onClose={onClose} title={o?.name ?? 'Organization'} width="max-w-2xl">
      {isLoading || !o ? (
        <Spinner />
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={o.status} />
            <span className="text-slate-400">{o.slug}</span>
            <span className="text-slate-400">· {o.contactEmail}</span>
            <span className="text-slate-400">· {o.country}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="label">Status</p>
              <select
                className="input"
                value={o.status}
                onChange={(e) => setStatus.mutate(e.target.value)}
                disabled={setStatus.isPending}
              >
                {['trialing', 'active', 'past_due', 'suspended', 'canceled'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="label">Plan</p>
              <select
                className="input"
                value={o.subscription?.plan.code ?? ''}
                onChange={(e) => setPlan.mutate(e.target.value)}
                disabled={setPlan.isPending || plans.isLoading}
              >
                {plans.data?.plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {data?.usage && (
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="mb-1 text-xs font-medium text-slate-400">Usage vs {data.usage.plan.name} limits</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>Properties: {data.usage.usage.properties} / {data.usage.plan.limits.maxProperties}</div>
                <div>Channels: {data.usage.usage.channelConnections} / {data.usage.plan.limits.maxChannelConnections}</div>
                <div>Users: {data.usage.usage.users} / {data.usage.plan.limits.maxUsers}</div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-medium text-slate-400">Commission & Accelerator</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="label">Commission rate override (%)</p>
                <div className="flex gap-2">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder={`platform default (${(data!.effectiveCommissionBps / 100).toFixed(2)}%)`}
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
                <p className="mt-1 text-xs text-slate-500">Effective rate: {(data!.effectiveCommissionBps / 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="label">Stripe Connect payouts</p>
                <Badge status={o.stripeConnectStatus} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className="text-xs">
                  Accelerator: <Badge status={o.accelerator?.active ? 'active' : 'not_started'}>{o.accelerator?.active ? 'active' : 'inactive'}</Badge>
                </p>
                {o.accelerator?.active && o.accelerator.activatedAt && (
                  <p className="mt-1 text-xs text-slate-500">
                    Since {date(o.accelerator.activatedAt)} · {o.accelerator.boostedChannelCodes.length} channels boosted
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {!o.accelerator?.active && (
                  <button className="btn-ghost !py-1.5" disabled={compAccelerator.isPending} onClick={() => compAccelerator.mutate()}>
                    Comp for free
                  </button>
                )}
                {o.accelerator?.active && (
                  <button className="btn-ghost !py-1.5" disabled={deactivateAccelerator.isPending} onClick={() => deactivateAccelerator.mutate()}>
                    Deactivate
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Platform revenue from this org: {money(data!.platformRevenue.commissionCents / 100)} commission on{' '}
              {money(data!.platformRevenue.grossCents / 100)} processed.
            </p>
          </div>

          <div>
            <p className="label">Dedicated support manager</p>
            <select
              className="input"
              value={o.supportManager?.id ?? ''}
              onChange={(e) => setSupport.mutate(e.target.value || null)}
              disabled={setSupport.isPending || staff.isLoading}
            >
              <option value="">Unassigned</option>
              {staff.data?.staff.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.active}>
                  {s.name} {!s.active ? '(inactive)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => impersonate.mutate()} disabled={impersonate.isPending}>
              Impersonate (opens new tab)
            </button>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">Users ({o.users.length})</p>
            <div className="space-y-1">
              {o.users.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-800">
                  <span>
                    {u.name} <span className="text-slate-400">· {u.email}</span>
                  </span>
                  <span className="capitalize text-slate-400">{u.role}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">Properties ({o.properties.length})</p>
            <div className="space-y-1">
              {o.properties.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-800">
                  <span>
                    {p.name} <span className="text-slate-400">· {p.code}</span>
                  </span>
                  <span className="text-slate-400">{p.country}</span>
                </div>
              ))}
              {o.properties.length === 0 && <p className="text-xs text-slate-500">No properties yet.</p>}
            </div>
          </div>

          {o.subscription && (
            <p className="text-xs text-slate-400">
              Monthly price: {money(o.subscription.plan.priceMonthlyCents / 100)} · subscription status: {o.subscription.status}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

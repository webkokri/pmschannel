import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { api } from '@/api/client';
import { PageHeader, Spinner, StatCard, ErrorNote } from '@/components/ui';
import { money, shortDate } from '@/lib/format';

interface Overview {
  totalOrgs: number;
  byStatus: Record<string, number>;
  mrrCents: number;
  planBreakdown: { plan: string; count: number }[];
  signups30d: number;
  signupTrend: { date: string; count: number }[];
  pastDue: { id: string; name: string; contactEmail: string }[];
  pendingUpgrades: { organization: { id: string; name: string }; requestedPlan: string }[];
  totalProperties: number;
  totalBookings30d: number;
  commissionRevenue30dCents: number;
  commissionRevenueAllTimeCents: number;
  acceleratorActiveCount: number;
}

export function AdminOverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<Overview>('/admin/platform/overview'),
    refetchInterval: 30_000,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'error'} />;

  return (
    <div>
      <PageHeader title="Platform overview" subtitle="Every organization, subscription and dollar on the platform" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Organizations" value={data.totalOrgs} sub={`${data.signups30d} new · 30d`} />
        <StatCard label="Estimated MRR" value={money(data.mrrCents / 100)} />
        <StatCard label="Properties" value={data.totalProperties} />
        <StatCard label="Bookings · 30d" value={data.totalBookings30d} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Commission revenue · 30d" value={money(data.commissionRevenue30dCents / 100)} tone="good" />
        <StatCard label="Commission revenue · all time" value={money(data.commissionRevenueAllTimeCents / 100)} tone="good" />
        <StatCard label="Accelerator adoption" value={data.acceleratorActiveCount} sub="active organizations" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        {Object.entries(data.byStatus).map(([status, count]) => (
          <StatCard key={status} label={status.replace('_', ' ')} value={count} tone={status === 'past_due' ? 'warn' : status === 'suspended' ? 'bad' : 'default'} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Signups · 30 days</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.signupTrend} margin={{ left: -12, right: 8, top: 4 }}>
              <defs>
                <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#356ef4" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#356ef4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
              <XAxis dataKey="date" tickFormatter={shortDate} fontSize={11} stroke="#94a3b8" minTickGap={24} />
              <YAxis fontSize={11} stroke="#94a3b8" allowDecimals={false} />
              <Tooltip labelFormatter={(d) => shortDate(d as string)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Area type="monotone" dataKey="count" stroke="#356ef4" fill="url(#sg)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Plan breakdown</h3>
          <div className="space-y-2">
            {data.planBreakdown.map((p) => (
              <div key={p.plan} className="flex items-center justify-between text-sm">
                <span>{p.plan}</span>
                <span className="font-semibold">{p.count}</span>
              </div>
            ))}
            {data.planBreakdown.length === 0 && <p className="text-sm text-slate-500">No subscriptions yet.</p>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Past due</h3>
          {data.pastDue.length === 0 ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">Nothing past due.</p>
          ) : (
            <div className="space-y-1.5">
              {data.pastDue.map((o) => (
                <Link key={o.id} to={`/admin/organizations?search=${encodeURIComponent(o.name)}`} className="block text-sm hover:underline">
                  {o.name} <span className="text-slate-400">· {o.contactEmail}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Pending upgrade requests</h3>
          {data.pendingUpgrades.length === 0 ? (
            <p className="text-sm text-slate-500">None right now.</p>
          ) : (
            <div className="space-y-1.5">
              {data.pendingUpgrades.map((p, i) => (
                <Link
                  key={i}
                  to={`/admin/organizations?search=${encodeURIComponent(p.organization.name)}`}
                  className="block text-sm hover:underline"
                >
                  {p.organization.name} <span className="text-slate-400">→ requested {p.requestedPlan}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Badge, PageHeader, Spinner, StatCard } from '@/components/ui';
import { money, pct, shortDate, timeAgo } from '@/lib/format';

interface DashboardData {
  kpis: {
    bookings24h: number;
    bookings7d: number;
    revenue7d: number;
    adr: number;
    occupancy: number;
    openConflicts: number;
    pendingJobs: number;
    deadJobs: number;
    activeChannels: number;
    connectedChannels: number;
    properties: number;
  };
  trend: { date: string; bookings: number; revenue: number }[];
  channelMix: { channel: string; bookings: number; revenue: number }[];
  recentBookings: {
    id: string;
    guestName: string;
    status: string;
    amount: string;
    checkIn: string;
    sourceChannel: { name: string };
    roomType?: { name: string } | null;
    property: { name: string };
  }[];
  conflicts: { id: string; type: string; severity: string; details: { message?: string } }[];
}

const MIX_COLORS = ['#356ef4', '#5a95ff', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b'];

export function DashboardPage() {
  const { selectedId, selected } = useProperty();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', selectedId],
    queryFn: () => api<DashboardData>(`/dashboard${selectedId ? `?propertyId=${selectedId}` : ''}`),
    refetchInterval: 15_000,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <PageHeader title="Dashboard" subtitle="Could not load dashboard" />;

  const k = data.kpis;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={selected ? `${selected.name} · live overview` : 'All properties'}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Bookings · 24h" value={k.bookings24h} sub={`${k.bookings7d} in last 7 days`} />
        <StatCard label="Revenue · 7d" value={money(k.revenue7d, selected?.currency)} sub={`ADR ${money(k.adr, selected?.currency)}`} />
        <StatCard label="Occupancy · 30d" value={pct(k.occupancy)} />
        <StatCard
          label="Open conflicts"
          value={k.openConflicts}
          tone={k.openConflicts > 0 ? 'bad' : 'good'}
          sub={<Link className="underline" to="/conflicts">review</Link>}
        />
        <StatCard label="Connected channels" value={`${k.connectedChannels}`} sub={`${k.activeChannels} in catalogue`} />
        <StatCard
          label="Pending sync jobs"
          value={k.pendingJobs}
          tone={k.pendingJobs > 20 ? 'warn' : 'default'}
          sub={<Link className="underline" to="/sync">sync logs</Link>}
        />
        <StatCard label="Dead jobs" value={k.deadJobs} tone={k.deadJobs > 0 ? 'bad' : 'good'} />
        <StatCard label="Properties" value={k.properties} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Bookings &amp; revenue · 30 days</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.trend} margin={{ left: -12, right: 8, top: 4 }}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#356ef4" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#356ef4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
              <XAxis dataKey="date" tickFormatter={shortDate} fontSize={11} stroke="#94a3b8" minTickGap={24} />
              <YAxis fontSize={11} stroke="#94a3b8" allowDecimals={false} />
              <Tooltip
                labelFormatter={(d) => shortDate(d as string)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Area type="monotone" dataKey="bookings" stroke="#356ef4" fill="url(#g)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Channel mix · 30 days</h3>
          {data.channelMix.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">No bookings yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.channelMix} layout="vertical" margin={{ left: 24, right: 12 }}>
                <XAxis type="number" fontSize={11} stroke="#94a3b8" allowDecimals={false} />
                <YAxis type="category" dataKey="channel" width={90} fontSize={11} stroke="#94a3b8" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="bookings" radius={4}>
                  {data.channelMix.map((_, i) => (
                    <Cell key={i} fill={MIX_COLORS[i % MIX_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Recent bookings</h3>
          <div className="space-y-1.5">
            {data.recentBookings.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{b.guestName}</span>{' '}
                  <span className="text-slate-500">
                    · {b.sourceChannel.name} · {b.roomType?.name ?? 'unmapped'}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-slate-500">{shortDate(b.checkIn)}</span>
                  <Badge status={b.status} />
                </div>
              </div>
            ))}
            {data.recentBookings.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
          </div>
          <Link to="/bookings" className="mt-3 inline-block text-sm text-brand-500 underline">
            All bookings →
          </Link>
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Open conflicts</h3>
          <div className="space-y-2">
            {data.conflicts.map((c) => (
              <Link
                key={c.id}
                to="/conflicts"
                className="block rounded-lg border border-slate-200 p-2 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Badge status={c.severity} />
                  <span className="font-medium capitalize">{c.type.replace('_', ' ')}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{c.details?.message}</p>
              </Link>
            ))}
            {data.conflicts.length === 0 && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">All clear — no open conflicts.</p>
            )}
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-400">Auto-refreshing every 15s · {timeAgo(new Date())}</p>
    </div>
  );
}

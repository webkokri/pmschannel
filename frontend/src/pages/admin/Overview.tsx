import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { api } from '@/api/client';
import { PageHeader, Spinner, StatCard, ErrorNote } from '@/components/ui';
import { money, shortDate } from '@/lib/format';

interface Overview {
  totalProperties: number;
  assignedPropertyCount: number;
  unassignedPropertyCount: number;
  totalBookings30d: number;
  bookingTrend: { date: string; count: number }[];
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
      <PageHeader title="Portfolio overview" subtitle="Every property, manager and dollar across the portfolio" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Properties" value={data.totalProperties} sub={`${data.unassignedPropertyCount} unassigned`} />
        <StatCard label="Properties with a manager" value={data.assignedPropertyCount} />
        <StatCard label="Bookings · 30d" value={data.totalBookings30d} />
        <StatCard label="Accelerator active" value={data.acceleratorActiveCount} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-2">
        <StatCard label="Commission revenue · 30d" value={money(data.commissionRevenue30dCents / 100)} tone="good" />
        <StatCard label="Commission revenue · all time" value={money(data.commissionRevenueAllTimeCents / 100)} tone="good" />
      </div>

      <div className="mt-4 card p-4">
        <h3 className="mb-3 text-sm font-semibold">Bookings · 30 days</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data.bookingTrend} margin={{ left: -12, right: 8, top: 4 }}>
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
    </div>
  );
}

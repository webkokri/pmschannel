import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Badge, Drawer, EmptyState, ErrorNote, PageHeader, Spinner, StatCard, Table } from '@/components/ui';
import { date, money } from '@/lib/format';

interface Overview {
  from: string;
  to: string;
  grossRevenue: number;
  commissionCost: number;
  expenseTotal: number;
  netRevenue: number;
  byChannel: { channel: string; bookings: number; gross: number; commission: number }[];
  expenses: { id: string; category: string; amountCents: number; vendor: string; note: string; incurredAt: string }[];
  platformPayments: {
    grossCents: number;
    commissionCents: number;
    netCents: number;
    refundedCents: number;
    connectStatus: string;
    commissionRateBps: number | null;
  };
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function FinancePage() {
  const { selectedId, selected } = useProperty();
  const qc = useQueryClient();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [addExpense, setAddExpense] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['finance', selectedId, from, to],
    queryFn: () => api<Overview>(`/finance/overview?propertyId=${selectedId}&from=${from}&to=${to}`),
    enabled: !!selectedId,
  });

  const createExpense = useMutation({
    mutationFn: (v: Record<string, unknown>) => api('/finance/expenses', { method: 'POST', json: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance'] });
      setAddExpense(false);
    },
  });
  const deleteExpense = useMutation({
    mutationFn: (id: string) => api(`/finance/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance'] }),
  });

  if (!selectedId) return <EmptyState title="Select a property" />;

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle={selected ? `${selected.name} · revenue, commission & expenses` : ''}
        actions={
          <div className="flex items-center gap-2">
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn-primary" onClick={() => setAddExpense(true)}>
              + Expense
            </button>
          </div>
        }
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Gross revenue" value={money(data.grossRevenue, selected?.currency)} />
            <StatCard label="Channel commission" value={money(data.commissionCost, selected?.currency)} tone="warn" />
            <StatCard label="Expenses" value={money(data.expenseTotal, selected?.currency)} tone="warn" />
            <StatCard label="Net revenue" value={money(data.netRevenue, selected?.currency)} tone={data.netRevenue >= 0 ? 'good' : 'bad'} />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Guest payments processed through the platform</h3>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Stripe Connect:</span>
              <Badge status={data.platformPayments.connectStatus} />
              {data.platformPayments.commissionRateBps != null && (
                <span>· custom commission {(data.platformPayments.commissionRateBps / 100).toFixed(2)}%</span>
              )}
            </div>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Separate from OTA commission above — this is what guests paid directly to us for this property, and what we deducted before
            transferring the rest to your connected account.
          </p>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Guest payments (gross)" value={money(data.platformPayments.grossCents / 100, selected?.currency)} />
            <StatCard label="Our commission" value={money(data.platformPayments.commissionCents / 100, selected?.currency)} tone="warn" />
            <StatCard label="Transferred to you" value={money(data.platformPayments.netCents / 100, selected?.currency)} tone="good" />
            <StatCard label="Refunded" value={money(data.platformPayments.refundedCents / 100, selected?.currency)} />
          </div>

          <h3 className="mb-2 mt-6 text-sm font-semibold">Revenue by channel</h3>
          <Table
            head={
              <>
                <th className="th">Channel</th>
                <th className="th">Bookings</th>
                <th className="th">Gross</th>
                <th className="th">Commission</th>
                <th className="th">Net</th>
              </>
            }
          >
            {data.byChannel.map((c) => (
              <tr key={c.channel}>
                <td className="td font-medium">{c.channel}</td>
                <td className="td">{c.bookings}</td>
                <td className="td">{money(c.gross, selected?.currency)}</td>
                <td className="td text-amber-600 dark:text-amber-400">{money(c.commission, selected?.currency)}</td>
                <td className="td">{money(c.gross - c.commission, selected?.currency)}</td>
              </tr>
            ))}
            {data.byChannel.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={5}>
                  No bookings in this range.
                </td>
              </tr>
            )}
          </Table>

          <h3 className="mb-2 mt-6 text-sm font-semibold">Expenses</h3>
          <Table
            head={
              <>
                <th className="th">Date</th>
                <th className="th">Category</th>
                <th className="th">Vendor</th>
                <th className="th">Note</th>
                <th className="th">Amount</th>
                <th className="th" />
              </>
            }
          >
            {data.expenses.map((e) => (
              <tr key={e.id}>
                <td className="td text-slate-500">{date(e.incurredAt)}</td>
                <td className="td capitalize">{e.category}</td>
                <td className="td">{e.vendor || '—'}</td>
                <td className="td text-slate-500">{e.note || '—'}</td>
                <td className="td">{money(e.amountCents / 100, selected?.currency)}</td>
                <td className="td text-right">
                  <button className="text-rose-500 hover:underline" onClick={() => deleteExpense.mutate(e.id)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
            {data.expenses.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={6}>
                  No expenses logged in this range.
                </td>
              </tr>
            )}
          </Table>
        </>
      )}

      {addExpense && (
        <Drawer open onClose={() => setAddExpense(false)} title="Log an expense">
          <ExpenseForm propertyId={selectedId} busy={createExpense.isPending} onSubmit={(v) => createExpense.mutate(v)} />
        </Drawer>
      )}
    </div>
  );
}

function ExpenseForm({ propertyId, onSubmit, busy }: { propertyId: string; onSubmit: (v: Record<string, unknown>) => void; busy: boolean }) {
  const [f, setF] = useState({
    category: 'utilities',
    amount: '',
    incurredAt: todayIso(),
    vendor: '',
    note: '',
  });
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Category</label>
        <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {['utilities', 'payroll', 'maintenance', 'supplies', 'marketing', 'other'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Amount</label>
          <input className="input" type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </div>
        <div>
          <label className="label">Date</label>
          <input className="input" type="date" value={f.incurredAt} onChange={(e) => setF({ ...f, incurredAt: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="label">Vendor</label>
        <input className="input" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
      </div>
      <div>
        <label className="label">Note</label>
        <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      <button
        className="btn-primary w-full"
        disabled={busy || !f.amount}
        onClick={() =>
          onSubmit({ propertyId, category: f.category, amountCents: Math.round(Number(f.amount) * 100), incurredAt: f.incurredAt, vendor: f.vendor, note: f.note })
        }
      >
        Save expense
      </button>
    </div>
  );
}

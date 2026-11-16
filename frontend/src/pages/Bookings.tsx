import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Badge, Drawer, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { date, money, timeAgo } from '@/lib/format';

interface BookingRow {
  id: string;
  externalRef: string;
  status: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  amount: string;
  currency: string;
  unmapped: boolean;
  receivedAt: string;
  sourceChannel: { name: string; code: string };
  roomType?: { name: string } | null;
  property: { name: string };
}

export function BookingsPage() {
  const { selectedId } = useProperty();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bookings', selectedId, status, search],
    queryFn: () =>
      api<{ total: number; bookings: BookingRow[] }>(
        `/bookings?${new URLSearchParams({
          ...(selectedId ? { propertyId: selectedId } : {}),
          ...(status ? { status } : {}),
          ...(search ? { search } : {}),
          pageSize: '50',
        })}`,
      ),
    refetchInterval: 15_000,
  });

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle={data ? `${data.total} reservations` : 'Reservations ingested from every channel'}
        actions={
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Search guest / ref…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="modified">Modified</option>
              <option value="cancelled">Cancelled</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        }
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}
      {data && (
        <Table
          head={
            <>
              <th className="th">Guest</th>
              <th className="th">Channel</th>
              <th className="th">Room</th>
              <th className="th">Stay</th>
              <th className="th">Amount</th>
              <th className="th">Received</th>
              <th className="th">Status</th>
            </>
          }
        >
          {data.bookings.map((b) => (
            <tr
              key={b.id}
              className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
              onClick={() => setOpenId(b.id)}
            >
              <td className="td font-medium">{b.guestName}</td>
              <td className="td">{b.sourceChannel.name}</td>
              <td className="td">
                {b.roomType?.name ?? <span className="text-amber-500">unmapped</span>}
              </td>
              <td className="td text-slate-500">
                {date(b.checkIn)} → {date(b.checkOut)}
              </td>
              <td className="td">{money(Number(b.amount), b.currency)}</td>
              <td className="td text-slate-500">{timeAgo(b.receivedAt)}</td>
              <td className="td">
                <Badge status={b.status} />
              </td>
            </tr>
          ))}
          {data.bookings.length === 0 && (
            <tr>
              <td className="td text-slate-500" colSpan={7}>
                No bookings match.
              </td>
            </tr>
          )}
        </Table>
      )}

      {openId && <BookingDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

interface Payment {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  method: string;
  commissionCents: number;
  netCents: number;
  refundedCents: number;
  transferredToConnectAt: string | null;
  createdAt: string;
}

function BookingDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['booking', id],
    queryFn: () =>
      api<{ booking: Record<string, unknown>; conflicts: { id: string; type: string; details: { message?: string } }[] }>(
        `/bookings/${id}`,
      ),
  });
  const payments = useQuery({
    queryKey: ['booking-payments', id],
    queryFn: () => api<{ payments: Payment[]; gateway: { name: string; configured: boolean }; connectStatus: string }>(`/payments?bookingId=${id}`),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/bookings/${id}/status`, { method: 'PATCH', json: { status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking', id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
  const repush = useMutation({
    mutationFn: () => api(`/bookings/${id}/repush`, { method: 'POST' }),
  });
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeMethod, setChargeMethod] = useState<'card' | 'cash' | 'bank_transfer' | 'other'>('card');
  const charge = useMutation({
    mutationFn: () =>
      api<{ payment: Payment; gatewayMessage?: string }>('/payments', {
        method: 'POST',
        json: { bookingId: id, amountCents: Math.round(Number(chargeAmount) * 100), method: chargeMethod },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking-payments', id] });
      setChargeAmount('');
    },
  });
  const refund = useMutation({
    mutationFn: ({ paymentId, amountCents }: { paymentId: string; amountCents: number }) =>
      api(`/payments/${paymentId}/refund`, { method: 'POST', json: { amountCents } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking-payments', id] }),
  });

  const b = data?.booking as
    | (Record<string, unknown> & {
        guestName: string;
        guestPhone: string;
        adults: number;
        children: number;
        status: string;
        externalRef: string;
        checkIn: string;
        checkOut: string;
        amount: string;
        currency: string;
        sourceChannel: { name: string };
        roomType?: { name: string } | null;
        rawPayload: unknown;
        nights: { date: string; units: number }[];
      })
    | undefined;

  return (
    <Drawer open onClose={onClose} title="Booking detail">
      {isLoading || !b ? (
        <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold">{b.guestName}</p>
              <p className="text-slate-500">
                {b.sourceChannel.name} · {b.externalRef}
              </p>
            </div>
            <Badge status={b.status} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in" value={date(b.checkIn)} />
            <Field label="Check-out" value={date(b.checkOut)} />
            <Field label="Room" value={b.roomType?.name ?? 'unmapped'} />
            <Field label="Amount" value={money(Number(b.amount), b.currency)} />
            <Field label="Nights" value={String(b.nights.length)} />
            <Field
              label="Guests"
              value={`${b.adults} adult${b.adults === 1 ? '' : 's'}${b.children > 0 ? `, ${b.children} child${b.children === 1 ? '' : 'ren'}` : ''}`}
            />
            <Field label="Phone" value={b.guestPhone || '—'} />
          </div>

          {data?.conflicts && data.conflicts.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
              <p className="mb-1 font-medium text-rose-700 dark:text-rose-300">Linked conflicts</p>
              {data.conflicts.map((c) => (
                <p key={c.id} className="text-xs text-rose-600 dark:text-rose-300">
                  {c.type}: {c.details?.message}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {['confirmed', 'cancelled', 'rejected'].map((s) => (
              <button
                key={s}
                className="btn-ghost !py-1.5 capitalize"
                disabled={setStatus.isPending || b.status === s}
                onClick={() => setStatus.mutate(s)}
              >
                Mark {s}
              </button>
            ))}
            <button className="btn-ghost !py-1.5" onClick={() => repush.mutate()} disabled={repush.isPending}>
              Re-push availability
            </button>
          </div>
          {repush.data ? (
            <p className="text-xs text-emerald-600">Queued {(repush.data as { jobsQueued: number }).jobsQueued} push job(s).</p>
          ) : null}

          <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <p className="font-medium">Payments</p>
              {payments.data && (
                <span className="text-xs text-slate-500">
                  {payments.data.connectStatus === 'active'
                    ? 'Auto-transferring to your Stripe account'
                    : 'Not connected to Stripe yet — funds stay on the platform until you connect'}
                </span>
              )}
            </div>

            {payments.isLoading && <Spinner />}
            {payments.data && payments.data.payments.length === 0 && (
              <p className="text-xs text-slate-500">No payments recorded for this booking.</p>
            )}
            {payments.data && payments.data.payments.length > 0 && (
              <div className="space-y-2">
                {payments.data.payments.map((p) => (
                  <div key={p.id} className="rounded-md bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{money(p.amountCents / 100, p.currency)}</span>
                      <Badge status={p.status} />
                    </div>
                    <p className="mt-1 text-slate-500">
                      {p.method} · commission {money(p.commissionCents / 100, p.currency)} · net {money(p.netCents / 100, p.currency)}
                      {p.refundedCents > 0 && ` · refunded ${money(p.refundedCents / 100, p.currency)}`}
                    </p>
                    {(p.status === 'captured' || p.status === 'partially_refunded') && (
                      <button
                        className="btn-ghost mt-1 !py-1 !text-xs"
                        disabled={refund.isPending}
                        onClick={() => refund.mutate({ paymentId: p.id, amountCents: p.amountCents - p.refundedCents })}
                      >
                        Refund remaining
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <form
              className="flex flex-wrap items-end gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (chargeAmount) charge.mutate();
              }}
            >
              <div>
                <label className="text-xs uppercase tracking-wide text-slate-400">Charge guest</label>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Amount"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                />
              </div>
              <select className="input" value={chargeMethod} onChange={(e) => setChargeMethod(e.target.value as typeof chargeMethod)}>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </select>
              <button className="btn-primary !py-1.5" type="submit" disabled={charge.isPending || !chargeAmount}>
                Charge
              </button>
            </form>
            {charge.data?.gatewayMessage && <p className="text-xs text-amber-600">{charge.data.gatewayMessage}</p>}
            {charge.isError && <ErrorNote error={charge.error} />}
          </div>

          <details className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <summary className="cursor-pointer text-xs font-medium">Raw payload</summary>
            <pre className="mt-2 max-h-72 overflow-auto text-[11px] text-slate-500">
              {JSON.stringify(b.rawPayload, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

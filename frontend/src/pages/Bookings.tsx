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

function BookingDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['booking', id],
    queryFn: () =>
      api<{ booking: Record<string, unknown>; conflicts: { id: string; type: string; details: { message?: string } }[] }>(
        `/bookings/${id}`,
      ),
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

  const b = data?.booking as
    | (Record<string, unknown> & {
        guestName: string;
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

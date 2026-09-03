import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Drawer, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';

interface Cell {
  date: string;
  price: number;
  availableUnits: number;
  minStay: number;
  maxStay: number;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
}
interface Grid {
  from: string;
  days: number;
  dates: string[];
  rooms: {
    roomTypeId: string;
    name: string;
    code: string;
    totalUnits: number;
    basePrice: number;
    pendingSync: string[];
    cells: Cell[];
  }[];
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function CalendarPage() {
  const { selectedId, selected } = useProperty();
  const qc = useQueryClient();
  const [from, setFrom] = useState(todayIso());
  const [days, setDays] = useState(21);
  const [edit, setEdit] = useState<{ roomTypeId: string; name: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['calendar', selectedId, from, days],
    queryFn: () => api<Grid>(`/calendar?propertyId=${selectedId}&from=${from}&days=${days}`),
    enabled: !!selectedId,
    refetchInterval: 20_000,
  });

  const bulk = useMutation({
    mutationFn: (json: Record<string, unknown>) => api('/calendar', { method: 'PATCH', json }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      setEdit(null);
    },
  });

  if (!selectedId) return <EmptyState title="Select a property" />;
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'error'} />;

  return (
    <div>
      <PageHeader
        title="Calendar / ARI"
        subtitle={`${selected?.name} · availability, rates & restrictions pushed to every mapped channel`}
        actions={
          <div className="flex items-center gap-2">
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={14}>14 days</option>
              <option value={21}>21 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
            </select>
          </div>
        }
      />

      <div className="card overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500 dark:bg-slate-900">
                Room type
              </th>
              {data.dates.map((d) => {
                const dt = new Date(d + 'T00:00:00Z');
                const weekend = [0, 6].includes(dt.getUTCDay());
                return (
                  <th
                    key={d}
                    className={`px-2 py-2 text-center text-[11px] font-medium ${
                      weekend ? 'text-brand-500' : 'text-slate-500'
                    }`}
                  >
                    {dt.toLocaleDateString('en-US', { weekday: 'short' })}
                    <br />
                    {dt.getUTCDate()}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.rooms.map((room) => (
                <tr key={room.roomTypeId}>
                  <td className="sticky left-0 z-10 border-t border-slate-100 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                    <button
                      className="text-left font-medium hover:text-brand-500"
                      onClick={() => setEdit({ roomTypeId: room.roomTypeId, name: room.name })}
                    >
                      {room.name}
                    </button>
                    <div className="text-[11px] text-slate-400">
                      cap {room.totalUnits}
                      {room.pendingSync.length > 0 && (
                        <span className="ml-1 text-amber-500">· syncing {room.pendingSync.join(',')}</span>
                      )}
                    </div>
                  </td>
                  {room.cells.map((cell) => (
                    <td
                      key={cell.date}
                      className={`border-t border-slate-100 px-1 py-1.5 text-center dark:border-slate-800 ${
                        cell.stopSell || cell.availableUnits === 0
                          ? 'bg-rose-50 dark:bg-rose-500/10'
                          : cell.availableUnits <= 1
                            ? 'bg-amber-50 dark:bg-amber-500/10'
                            : ''
                      }`}
                    >
                      <div className="font-semibold">{cell.availableUnits}</div>
                      <div className="text-[10px] text-slate-400">${cell.price}</div>
                      {(cell.closedToArrival || cell.minStay > 1) && (
                        <div className="text-[9px] text-slate-400">
                          {cell.minStay > 1 && `${cell.minStay}n`}
                          {cell.closedToArrival && ' CTA'}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Green = open · amber = 1 left · red = closed / stop-sell. Click a room name to bulk-edit a date range.
      </p>

      <BulkEditDrawer
        edit={edit}
        onClose={() => setEdit(null)}
        from={from}
        days={days}
        submitting={bulk.isPending}
        onSubmit={(payload) => bulk.mutate(payload)}
      />
    </div>
  );
}

function BulkEditDrawer({
  edit,
  onClose,
  from,
  days,
  onSubmit,
  submitting,
}: {
  edit: { roomTypeId: string; name: string } | null;
  onClose: () => void;
  from: string;
  days: number;
  onSubmit: (p: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  const [rangeFrom, setRangeFrom] = useState(from);
  const [rangeTo, setRangeTo] = useState(() => {
    const d = new Date(from + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  });
  const [price, setPrice] = useState('');
  const [avail, setAvail] = useState('');
  const [minStay, setMinStay] = useState('');
  const [stopSell, setStopSell] = useState<'' | 'true' | 'false'>('');
  const [cta, setCta] = useState<'' | 'true' | 'false'>('');

  if (!edit) return null;

  const submit = () => {
    const payload: Record<string, unknown> = {
      roomTypeId: edit.roomTypeId,
      from: rangeFrom,
      to: rangeTo,
    };
    if (price) payload.price = Number(price);
    if (avail) payload.availableUnits = Number(avail);
    if (minStay) payload.minStay = Number(minStay);
    if (stopSell) payload.stopSell = stopSell === 'true';
    if (cta) payload.closedToArrival = cta === 'true';
    onSubmit(payload);
  };

  return (
    <Drawer open onClose={onClose} title={`Bulk edit · ${edit.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-slate-500">Leave a field blank to keep its current value across the range.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Price</label>
            <input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="label">Availability</label>
            <input className="input" type="number" value={avail} onChange={(e) => setAvail(e.target.value)} />
          </div>
          <div>
            <label className="label">Min stay</label>
            <input className="input" type="number" value={minStay} onChange={(e) => setMinStay(e.target.value)} />
          </div>
          <div>
            <label className="label">Stop sell</label>
            <select className="input" value={stopSell} onChange={(e) => setStopSell(e.target.value as never)}>
              <option value="">no change</option>
              <option value="true">close</option>
              <option value="false">open</option>
            </select>
          </div>
          <div>
            <label className="label">Closed to arrival</label>
            <select className="input" value={cta} onChange={(e) => setCta(e.target.value as never)}>
              <option value="">no change</option>
              <option value="true">yes</option>
              <option value="false">no</option>
            </select>
          </div>
        </div>
        <button className="btn-primary w-full" onClick={submit} disabled={submitting}>
          {submitting ? 'Applying & queuing pushes…' : 'Apply & push to channels'}
        </button>
      </div>
    </Drawer>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Badge, EmptyState, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { date } from '@/lib/format';

interface BoardBooking {
  id: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  roomType: { name: string } | null;
  roomUnit: { unitNumber: string } | null;
  sourceChannel: { name: string };
}
interface RoomUnit {
  id: string;
  unitNumber: string;
  housekeepingStatus: 'clean' | 'dirty' | 'inspected' | 'out_of_order';
  roomType: { name: string };
}

const TABS = ['Front desk', 'Housekeeping'] as const;

export function PmsPage() {
  const { selectedId } = useProperty();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Front desk');

  if (!selectedId) return <EmptyState title="Select a property" />;

  return (
    <div>
      <PageHeader
        title="Property Management (PMS)"
        subtitle="Front desk board and housekeeping status"
        actions={
          <Link to="/channels?tab=pms" className="btn-ghost !py-1.5">
            Already run WebRezPro, AutoClerk or another PMS? Connect it →
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={t === tab ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Front desk' ? <FrontDesk propertyId={selectedId} /> : <Housekeeping propertyId={selectedId} />}
    </div>
  );
}

function FrontDesk({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const [date_, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, error } = useQuery({
    queryKey: ['pms-board', propertyId, date_],
    queryFn: () => api<{ arrivals: BoardBooking[]; departures: BoardBooking[]; inHouse: BoardBooking[] }>(`/pms/board?propertyId=${propertyId}&date=${date_}`),
  });
  const units = useQuery({
    queryKey: ['pms-units', propertyId],
    queryFn: () => api<{ units: RoomUnit[] }>(`/pms/room-units?propertyId=${propertyId}`),
  });

  const checkIn = useMutation({
    mutationFn: ({ id, roomUnitId }: { id: string; roomUnitId?: string }) =>
      api(`/pms/bookings/${id}/check-in`, { method: 'POST', json: { roomUnitId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pms-board'] }),
  });
  const checkOut = useMutation({
    mutationFn: (id: string) => api(`/pms/bookings/${id}/check-out`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pms-board'] }),
  });

  return (
    <div>
      <div className="mb-3">
        <input type="date" className="input w-auto" value={date_} onChange={(e) => setDate(e.target.value)} />
      </div>
      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}
      {checkIn.error && <ErrorNote error={checkIn.error} />}
      {data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Board title={`Arrivals (${data.arrivals.length})`}>
            {data.arrivals.map((b) => (
              <div key={b.id} className="card flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium">{b.guestName}</p>
                  <p className="text-xs text-slate-400">{b.roomType?.name} · {b.sourceChannel.name}</p>
                </div>
                {b.checkedInAt ? (
                  <Badge status="confirmed">checked in{b.roomUnit ? ` · ${b.roomUnit.unitNumber}` : ''}</Badge>
                ) : (
                  <select
                    className="input w-auto !py-1 text-xs"
                    defaultValue=""
                    onChange={(e) => checkIn.mutate({ id: b.id, roomUnitId: e.target.value || undefined })}
                  >
                    <option value="" disabled>
                      Check in…
                    </option>
                    {(units.data?.units ?? [])
                      .filter((u) => u.roomType.name === b.roomType?.name && u.housekeepingStatus !== 'out_of_order')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          Unit {u.unitNumber} ({u.housekeepingStatus})
                        </option>
                      ))}
                  </select>
                )}
              </div>
            ))}
            {data.arrivals.length === 0 && <p className="text-sm text-slate-500">No arrivals.</p>}
          </Board>

          <Board title={`In-house (${data.inHouse.length})`}>
            {data.inHouse.map((b) => (
              <div key={b.id} className="card flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium">{b.guestName}</p>
                  <p className="text-xs text-slate-400">
                    {b.roomType?.name} {b.roomUnit ? `· Unit ${b.roomUnit.unitNumber}` : ''} · out {date(b.checkOut)}
                  </p>
                </div>
              </div>
            ))}
            {data.inHouse.length === 0 && <p className="text-sm text-slate-500">Nobody in-house.</p>}
          </Board>

          <Board title={`Departures (${data.departures.length})`}>
            {data.departures.map((b) => (
              <div key={b.id} className="card flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium">{b.guestName}</p>
                  <p className="text-xs text-slate-400">{b.roomType?.name}{b.roomUnit ? ` · Unit ${b.roomUnit.unitNumber}` : ''}</p>
                </div>
                {b.checkedOutAt ? (
                  <Badge status="cancelled">checked out</Badge>
                ) : b.checkedInAt ? (
                  <button className="btn-ghost !py-1 text-xs" onClick={() => checkOut.mutate(b.id)}>
                    Check out
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">never checked in</span>
                )}
              </div>
            ))}
            {data.departures.length === 0 && <p className="text-sm text-slate-500">No departures.</p>}
          </Board>
        </div>
      )}
    </div>
  );
}

function Board({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Housekeeping({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['pms-housekeeping', propertyId],
    queryFn: () => api<{ units: RoomUnit[] }>(`/pms/housekeeping?propertyId=${propertyId}`),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, housekeepingStatus }: { id: string; housekeepingStatus: string }) =>
      api(`/pms/room-units/${id}`, { method: 'PATCH', json: { housekeepingStatus } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pms-housekeeping'] }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  return (
    <Table
      head={
        <>
          <th className="th">Room type</th>
          <th className="th">Unit</th>
          <th className="th">Status</th>
        </>
      }
    >
      {data?.units.map((u) => (
        <tr key={u.id}>
          <td className="td font-medium">{u.roomType.name}</td>
          <td className="td">{u.unitNumber}</td>
          <td className="td">
            <select
              className="input w-auto"
              value={u.housekeepingStatus}
              onChange={(e) => setStatus.mutate({ id: u.id, housekeepingStatus: e.target.value })}
            >
              {['clean', 'dirty', 'inspected', 'out_of_order'].map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </td>
        </tr>
      ))}
      {data?.units.length === 0 && (
        <tr>
          <td className="td text-slate-500" colSpan={3}>
            No room units set up yet.
          </td>
        </tr>
      )}
    </Table>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Drawer, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { money } from '@/lib/format';

interface PropFull {
  property: {
    id: string;
    name: string;
    code: string;
    city: string;
    region: string;
    country: string;
    currency: string;
    timezone: string;
    roomTypes: {
      id: string;
      name: string;
      code: string;
      totalUnits: number;
      basePrice: string;
      maxOccupancy: number;
      ratePlans: { id: string; name: string; code: string; mealPlan: string }[];
      _count: { bookings: number };
    }[];
  };
}

export function PropertiesPage() {
  const { properties, selectedId, setSelectedId } = useProperty();
  const qc = useQueryClient();
  const [addRoom, setAddRoom] = useState(false);
  const [addProp, setAddProp] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['property', selectedId],
    queryFn: () => api<PropFull>(`/properties/${selectedId}`),
    enabled: !!selectedId,
  });

  const createRoom = useMutation({
    mutationFn: (json: Record<string, unknown>) => api('/properties/room-types', { method: 'POST', json }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', selectedId] });
      setAddRoom(false);
    },
  });
  const delRoom = useMutation({
    mutationFn: (id: string) => api(`/properties/room-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['property', selectedId] }),
  });
  const createProp = useMutation({
    mutationFn: (json: Record<string, unknown>) => api('/properties', { method: 'POST', json }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      setAddProp(false);
    },
  });

  return (
    <div>
      <PageHeader
        title="Properties & rooms"
        subtitle="Inventory structure — properties, room types and rate plans"
        actions={
          <button className="btn-primary" onClick={() => setAddProp(true)}>
            + Property
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {properties.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={p.id === selectedId ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}
          >
            {p.name}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}
      {data && (
        <>
          <div className="card mb-4 p-4 text-sm">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Info label="Code" value={data.property.code} />
              <Info label="Location" value={`${data.property.city || '—'}, ${data.property.region}`} />
              <Info label="Country" value={data.property.country} />
              <Info label="Currency" value={data.property.currency} />
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Room types ({data.property.roomTypes.length})</h3>
            <button className="btn-ghost !py-1.5" onClick={() => setAddRoom(true)}>
              + Room type
            </button>
          </div>

          <Table
            head={
              <>
                <th className="th">Name</th>
                <th className="th">Code</th>
                <th className="th">Units</th>
                <th className="th">Base price</th>
                <th className="th">Rate plans</th>
                <th className="th">Bookings</th>
                <th className="th" />
              </>
            }
          >
            {data.property.roomTypes.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium">{r.name}</td>
                <td className="td text-slate-500">{r.code}</td>
                <td className="td">{r.totalUnits}</td>
                <td className="td">{money(Number(r.basePrice), data.property.currency)}</td>
                <td className="td text-slate-500">{r.ratePlans.map((p) => p.code).join(', ')}</td>
                <td className="td text-slate-500">{r._count.bookings}</td>
                <td className="td text-right">
                  <button className="text-rose-500 hover:underline" onClick={() => delRoom.mutate(r.id)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {addRoom && selectedId && (
        <Drawer open onClose={() => setAddRoom(false)} title="New room type">
          <RoomForm
            onSubmit={(v) => createRoom.mutate({ ...v, propertyId: selectedId })}
            busy={createRoom.isPending}
          />
        </Drawer>
      )}
      {addProp && (
        <Drawer open onClose={() => setAddProp(false)} title="New property">
          <PropertyForm onSubmit={(v) => createProp.mutate(v)} busy={createProp.isPending} />
        </Drawer>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function RoomForm({ onSubmit, busy }: { onSubmit: (v: Record<string, unknown>) => void; busy: boolean }) {
  const [f, setF] = useState({ code: '', name: '', totalUnits: 1, maxOccupancy: 2, basePrice: 100 });
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div>
        <label className="label">Code</label>
        <input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Units</label>
          <input
            type="number"
            className="input"
            value={f.totalUnits}
            onChange={(e) => setF({ ...f, totalUnits: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">Max occ.</label>
          <input
            type="number"
            className="input"
            value={f.maxOccupancy}
            onChange={(e) => setF({ ...f, maxOccupancy: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">Base price</label>
          <input
            type="number"
            className="input"
            value={f.basePrice}
            onChange={(e) => setF({ ...f, basePrice: Number(e.target.value) })}
          />
        </div>
      </div>
      <button className="btn-primary w-full" disabled={busy || !f.code || !f.name} onClick={() => onSubmit(f)}>
        Create room type
      </button>
    </div>
  );
}

function PropertyForm({ onSubmit, busy }: { onSubmit: (v: Record<string, unknown>) => void; busy: boolean }) {
  const [f, setF] = useState({
    code: '',
    name: '',
    city: '',
    region: '',
    country: 'US',
    currency: 'USD',
    timezone: 'America/New_York',
  });
  return (
    <div className="space-y-3">
      {(['name', 'code', 'city', 'region'] as const).map((k) => (
        <div key={k}>
          <label className="label">{k}</label>
          <input
            className="input"
            value={f[k]}
            onChange={(e) => setF({ ...f, [k]: k === 'code' ? e.target.value.toUpperCase() : e.target.value })}
          />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Country</label>
          <select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
            <option value="US">US</option>
            <option value="CA">CA</option>
          </select>
        </div>
        <div>
          <label className="label">Currency</label>
          <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option>USD</option>
            <option>CAD</option>
          </select>
        </div>
      </div>
      <button className="btn-primary w-full" disabled={busy || !f.code || !f.name} onClick={() => onSubmit(f)}>
        Create property
      </button>
    </div>
  );
}

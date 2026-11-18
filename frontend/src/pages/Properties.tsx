import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { CopyButton, Drawer, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { money } from '@/lib/format';

interface RatePlan {
  id: string;
  name: string;
  code: string;
  mealPlan: string;
  cancellationPolicy: string;
  derivedFromId: string | null;
  adjustPct: number;
  adjustFlat: string;
}
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
      ratePlans: RatePlan[];
      _count: { bookings: number };
    }[];
    seo: { published: boolean } | null;
  };
}

export function PropertiesPage() {
  const { properties, selectedId, setSelectedId, locked } = useProperty();
  const qc = useQueryClient();
  const [addRoom, setAddRoom] = useState(false);
  const [addProp, setAddProp] = useState(false);
  const [ratePlansFor, setRatePlansFor] = useState<PropFull['property']['roomTypes'][number] | null>(null);

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
  const createRatePlan = useMutation({
    mutationFn: (json: Record<string, unknown>) => api('/properties/rate-plans', { method: 'POST', json }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['property', selectedId] }),
  });
  const updateRatePlan = useMutation({
    mutationFn: ({ id, ...json }: Record<string, unknown> & { id: string }) =>
      api(`/properties/rate-plans/${id}`, { method: 'PATCH', json }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['property', selectedId] }),
  });
  const deleteRatePlan = useMutation({
    mutationFn: (id: string) => api(`/properties/rate-plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['property', selectedId] }),
  });

  return (
    <div>
      <PageHeader
        title="Properties & rooms"
        subtitle="Inventory structure — properties, room types and rate plans"
        actions={
          !locked && (
            <button className="btn-primary" onClick={() => setAddProp(true)}>
              + Property
            </button>
          )
        }
      />

      {!locked && (
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
      )}

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

          <div className="card mb-4 p-4 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-medium">Public booking page</p>
              <span
                className={`badge ${
                  data.property.seo?.published
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {data.property.seo?.published ? 'live — no login needed' : 'not published'}
              </span>
            </div>
            {data.property.seo?.published ? (
              <div className="flex items-center gap-2">
                <input className="input flex-1" readOnly value={`${location.origin}/book/${data.property.code}`} onFocus={(e) => e.target.select()} />
                <CopyButton text={`${location.origin}/book/${data.property.code}`} />
                <a className="btn-ghost !py-1.5" href={`/book/${data.property.code}`} target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              </div>
            ) : (
              <p className="text-amber-500">This property's booking page isn't published yet — publish it from SEO below.</p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Anyone with this link can search dates and book — it never requires staff login. Design the page content,
              SEO, FAQs, and get the embed code for your own website from{' '}
              <Link to="/seo" className="underline">
                Website &amp; booking page
              </Link>
              .
            </p>
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
                <td className="td">
                  <button className="text-brand-600 hover:underline dark:text-brand-400" onClick={() => setRatePlansFor(r)}>
                    {r.ratePlans.length} rate plan{r.ratePlans.length === 1 ? '' : 's'}
                  </button>
                </td>
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
          {createRoom.error && <div className="mb-3"><ErrorNote error={createRoom.error} /></div>}
          <RoomForm
            onSubmit={(v) => createRoom.mutate({ ...v, propertyId: selectedId })}
            busy={createRoom.isPending}
          />
        </Drawer>
      )}
      {addProp && (
        <Drawer open onClose={() => setAddProp(false)} title="New property">
          {createProp.error && <div className="mb-3"><ErrorNote error={createProp.error} /></div>}
          <PropertyForm onSubmit={(v) => createProp.mutate(v)} busy={createProp.isPending} />
        </Drawer>
      )}
      {ratePlansFor && (
        <Drawer open onClose={() => setRatePlansFor(null)} title={`Rate plans — ${ratePlansFor.name}`} width="max-w-2xl">
          <RatePlansPanel
            room={ratePlansFor}
            currency={data?.property.currency ?? 'USD'}
            onCreate={(v) => createRatePlan.mutate({ ...v, roomTypeId: ratePlansFor.id })}
            onUpdate={(id, v) => updateRatePlan.mutate({ id, ...v })}
            onDelete={(id) => deleteRatePlan.mutate(id)}
            creating={createRatePlan.isPending}
          />
        </Drawer>
      )}
    </div>
  );
}

/** price = base × (1 + adjustPct/100) + adjustFlat — mirrors the backend's push-time
 *  calculation (shared/src/pricing.ts) so this preview matches what each OTA actually
 *  receives. Frontend code doesn't depend on the shared package, so it's reimplemented
 *  here rather than imported. */
function previewPrice(basePrice: number, adjustPct: number, adjustFlat: number): number {
  return Math.max(0, Math.round((basePrice * (1 + adjustPct / 100) + adjustFlat) * 100) / 100);
}

function RatePlansPanel({
  room,
  currency,
  onCreate,
  onUpdate,
  onDelete,
  creating,
}: {
  room: PropFull['property']['roomTypes'][number];
  currency: string;
  onCreate: (v: Record<string, unknown>) => void;
  onUpdate: (id: string, v: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  creating: boolean;
}) {
  const basePrice = Number(room.basePrice);
  const [f, setF] = useState({ code: '', name: '', mealPlan: 'room_only', adjustPct: 0, adjustFlat: 0, derivedFromId: '' });

  const priceOf = (plan: RatePlan): number => {
    if (!plan.derivedFromId) return previewPrice(basePrice, plan.adjustPct, Number(plan.adjustFlat));
    const parent = room.ratePlans.find((p) => p.id === plan.derivedFromId);
    const parentPrice = parent ? priceOf(parent) : basePrice;
    return previewPrice(parentPrice, plan.adjustPct, Number(plan.adjustFlat));
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-500">
        Base rate for this room is <b>{money(basePrice, currency)}</b> (set from the Calendar page — it syncs to every
        connected OTA automatically). Each rate plan below is a priced variant of that same base rate — map a channel
        connection's room to one of these (in Channels → Configure) to push a different price to that OTA, e.g. a
        non-refundable rate at a discount, without ever opening that OTA's own extranet.
      </p>

      <Table
        head={
          <>
            <th className="th">Name</th>
            <th className="th">Code</th>
            <th className="th">Adjust %</th>
            <th className="th">Adjust $</th>
            <th className="th">Preview price</th>
            <th className="th" />
          </>
        }
      >
        {room.ratePlans.map((p) => (
          <tr key={p.id}>
            <td className="td font-medium">{p.name}</td>
            <td className="td text-slate-500">{p.code}</td>
            <td className="td">
              <input
                type="number"
                className="input w-20"
                defaultValue={p.adjustPct}
                onBlur={(e) => onUpdate(p.id, { adjustPct: Number(e.target.value) })}
              />
            </td>
            <td className="td">
              <input
                type="number"
                className="input w-20"
                defaultValue={Number(p.adjustFlat)}
                onBlur={(e) => onUpdate(p.id, { adjustFlat: Number(e.target.value) })}
              />
            </td>
            <td className="td font-medium">{money(priceOf(p), currency)}</td>
            <td className="td text-right">
              <button className="text-rose-500 hover:underline" onClick={() => onDelete(p.id)}>
                delete
              </button>
            </td>
          </tr>
        ))}
        {room.ratePlans.length === 0 && (
          <tr>
            <td className="td text-slate-500" colSpan={6}>
              No rate plans yet — every channel currently receives the base rate above.
            </td>
          </tr>
        )}
      </Table>

      <div className="card space-y-3 p-4">
        <h4 className="text-sm font-semibold">Add a rate plan</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" placeholder="Non-refundable" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Code</label>
            <input className="input" placeholder="NONREF" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Meal plan</label>
            <select className="input" value={f.mealPlan} onChange={(e) => setF({ ...f, mealPlan: e.target.value })}>
              {['room_only', 'breakfast', 'half_board', 'all_inclusive'].map((m) => (
                <option key={m} value={m}>
                  {m.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Adjust %</label>
            <input type="number" className="input" value={f.adjustPct} onChange={(e) => setF({ ...f, adjustPct: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Adjust $</label>
            <input type="number" className="input" value={f.adjustFlat} onChange={(e) => setF({ ...f, adjustFlat: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className="label">Based on (optional)</label>
          <select className="input" value={f.derivedFromId} onChange={(e) => setF({ ...f, derivedFromId: e.target.value })}>
            <option value="">Room's base rate</option>
            {room.ratePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">
          Preview: {money(previewPrice(
            f.derivedFromId ? priceOf(room.ratePlans.find((p) => p.id === f.derivedFromId)!) : basePrice,
            f.adjustPct,
            f.adjustFlat,
          ), currency)}
        </p>
        <button
          className="btn-primary w-full"
          disabled={creating || !f.name || !f.code}
          onClick={() => {
            onCreate({ ...f, derivedFromId: f.derivedFromId || null });
            setF({ code: '', name: '', mealPlan: 'room_only', adjustPct: 0, adjustFlat: 0, derivedFromId: '' });
          }}
        >
          Add rate plan
        </button>
      </div>
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

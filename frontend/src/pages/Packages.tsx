import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Drawer, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { money } from '@/lib/format';

interface RoomTypeLite {
  id: string;
  name: string;
}
interface Package {
  id: string;
  name: string;
  description: string;
  priceAdjustType: 'flat' | 'pct';
  priceValue: string;
  includedAddons: string[];
  active: boolean;
  roomType: { name: string } | null;
}

export function PackagesPage() {
  const { selectedId } = useProperty();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['packages', selectedId],
    queryFn: () => api<{ packages: Package[] }>(`/packages?propertyId=${selectedId}`),
    enabled: !!selectedId,
  });
  const rooms = useQuery({
    queryKey: ['property-rooms', selectedId],
    queryFn: () => api<{ property: { roomTypes: RoomTypeLite[] } }>(`/properties/${selectedId}`),
    enabled: !!selectedId,
  });

  const create = useMutation({
    mutationFn: (v: Record<string, unknown>) => api('/packages', { method: 'POST', json: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packages'] });
      setAdding(false);
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api(`/packages/${id}`, { method: 'PATCH', json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/packages/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages'] }),
  });

  if (!selectedId) return <EmptyState title="Select a property" />;

  return (
    <div>
      <PageHeader
        title="Packages"
        subtitle="Guest-facing bundles — room + add-ons at a special rate"
        actions={
          <button className="btn-primary" onClick={() => setAdding(true)}>
            + Package
          </button>
        }
      />

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data?.packages.map((p) => (
          <div key={p.id} className="card p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{p.name}</p>
                <p className="text-xs text-slate-400">{p.roomType?.name ?? 'All room types'}</p>
              </div>
              <label className="flex items-center gap-1 text-xs">
                active
                <input type="checkbox" checked={p.active} onChange={(e) => toggle.mutate({ id: p.id, active: e.target.checked })} />
              </label>
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{p.description}</p>
            <p className="mt-2 font-medium">
              {p.priceAdjustType === 'flat' ? `+${money(Number(p.priceValue))}` : `+${p.priceValue}%`}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {p.includedAddons.map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
            <button className="mt-3 text-xs text-rose-500 hover:underline" onClick={() => remove.mutate(p.id)}>
              delete
            </button>
          </div>
        ))}
        {data && data.packages.length === 0 && <EmptyState title="No packages yet" hint="Create one to sell an upsell bundle." />}
      </div>

      {adding && (
        <Drawer open onClose={() => setAdding(false)} title="New package">
          <PackageForm
            propertyId={selectedId}
            rooms={rooms.data?.property.roomTypes ?? []}
            busy={create.isPending}
            onSubmit={(v) => create.mutate(v)}
          />
        </Drawer>
      )}
    </div>
  );
}

function PackageForm({
  propertyId,
  rooms,
  onSubmit,
  busy,
}: {
  propertyId: string;
  rooms: RoomTypeLite[];
  onSubmit: (v: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [f, setF] = useState({
    roomTypeId: '',
    name: '',
    description: '',
    priceAdjustType: 'flat' as 'flat' | 'pct',
    priceValue: '',
    addons: '',
  });
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div>
        <label className="label">Room type (optional — blank applies to all)</label>
        <select className="input" value={f.roomTypeId} onChange={(e) => setF({ ...f, roomTypeId: e.target.value })}>
          <option value="">All room types</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Price adjustment</label>
          <select className="input" value={f.priceAdjustType} onChange={(e) => setF({ ...f, priceAdjustType: e.target.value as 'flat' | 'pct' })}>
            <option value="flat">Flat amount</option>
            <option value="pct">Percent</option>
          </select>
        </div>
        <div>
          <label className="label">Value</label>
          <input className="input" type="number" value={f.priceValue} onChange={(e) => setF({ ...f, priceValue: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="label">Included add-ons (one per line)</label>
        <textarea className="input" rows={3} value={f.addons} onChange={(e) => setF({ ...f, addons: e.target.value })} />
      </div>
      <button
        className="btn-primary w-full"
        disabled={busy || !f.name || !f.priceValue}
        onClick={() =>
          onSubmit({
            propertyId,
            roomTypeId: f.roomTypeId || null,
            name: f.name,
            description: f.description,
            priceAdjustType: f.priceAdjustType,
            priceValue: Number(f.priceValue),
            includedAddons: f.addons.split('\n').map((s) => s.trim()).filter(Boolean),
          })
        }
      >
        Create package
      </button>
    </div>
  );
}

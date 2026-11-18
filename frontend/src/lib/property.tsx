import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/lib/auth';

export interface PropertyRow {
  id: string;
  code: string;
  name: string;
  country: string;
  currency: string;
  _count?: { roomTypes: number; channelConnections: number; bookings: number };
}

interface PropertyCtx {
  properties: PropertyRow[];
  selected: PropertyRow | null;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  loading: boolean;
  /** True for a dedicated property manager/owner hard-restricted to one property —
   *  the switcher should be hidden (there's only ever one choice, and the backend
   *  rejects any other id anyway). */
  locked: boolean;
}

const Ctx = createContext<PropertyCtx>(null as never);
const KEY = 'cm.property';

export function PropertyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const locked = Boolean(user?.assignedPropertyId);
  const { data, isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api<{ properties: PropertyRow[] }>('/properties'),
    enabled: Boolean(user),
  });
  const properties = data?.properties ?? [];

  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });

  const setSelectedId = (id: string | null) => {
    if (locked) return; // a scoped manager's selection is never user-driven
    setSelectedIdState(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (locked && user?.assignedPropertyId && selectedId !== user.assignedPropertyId) {
      setSelectedIdState(user.assignedPropertyId);
      return;
    }
    if (!locked && properties.length && !properties.some((p) => p.id === selectedId)) {
      setSelectedId(properties[0].id);
    }
  }, [properties, selectedId, locked, user?.assignedPropertyId]);

  const value = useMemo<PropertyCtx>(
    () => ({
      properties,
      selected: properties.find((p) => p.id === selectedId) ?? null,
      selectedId,
      setSelectedId,
      loading: isLoading,
      locked,
    }),
    [properties, selectedId, isLoading, locked],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProperty = () => useContext(Ctx);

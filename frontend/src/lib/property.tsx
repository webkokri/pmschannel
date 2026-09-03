import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

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
}

const Ctx = createContext<PropertyCtx>(null as never);
const KEY = 'cm.property';

export function PropertyProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api<{ properties: PropertyRow[] }>('/properties'),
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
    setSelectedIdState(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (properties.length && !properties.some((p) => p.id === selectedId)) {
      setSelectedId(properties[0].id);
    }
  }, [properties, selectedId]);

  const value = useMemo<PropertyCtx>(
    () => ({
      properties,
      selected: properties.find((p) => p.id === selectedId) ?? null,
      selectedId,
      setSelectedId,
      loading: isLoading,
    }),
    [properties, selectedId, isLoading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProperty = () => useContext(Ctx);

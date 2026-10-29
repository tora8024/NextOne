import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createContext } from 'react';
import type { CreateOrderInput, Database, RepairOrder, RepairStatus } from '../types';
import { api } from './api';

type StoreValue = {
  db: Database | null;
  error: string;
  revision: number;
  resetDemo: () => Promise<void>;
  createOrder: (input: CreateOrderInput) => Promise<RepairOrder>;
  updateStatus: (orderId: string, status: RepairStatus, author: string) => Promise<void>;
  addLog: (orderId: string, input: { author: string; content: string; visibleToCustomer: boolean }) => Promise<void>;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    const next = await api<Database>('/api/state');
    setDb(next);
    setError('');
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<Database>('/api/state')
      .then((next) => {
        if (cancelled) return;
        setDb(next);
        setError('');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '無法讀取維修資料');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const createOrder = useCallback(
    async (input: CreateOrderInput) => {
      const result = await api<{ order: RepairOrder }>('/api/orders', { method: 'POST', body: JSON.stringify(input) });
      await refresh();
      return result.order;
    },
    [refresh],
  );

  const updateStatus = useCallback(
    async (orderId: string, status: RepairStatus, author: string) => {
      await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, author }),
      });
      await refresh();
    },
    [refresh],
  );

  const addLog = useCallback(
    async (orderId: string, input: { author: string; content: string; visibleToCustomer: boolean }) => {
      await api(`/api/orders/${encodeURIComponent(orderId)}/logs`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await refresh();
    },
    [refresh],
  );

  const resetDemo = useCallback(async () => {
    const next = await api<Database>('/api/admin/reset', { method: 'POST' });
    setDb(next);
    setError('');
    setRevision((value) => value + 1);
  }, []);

  const value = useMemo(
    () => ({ db, error, revision, resetDemo, createOrder, updateStatus, addLog }),
    [db, error, revision, resetDemo, createOrder, updateStatus, addLog],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('維修資料尚未準備好');
  return value;
}

export function useDatabase(): Database {
  const { db } = useStore();
  if (!db) throw new Error('資料尚未載入');
  return db;
}

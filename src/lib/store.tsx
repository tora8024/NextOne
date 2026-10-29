import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createContext } from 'react';
import type { CreateOrderInput, Database, RepairOrder, RepairStatus, SessionUser } from '../types';
import { ApiError, api } from './api';

type Phase = 'loading' | 'anonymous' | 'ready';

type StoreValue = {
  db: Database | null;
  user: SessionUser | null;
  phase: Phase;
  error: string;
  revision: number;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetDemo: () => Promise<void>;
  createOrder: (input: CreateOrderInput) => Promise<RepairOrder>;
  updateStatus: (orderId: string, status: RepairStatus) => Promise<void>;
  addLog: (orderId: string, input: { content: string; visibleToCustomer: boolean }) => Promise<void>;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
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
    api<SessionUser>('/api/me')
      .then(async (session) => {
        if (cancelled) return;
        setUser(session);
        const next = await api<Database>('/api/state');
        if (cancelled) return;
        setDb(next);
        setError('');
        setPhase('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setUser(null);
        setDb(null);
        if (reason instanceof ApiError && reason.status === 401) {
          setError('');
          setPhase('anonymous');
          return;
        }
        setError(reason instanceof Error ? reason.message : '無法讀取維修資料');
        setPhase('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const session = await api<SessionUser>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setUser(session);
      try {
        await refresh();
      } catch (error) {
        setUser(null);
        setDb(null);
        setPhase('anonymous');
        throw error;
      }
      setPhase('ready');
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api('/api/logout', { method: 'POST' });
    setUser(null);
    setDb(null);
    setPhase('anonymous');
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
    async (orderId: string, status: RepairStatus) => {
      await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await refresh();
    },
    [refresh],
  );

  const addLog = useCallback(
    async (orderId: string, input: { content: string; visibleToCustomer: boolean }) => {
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
    () => ({ db, user, phase, error, revision, login, logout, resetDemo, createOrder, updateStatus, addLog }),
    [db, user, phase, error, revision, login, logout, resetDemo, createOrder, updateStatus, addLog],
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

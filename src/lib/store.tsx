import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createContext } from 'react';
import type { CreateOrderInput, Database, RepairOrder, RepairStatus } from '../types';
import { addLogRecord, createOrderRecord, loadDatabase, persist, STORAGE_KEY, updateStatusRecord } from './db';
import { createSeed } from '../data/seed';

type StoreValue = {
  db: Database;
  createOrder: (input: CreateOrderInput) => RepairOrder;
  updateStatus: (orderId: string, status: RepairStatus, author: string) => void;
  addLog: (orderId: string, input: { author: string; content: string; visibleToCustomer: boolean }) => void;
  resetDemo: () => void;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(() => loadDatabase());
  const dbRef = useRef(db);
  dbRef.current = db;

  const commit = useCallback((next: Database) => {
    dbRef.current = next;
    setDb(next);
    persist(next);
  }, []);

  const createOrder = useCallback(
    (input: CreateOrderInput) => {
      const result = createOrderRecord(dbRef.current, input);
      commit(result.db);
      return result.order;
    },
    [commit],
  );

  const updateStatus = useCallback(
    (orderId: string, status: RepairStatus, author: string) => {
      commit(updateStatusRecord(dbRef.current, orderId, status, author));
    },
    [commit],
  );

  const addLog = useCallback(
    (orderId: string, input: { author: string; content: string; visibleToCustomer: boolean }) => {
      commit(addLogRecord(dbRef.current, orderId, input));
    },
    [commit],
  );

  const resetDemo = useCallback(() => {
    commit(createSeed());
  }, [commit]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = loadDatabase();
      dbRef.current = next;
      setDb(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(
    () => ({ db, createOrder, updateStatus, addLog, resetDemo }),
    [db, createOrder, updateStatus, addLog, resetDemo],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('維修資料尚未準備好');
  return value;
}

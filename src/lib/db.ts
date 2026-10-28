import { createSeed } from '../data/seed';
import type { ActionLog, CreateOrderInput, Customer, Database, RepairOrder, RepairStatus } from '../types';
import { normalizeOrderNumber, normalizePhone } from './format';
import { STATUS_LABEL } from './labels';

export const STORAGE_KEY = 'nextone-repair-db-v1';

function isDatabase(value: unknown): value is Database {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<Database>;
  if (record.version !== 1 || !Array.isArray(record.customers) || !Array.isArray(record.devices) || !Array.isArray(record.orders)) {
    return false;
  }
  return record.orders.every((order) => {
    if (!order || typeof order !== 'object') return false;
    return Array.isArray((order as RepairOrder).logs);
  });
}

export function persist(db: Database) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Private mode or a full disk: keep the in-memory database for this session.
  }
}

function readStorage(): Database | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDatabase(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadDatabase(): Database {
  const existing = readStorage();
  if (existing) return existing;
  const seeded = createSeed();
  persist(seeded);
  return seeded;
}

export function sortOrders(orders: RepairOrder[]): RepairOrder[] {
  return [...orders].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export function nextOrderNumber(orders: RepairOrder[], now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: '2-digit',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '00';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const prefix = `NX-${year}${month}`;
  let max = 0;
  for (const order of orders) {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(order.orderNumber);
    if (!match?.[1]) continue;
    max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export function createOrderRecord(
  db: Database,
  input: CreateOrderInput,
  now = new Date(),
): { db: Database; order: RepairOrder } {
  const at = now.toISOString();
  const author = input.author.trim() || '櫃檯';
  let customers = db.customers;
  let customerId: string;

  if (input.customer.mode === 'existing') {
    const selectedId = input.customer.id;
    const existing = customers.find((customer) => customer.id === selectedId);
    if (!existing) throw new Error('找不到這位客戶');
    customerId = existing.id;
  } else {
    const name = input.customer.name.trim();
    const phone = input.customer.phone.trim();
    if (!name) throw new Error('請填寫客戶姓名');
    if (normalizePhone(phone).length < 8) throw new Error('請填寫有效的聯絡電話');
    const email = input.customer.email?.trim();
    if (email && !email.includes('@')) throw new Error('電子郵件格式不正確');
    const duplicate = customers.find(
      (customer) => customer.name.trim() === name && normalizePhone(customer.phone) === normalizePhone(phone),
    );
    if (duplicate) {
      customerId = duplicate.id;
    } else {
      customerId = crypto.randomUUID();
      customers = [
        ...customers,
        {
          id: customerId,
          name,
          phone,
          email: email || undefined,
          note: input.customer.note?.trim() || undefined,
          createdAt: at,
        },
      ];
    }
  }

  let devices = db.devices;
  let deviceId: string;
  if (input.device.mode === 'existing') {
    const selectedId = input.device.id;
    const device = devices.find((item) => item.id === selectedId);
    if (!device || device.customerId !== customerId) throw new Error('這台設備不屬於這位客戶');
    deviceId = device.id;
  } else {
    const brand = input.device.brand.trim();
    const model = input.device.model.trim();
    if (!brand || !model) throw new Error('請填寫設備品牌與型號');
    deviceId = crypto.randomUUID();
    devices = [
      ...devices,
      {
        id: deviceId,
        customerId,
        kind: input.device.kind,
        brand,
        model,
        serialNumber: input.device.serialNumber?.trim() || undefined,
        note: input.device.note?.trim() || undefined,
        createdAt: at,
      },
    ];
  }

  const repairTarget = input.repairTarget.trim();
  if (!repairTarget) throw new Error('請描述送修的硬體或軟體');

  const logs: ActionLog[] = [
    {
      id: crypto.randomUUID(),
      at,
      author,
      content: '維修單已建立，狀態為已受理。',
      visibleToCustomer: true,
      kind: 'status',
    },
  ];
  const initialLog = input.initialLog.trim();
  if (initialLog) {
    logs.push({
      id: crypto.randomUUID(),
      at,
      author,
      content: initialLog,
      visibleToCustomer: input.initialLogVisible,
      kind: 'note',
    });
  }

  const order: RepairOrder = {
    id: crypto.randomUUID(),
    orderNumber: nextOrderNumber(db.orders, now),
    customerId,
    deviceId,
    repairKind: input.repairKind,
    repairTarget,
    requirements: input.requirements.trim(),
    status: 'received',
    createdAt: at,
    updatedAt: at,
    logs,
  };

  return {
    db: { ...db, customers, devices, orders: [order, ...db.orders] },
    order,
  };
}

export function updateStatusRecord(
  db: Database,
  orderId: string,
  status: RepairStatus,
  author: string,
  now = new Date(),
): Database {
  const current = db.orders.find((order) => order.id === orderId);
  if (!current || current.status === status) return db;
  const at = now.toISOString();
  const name = author.trim() || '櫃檯';
  return {
    ...db,
    orders: db.orders.map((order) => {
      if (order.id !== orderId) return order;
      return {
        ...order,
        status,
        updatedAt: at,
        completedAt: status === 'completed' ? at : undefined,
        logs: [
          ...order.logs,
          {
            id: crypto.randomUUID(),
            at,
            author: name,
            content: `狀態更新為「${STATUS_LABEL[status]}」。`,
            visibleToCustomer: true,
            kind: 'status',
          },
        ],
      };
    }),
  };
}

export function addLogRecord(
  db: Database,
  orderId: string,
  input: { author: string; content: string; visibleToCustomer: boolean },
  now = new Date(),
): Database {
  const content = input.content.trim();
  if (!content || !db.orders.some((order) => order.id === orderId)) return db;
  const at = now.toISOString();
  const author = input.author.trim() || '櫃檯';
  return {
    ...db,
    orders: db.orders.map((order) => {
      if (order.id !== orderId) return order;
      return {
        ...order,
        updatedAt: at,
        logs: [
          ...order.logs,
          {
            id: crypto.randomUUID(),
            at,
            author,
            content,
            visibleToCustomer: input.visibleToCustomer,
            kind: 'note',
          },
        ],
      };
    }),
  };
}

export function findOrderByNumber(orders: RepairOrder[], query: string): RepairOrder | undefined {
  const needle = normalizeOrderNumber(query);
  if (needle.length < 4) return undefined;
  return orders.find((order) => normalizeOrderNumber(order.orderNumber) === needle);
}

export function findCustomerByContact(customers: Customer[], name: string, phone: string): Customer | undefined {
  const trimmed = name.trim();
  const digits = normalizePhone(phone);
  if (!trimmed || digits.length < 8) return undefined;
  return customers.find((customer) => customer.name.trim() === trimmed && normalizePhone(customer.phone) === digits);
}

export type Activity = {
  orderId: string;
  orderNumber: string;
  log: ActionLog;
};

export function recentActivity(orders: RepairOrder[], limit = 6): Activity[] {
  const items: Activity[] = [];
  for (const order of orders) {
    for (const entry of order.logs) {
      items.push({ orderId: order.id, orderNumber: order.orderNumber, log: entry });
    }
  }
  items.sort((a, b) => (a.log.at < b.log.at ? 1 : a.log.at > b.log.at ? -1 : 0));
  return items.slice(0, limit);
}

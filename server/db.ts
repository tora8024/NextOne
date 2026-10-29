import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import { createSeed } from '../src/data/seed.ts';
import { deviceLabel, maskPhone, maskSerial, phoneLast4 } from '../src/lib/format.ts';
import { STATUS_LABEL } from '../src/lib/labels.ts';
import {
  canonicalWorkOrderNumber,
  formatOrderNumber,
  isEmployeeNumber,
  isNtAccount,
  ntSam,
  parseFullOrderNumber,
  parseSerialToken,
  taipeiCalendar,
  toHalfWidth,
} from '../src/lib/orderNumber.ts';
import type {
  ActionLog,
  CreateOrderInput,
  Customer,
  Database,
  Device,
  DeviceKind,
  LogKind,
  MatchReason,
  PublicOrder,
  RepairKind,
  RepairOrder,
  RepairStatus,
  StatusChange,
  UserRole,
} from '../src/types.ts';
import { HttpError } from './errors.ts';
import { hashPassword } from './password.ts';

type Row = Record<string, SQLOutputValue>;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  note TEXT,
  employee_number TEXT NOT NULL UNIQUE CHECK (length(employee_number) = 6 AND employee_number GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'),
  nt_account TEXT NOT NULL,
  nt_sam TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_nt_sam ON customers(nt_sam);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(customer_id);

CREATE TABLE IF NOT EXISTS daily_serials (
  order_date TEXT PRIMARY KEY,
  last_serial INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  order_date TEXT NOT NULL,
  serial INTEGER NOT NULL,
  order_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  repair_kind TEXT NOT NULL,
  repair_target TEXT NOT NULL,
  requirements TEXT NOT NULL,
  status TEXT NOT NULL,
  created_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (order_date, serial)
);
CREATE INDEX IF NOT EXISTS idx_orders_serial_created ON work_orders(serial, created_on);
CREATE INDEX IF NOT EXISTS idx_orders_created_on ON work_orders(created_on);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON work_orders(customer_id, created_on);
CREATE INDEX IF NOT EXISTS idx_orders_device ON work_orders(device_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON work_orders(status);

CREATE TABLE IF NOT EXISTS action_logs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES work_orders(id),
  at TEXT NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  visible_to_customer INTEGER NOT NULL CHECK (visible_to_customer IN (0, 1)),
  kind TEXT NOT NULL CHECK (kind IN ('status', 'note'))
);
CREATE INDEX IF NOT EXISTS idx_logs_order_public ON action_logs(order_id, visible_to_customer);

CREATE TABLE IF NOT EXISTS status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES work_orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  at TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_order ON status_history(order_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

const databaseFiles = new WeakMap<DatabaseSync, string>();
const GENERIC_CUSTOMER_ERROR = '無法建立客戶，請確認資料後再試';

export type SearchFilters = {
  number?: string;
  nt?: string;
  from?: string;
  to?: string;
  status?: string;
  customerId?: string;
  deviceId?: string;
  q?: string;
};

export type PublicLookup = {
  number?: string;
  phoneLast4?: string;
};

export type SeededAdmin = {
  username: string;
  password: string;
};

export function restrictDatabasePermissions(filename: string) {
  const absolute = path.resolve(filename);
  if (fs.existsSync(absolute)) fs.chmodSync(absolute, 0o600);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${absolute}${suffix}`;
    if (fs.existsSync(sidecar)) fs.chmodSync(sidecar, 0o600);
  }
}

export function restrictOpenDatabase(db: DatabaseSync) {
  const filename = databaseFiles.get(db);
  if (filename) restrictDatabasePermissions(filename);
}

export function openDatabase(filename: string): DatabaseSync {
  const absolute = path.resolve(filename);
  const directory = path.dirname(absolute);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(absolute)) {
    const fd = fs.openSync(absolute, 'a', 0o600);
    fs.closeSync(fd);
  }
  fs.chmodSync(absolute, 0o600);
  const db = new DatabaseSync(absolute);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  databaseFiles.set(db, absolute);
  restrictDatabasePermissions(absolute);
  return db;
}

export function ensureSeeded(db: DatabaseSync): SeededAdmin | null {
  const row = one(db, 'SELECT COUNT(*) AS n FROM customers');
  if (!row || integer(row, 'n') === 0) return resetSeed(db);
  return ensureDefaultAdmin(db);
}

export function resetSeed(db: DatabaseSync): SeededAdmin | null {
  const seed = createSeed();
  const admin = transaction(db, () => {
    db.exec('DELETE FROM action_logs');
    db.exec('DELETE FROM status_history');
    db.exec('DELETE FROM work_orders');
    db.exec('DELETE FROM daily_serials');
    db.exec('DELETE FROM devices');
    db.exec('DELETE FROM customers');
    const insertCustomer = db.prepare(
      `INSERT INTO customers (id, name, phone, email, note, employee_number, nt_account, nt_sam, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const customer of seed.customers) {
      insertCustomer.run(
        customer.id,
        customer.name,
        customer.phone,
        customer.email ?? null,
        customer.note ?? null,
        customer.employeeNumber,
        customer.ntAccount,
        ntSam(customer.ntAccount),
        customer.createdAt,
      );
    }
    const insertDevice = db.prepare(
      `INSERT INTO devices (id, customer_id, kind, brand, model, serial_number, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const device of seed.devices) {
      insertDevice.run(
        device.id,
        device.customerId,
        device.kind,
        device.brand,
        device.model,
        device.serialNumber ?? null,
        device.note ?? null,
        device.createdAt,
      );
    }
    for (const order of seed.orders) {
      insertOrder(db, order);
      for (const entry of order.logs) insertLog(db, order.id, entry);
      for (const change of seedStatusHistory(order)) insertStatus(db, order.id, change);
    }
    db.exec(
      `INSERT INTO daily_serials (order_date, last_serial)
       SELECT order_date, MAX(serial) FROM work_orders GROUP BY order_date`,
    );
    return ensureDefaultAdmin(db);
  });
  restrictOpenDatabase(db);
  return admin;
}

export function createUser(db: DatabaseSync, input: { username: string; password: string; role: UserRole }) {
  const username = input.username.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) throw new HttpError(400, '帳號格式不正確');
  if (input.password.length < 8 || input.password.length > 200) throw new HttpError(400, '密碼長度不正確');
  if (input.role !== 'admin' && input.role !== 'staff') throw new HttpError(400, '角色不正確');
  try {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
      crypto.randomUUID(),
      username,
      hashPassword(input.password),
      input.role,
      new Date().toISOString(),
    );
  } catch (error) {
    if (isUnique(error)) throw new HttpError(400, '無法建立帳號，請確認資料後再試');
    throw error;
  }
}

function ensureDefaultAdmin(db: DatabaseSync): SeededAdmin | null {
  const existing = one(db, 'SELECT id FROM users WHERE username = ?', 'admin');
  if (existing) return null;
  const password = randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(),
    'admin',
    hashPassword(password),
    'admin',
    new Date().toISOString(),
  );
  console.log('預設管理員帳號：admin');
  console.log(`預設管理員密碼：${password}`);
  return { username: 'admin', password };
}

export function getState(db: DatabaseSync): Database {
  return {
    version: 1,
    customers: customers(db),
    devices: devices(db),
    orders: hydrateOrders(db, idRows(db, 'SELECT id FROM work_orders'), false),
  };
}

export function createOrder(db: DatabaseSync, input: CreateOrderInput, now = new Date()): RepairOrder {
  const at = now.toISOString();
  const author = input.author.trim() || '櫃檯';
  const calendar = taipeiCalendar(now);
  const order = transaction(db, () => {
    const customerId = resolveCustomer(db, input, at);
    const deviceId = resolveDevice(db, input, customerId, at);
    const repairTarget = input.repairTarget.trim();
    if (!repairTarget) throw new HttpError(400, '請描述送修的硬體或軟體');
    const serial = allocateSerial(db, calendar.compact);
    const orderId = crypto.randomUUID();
    const orderNumber = formatOrderNumber(calendar.compact, serial);
    const created: RepairOrder = {
      id: orderId,
      orderDate: calendar.compact,
      serial,
      orderNumber,
      customerId,
      deviceId,
      repairKind: input.repairKind,
      repairTarget,
      requirements: input.requirements.trim(),
      status: 'received',
      createdAt: at,
      updatedAt: at,
      logs: [],
      statusHistory: [],
    };
    insertOrder(db, created);
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
    const initial = input.initialLog.trim();
    if (initial) {
      logs.push({
        id: crypto.randomUUID(),
        at,
        author,
        content: initial,
        visibleToCustomer: input.initialLogVisible,
        kind: 'note',
      });
    }
    for (const entry of logs) insertLog(db, orderId, entry);
    insertStatus(db, orderId, {
      id: crypto.randomUUID(),
      at,
      author,
      fromStatus: null,
      toStatus: 'received',
    });
    return orderId;
  });
  const loaded = hydrateOrders(db, [{ id: order }], false)[0];
  if (!loaded) throw new HttpError(500, '建立後讀不到維修單');
  return loaded;
}

export function updateStatus(db: DatabaseSync, orderId: string, status: RepairStatus, author: string, now = new Date()): void {
  if (!isStatus(status)) throw new HttpError(400, '狀態不正確');
  const current = one(db, 'SELECT status FROM work_orders WHERE id = ?', orderId);
  if (!current) throw new HttpError(404, '找不到這張維修單');
  const previous = text(current, 'status') as RepairStatus;
  if (previous === status) return;
  const at = now.toISOString();
  const name = author.trim() || '櫃檯';
  transaction(db, () => {
    db.prepare(
      `UPDATE work_orders
       SET status = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`,
    ).run(status, at, status === 'completed' ? at : null, orderId);
    insertLog(db, orderId, {
      id: crypto.randomUUID(),
      at,
      author: name,
      content: `狀態更新為「${STATUS_LABEL[status]}」。`,
      visibleToCustomer: true,
      kind: 'status',
    });
    insertStatus(db, orderId, {
      id: crypto.randomUUID(),
      at,
      author: name,
      fromStatus: previous,
      toStatus: status,
    });
  });
}

export function addLog(
  db: DatabaseSync,
  orderId: string,
  input: { author: string; content: string; visibleToCustomer: boolean },
  now = new Date(),
): void {
  const content = input.content.trim();
  if (!content) throw new HttpError(400, '請寫下做了什麼事或下了什麼指令');
  const exists = one(db, 'SELECT id FROM work_orders WHERE id = ?', orderId);
  if (!exists) throw new HttpError(404, '找不到這張維修單');
  const at = now.toISOString();
  transaction(db, () => {
    insertLog(db, orderId, {
      id: crypto.randomUUID(),
      at,
      author: input.author.trim() || '櫃檯',
      content,
      visibleToCustomer: input.visibleToCustomer,
      kind: 'note',
    });
    db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(at, orderId);
  });
}

export function searchOrders(db: DatabaseSync, filters: SearchFilters): RepairOrder[] {
  const ids = matchingIds(db, filters);
  return hydrateOrders(db, ids.map((id) => ({ id: id.id, matches: id.matches })), false);
}

export function searchPublic(db: DatabaseSync, filters: PublicLookup): PublicOrder[] {
  const canonical = canonicalWorkOrderNumber(filters.number ?? '');
  if (!canonical) throw new HttpError(400, '請輸入完整單號，格式為 維修單-YYYYMMDD-NNN');
  const provided = toHalfWidth(filters.phoneLast4 ?? '').trim();
  if (!/^\d{4}$/.test(provided)) throw new HttpError(400, '請輸入電話末四碼');
  const row = one(
    db,
    `SELECT o.id, c.name, c.phone
     FROM work_orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE o.order_number = ?`,
    canonical,
  );
  const actual = row ? phoneLast4(text(row, 'phone')) : '';
  const samePhone = timingSafeEqual(Buffer.from(actual.padEnd(4, '\0')), Buffer.from(provided));
  if (!row || actual.length !== 4 || !samePhone) return [];
  const order = hydrateOrders(db, [{ id: text(row, 'id') }], true)[0];
  if (!order) return [];
  const device = one(db, 'SELECT id, kind, brand, model, serial_number FROM devices WHERE id = ?', order.deviceId);
  const summary = device
    ? deviceLabel({
        id: text(device, 'id'),
        customerId: order.customerId,
        kind: text(device, 'kind') as DeviceKind,
        brand: text(device, 'brand'),
        model: text(device, 'model'),
        createdAt: '',
      })
    : '—';
  return [
    {
      ...toPublic(order),
      customerName: text(row, 'name'),
      phoneMasked: maskPhone(text(row, 'phone')),
      deviceSummary: summary,
      serialLast4: device ? maskSerial(textOpt(device, 'serial_number')) : undefined,
    },
  ];
}

export function explainPlan(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => String((row as Row).detail ?? ''))
    .join('\n');
}

function matchingIds(db: DatabaseSync, filters: SearchFilters): { id: string; matches: MatchReason[] }[] {
  const from = cleanDate(filters.from);
  const to = cleanDate(filters.to);
  if (from && to && from > to) throw new HttpError(400, '日期範圍的開始日不能晚於結束日');
  const number = toHalfWidth(filters.number ?? '').trim();
  const nt = (filters.nt ?? '').trim();
  if (nt && !isNtAccount(nt)) throw new HttpError(400, 'NT 帳號格式不正確，例如 CORP\\chenghan 或 chenghan');

  const byNumber = number ? idsForNumber(db, number, from, to) : null;
  const byNt = nt ? idsForNt(db, nt, from, to) : null;
  let hits: Map<string, Set<MatchReason>>;
  if (byNumber && byNt) hits = intersect(byNumber, byNt);
  else if (byNumber) hits = byNumber;
  else if (byNt) hits = byNt;
  else hits = idsForDate(db, from, to);

  const narrowed = applyListFilters(db, [...hits.keys()], filters);
  return narrowed.map((id) => {
    const matches = [...(hits.get(id) ?? [])];
    return { id, matches };
  });
}

function idsForNumber(db: DatabaseSync, number: string, from?: string, to?: string): Map<string, Set<MatchReason>> {
  const hits = new Map<string, Set<MatchReason>>();
  if (number.startsWith('維修單')) {
    const parsed = parseFullOrderNumber(number);
    if (!parsed) throw new HttpError(400, '完整單號格式應為 維修單-YYYYMMDD-NNN');
    const date = dateClause('o', from, to);
    for (const row of all(
      db,
      `SELECT o.id FROM work_orders o WHERE o.order_number = ? AND ${date.sql}`,
      formatOrderNumber(parsed.orderDate, parsed.serial),
      ...date.params,
    )) {
      addHit(hits, text(row, 'id'), 'order_number');
    }
    for (const row of all(
      db,
      `SELECT o.id FROM work_orders o WHERE o.order_date = ? AND o.serial = ? AND ${date.sql}`,
      parsed.orderDate,
      parsed.serial,
      ...date.params,
    )) {
      addHit(hits, text(row, 'id'), 'order_number');
    }
    return hits;
  }
  if (!/^\d+$/.test(number)) throw new HttpError(400, '請輸入 6 位公號、流水號，或完整單號 維修單-YYYYMMDD-NNN');
  const date = dateClause('o', from, to);
  if (isEmployeeNumber(number)) {
    for (const row of all(
      db,
      `SELECT o.id
       FROM work_orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE c.employee_number = ? AND ${date.sql}`,
      number,
      ...date.params,
    )) {
      addHit(hits, text(row, 'id'), 'employee_number');
    }
  }
  const serial = parseSerialToken(number);
  if (serial != null) {
    for (const row of all(
      db,
      `SELECT o.id FROM work_orders o WHERE o.serial = ? AND ${date.sql}`,
      serial,
      ...date.params,
    )) {
      addHit(hits, text(row, 'id'), 'order_serial');
    }
  }
  return hits;
}

function idsForNt(db: DatabaseSync, nt: string, from?: string, to?: string): Map<string, Set<MatchReason>> {
  const hits = new Map<string, Set<MatchReason>>();
  const date = dateClause('o', from, to);
  for (const row of all(
    db,
    `SELECT o.id
     FROM work_orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE c.nt_sam = ? AND ${date.sql}`,
    ntSam(nt),
    ...date.params,
  )) {
    addHit(hits, text(row, 'id'), 'nt_account');
  }
  return hits;
}

function idsForDate(db: DatabaseSync, from?: string, to?: string): Map<string, Set<MatchReason>> {
  const hits = new Map<string, Set<MatchReason>>();
  const date = dateClause('work_orders', from, to);
  for (const row of all(db, `SELECT id FROM work_orders WHERE ${date.sql}`, ...date.params)) {
    hits.set(text(row, 'id'), new Set());
  }
  return hits;
}

function applyListFilters(db: DatabaseSync, ids: string[], filters: SearchFilters): string[] {
  if (ids.length === 0) return [];
  const clauses = [`o.id IN (${ids.map(() => '?').join(', ')})`];
  const params: SQLInputValue[] = [...ids];
  if (filters.status === 'open') clauses.push(`o.status != 'completed'`);
  else if (filters.status && isStatus(filters.status)) {
    clauses.push('o.status = ?');
    params.push(filters.status);
  }
  if (filters.customerId) {
    clauses.push('o.customer_id = ?');
    params.push(filters.customerId);
  }
  if (filters.deviceId) {
    clauses.push('o.device_id = ?');
    params.push(filters.deviceId);
  }
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    clauses.push(
      `(o.order_number LIKE ? ESCAPE '\\' OR o.repair_target LIKE ? ESCAPE '\\' OR o.requirements LIKE ? ESCAPE '\\'
        OR c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.employee_number LIKE ? ESCAPE '\\'
        OR c.nt_account LIKE ? ESCAPE '\\' OR d.brand LIKE ? ESCAPE '\\' OR d.model LIKE ? ESCAPE '\\'
        OR IFNULL(d.serial_number, '') LIKE ? ESCAPE '\\')`,
    );
    for (let i = 0; i < 10; i += 1) params.push(like);
  }
  const rows = all(
    db,
    `SELECT o.id
     FROM work_orders o
     JOIN customers c ON c.id = o.customer_id
     JOIN devices d ON d.id = o.device_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY o.updated_at DESC, o.id DESC`,
    ...params,
  );
  return rows.map((row) => text(row, 'id'));
}

function resolveCustomer(db: DatabaseSync, input: CreateOrderInput, at: string): string {
  if (input.customer.mode === 'existing') {
    const found = one(db, 'SELECT id FROM customers WHERE id = ?', input.customer.id);
    if (!found) throw new HttpError(400, '找不到這位客戶');
    return text(found, 'id');
  }
  const name = input.customer.name.trim();
  const phone = input.customer.phone.trim();
  const employeeNumber = toHalfWidth(input.customer.employeeNumber).trim();
  const ntAccount = input.customer.ntAccount.trim();
  if (!name) throw new HttpError(400, '請填寫客戶姓名');
  if (phone.replace(/\D/g, '').length < 8) throw new HttpError(400, '請填寫有效的聯絡電話');
  if (!isEmployeeNumber(employeeNumber)) throw new HttpError(400, '公號必須是 6 位數字');
  if (!isNtAccount(ntAccount)) throw new HttpError(400, '請填寫 NT 帳號，例如 CORP\\pinyan');
  const email = input.customer.email?.trim();
  if (email && !email.includes('@')) throw new HttpError(400, '電子郵件格式不正確');
  const id = crypto.randomUUID();
  try {
    db.prepare(
      `INSERT INTO customers (id, name, phone, email, note, employee_number, nt_account, nt_sam, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, phone, email || null, input.customer.note?.trim() || null, employeeNumber, ntAccount, ntSam(ntAccount), at);
  } catch (error) {
    if (isUnique(error)) throw new HttpError(400, GENERIC_CUSTOMER_ERROR);
    throw error;
  }
  return id;
}

function resolveDevice(db: DatabaseSync, input: CreateOrderInput, customerId: string, at: string): string {
  if (input.device.mode === 'existing') {
    const device = one(db, 'SELECT id, customer_id FROM devices WHERE id = ?', input.device.id);
    if (!device || text(device, 'customer_id') !== customerId) throw new HttpError(400, '這台設備不屬於這位客戶');
    return text(device, 'id');
  }
  const brand = input.device.brand.trim();
  const model = input.device.model.trim();
  if (!brand || !model) throw new HttpError(400, '請填寫設備品牌與型號');
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO devices (id, customer_id, kind, brand, model, serial_number, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    customerId,
    input.device.kind,
    brand,
    model,
    input.device.serialNumber?.trim() || null,
    input.device.note?.trim() || null,
    at,
  );
  return id;
}

function allocateSerial(db: DatabaseSync, orderDate: string): number {
  const row = one(
    db,
    `INSERT INTO daily_serials (order_date, last_serial) VALUES (?, 1)
     ON CONFLICT(order_date) DO UPDATE SET last_serial = last_serial + 1
     RETURNING last_serial`,
    orderDate,
  );
  if (!row) throw new HttpError(500, '無法取得當日流水號');
  return integer(row, 'last_serial');
}

function insertOrder(db: DatabaseSync, order: RepairOrder) {
  const createdOn = `${order.orderDate.slice(0, 4)}-${order.orderDate.slice(4, 6)}-${order.orderDate.slice(6, 8)}`;
  db.prepare(
    `INSERT INTO work_orders (
      id, order_date, serial, order_number, customer_id, device_id, repair_kind, repair_target,
      requirements, status, created_on, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    order.id,
    order.orderDate,
    order.serial,
    order.orderNumber,
    order.customerId,
    order.deviceId,
    order.repairKind,
    order.repairTarget,
    order.requirements,
    order.status,
    createdOn,
    order.createdAt,
    order.updatedAt,
    order.completedAt ?? null,
  );
}

function insertLog(db: DatabaseSync, orderId: string, entry: ActionLog) {
  db.prepare(
    `INSERT INTO action_logs (id, order_id, at, author, content, visible_to_customer, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entry.id, orderId, entry.at, entry.author, entry.content, entry.visibleToCustomer ? 1 : 0, entry.kind);
}

function insertStatus(db: DatabaseSync, orderId: string, change: StatusChange) {
  db.prepare(
    `INSERT INTO status_history (id, order_id, from_status, to_status, at, author)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(change.id, orderId, change.fromStatus, change.toStatus, change.at, change.author);
}

function seedStatusHistory(order: RepairOrder): StatusChange[] {
  const changes: StatusChange[] = [
    {
      id: `${order.id}-status-0`,
      at: order.createdAt,
      author: order.logs[0]?.author ?? '系統',
      fromStatus: null,
      toStatus: 'received',
    },
  ];
  if (order.status !== 'received') {
    const statusLog = [...order.logs].reverse().find((entry) => entry.kind === 'status');
    changes.push({
      id: `${order.id}-status-1`,
      at: statusLog?.at ?? order.updatedAt,
      author: statusLog?.author ?? '系統',
      fromStatus: 'received',
      toStatus: order.status,
    });
  }
  return changes;
}

function customers(db: DatabaseSync): Customer[] {
  return all(db, 'SELECT * FROM customers ORDER BY name').map((row) => ({
    id: text(row, 'id'),
    name: text(row, 'name'),
    phone: text(row, 'phone'),
    email: textOpt(row, 'email'),
    note: textOpt(row, 'note'),
    employeeNumber: text(row, 'employee_number'),
    ntAccount: text(row, 'nt_account'),
    createdAt: text(row, 'created_at'),
  }));
}

function devices(db: DatabaseSync): Device[] {
  return all(db, 'SELECT * FROM devices ORDER BY brand, model').map((row) => ({
    id: text(row, 'id'),
    customerId: text(row, 'customer_id'),
    kind: text(row, 'kind') as DeviceKind,
    brand: text(row, 'brand'),
    model: text(row, 'model'),
    serialNumber: textOpt(row, 'serial_number'),
    note: textOpt(row, 'note'),
    createdAt: text(row, 'created_at'),
  }));
}

function hydrateOrders(
  db: DatabaseSync,
  ids: { id: string; matches?: MatchReason[] }[],
  publicOnly: boolean,
): RepairOrder[] {
  if (ids.length === 0) return [];
  const wanted = new Map(ids.map((item) => [item.id, item.matches]));
  const placeholders = ids.map(() => '?').join(', ');
  const params = ids.map((item) => item.id);
  const orders = all(
    db,
    `SELECT * FROM work_orders WHERE id IN (${placeholders}) ORDER BY updated_at DESC, id DESC`,
    ...params,
  ).map((row) => {
    const id = text(row, 'id');
    const order: RepairOrder = {
      id,
      orderDate: text(row, 'order_date'),
      serial: integer(row, 'serial'),
      orderNumber: text(row, 'order_number'),
      customerId: text(row, 'customer_id'),
      deviceId: text(row, 'device_id'),
      repairKind: text(row, 'repair_kind') as RepairKind,
      repairTarget: text(row, 'repair_target'),
      requirements: publicOnly ? '' : text(row, 'requirements'),
      status: text(row, 'status') as RepairStatus,
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at'),
      completedAt: textOpt(row, 'completed_at'),
      logs: [],
      statusHistory: publicOnly ? undefined : [],
      matches: wanted.get(id),
    };
    return order;
  });
  const logs = all(
    db,
    `SELECT * FROM action_logs
     WHERE order_id IN (${placeholders}) ${publicOnly ? 'AND visible_to_customer = 1' : ''}
     ORDER BY at, id`,
    ...params,
  );
  const byOrder = new Map(orders.map((order) => [order.id, order]));
  for (const row of logs) {
    const order = byOrder.get(text(row, 'order_id'));
    if (!order) continue;
    order.logs.push({
      id: text(row, 'id'),
      at: text(row, 'at'),
      author: text(row, 'author'),
      content: text(row, 'content'),
      visibleToCustomer: integer(row, 'visible_to_customer') === 1,
      kind: text(row, 'kind') as LogKind,
    });
  }
  if (!publicOnly) {
    const history = all(
      db,
      `SELECT * FROM status_history WHERE order_id IN (${placeholders}) ORDER BY at, id`,
      ...params,
    );
    for (const row of history) {
      const order = byOrder.get(text(row, 'order_id'));
      order?.statusHistory?.push({
        id: text(row, 'id'),
        at: text(row, 'at'),
        author: text(row, 'author'),
        fromStatus: (textOpt(row, 'from_status') as RepairStatus | undefined) ?? null,
        toStatus: text(row, 'to_status') as RepairStatus,
      });
    }
  }
  return orders;
}

function toPublic(order: RepairOrder): PublicOrder {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    repairKind: order.repairKind,
    repairTarget: order.repairTarget,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    completedAt: order.completedAt,
    customerName: '',
    phoneMasked: '',
    deviceSummary: '',
    publicLogs: order.logs.filter((entry) => entry.visibleToCustomer).map((entry) => ({
      id: entry.id,
      at: entry.at,
      author: entry.author,
      content: entry.content,
      kind: entry.kind,
    })),
  };
}

function dateClause(alias: string, from?: string, to?: string): { sql: string; params: SQLInputValue[] } {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  const column = alias ? `${alias}.created_on` : 'created_on';
  if (from) {
    parts.push(`${column} >= ?`);
    params.push(from);
  }
  if (to) {
    parts.push(`${column} <= ?`);
    params.push(to);
  }
  return { sql: parts.length > 0 ? parts.join(' AND ') : '1 = 1', params };
}

function cleanDate(value?: string): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw new HttpError(400, '日期格式應為 YYYY-MM-DD');
  return trimmed;
}

function addHit(map: Map<string, Set<MatchReason>>, id: string, reason: MatchReason) {
  const reasons = map.get(id) ?? new Set<MatchReason>();
  reasons.add(reason);
  map.set(id, reasons);
}

function intersect(left: Map<string, Set<MatchReason>>, right: Map<string, Set<MatchReason>>): Map<string, Set<MatchReason>> {
  const next = new Map<string, Set<MatchReason>>();
  for (const [id, reasons] of left) {
    const other = right.get(id);
    if (!other) continue;
    next.set(id, new Set([...reasons, ...other]));
  }
  return next;
}

function idRows(db: DatabaseSync, sql: string): { id: string }[] {
  return all(db, sql).map((row) => ({ id: text(row, 'id') }));
}

function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Keep the original failure.
    }
    throw error;
  }
}

function one(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

function all(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`欄位 ${key} 不是文字`);
  return value;
}

function textOpt(row: Row, key: string): string | undefined {
  const value = row[key];
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error(`欄位 ${key} 不是文字`);
  return value;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`欄位 ${key} 不是整數`);
}

function isStatus(value: string): value is RepairStatus {
  return value === 'received' || value === 'in_progress' || value === 'ready' || value === 'completed';
}

function isUnique(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE');
}

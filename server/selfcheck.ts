import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { IncomingMessage } from 'node:http';
import type { Database, RepairOrder, SessionUser } from '../src/types.ts';
import { taipeiCalendar } from '../src/lib/orderNumber.ts';
import { createSession, purgeExpiredSessions } from './auth.ts';
import { backupDatabase } from './backup.ts';
import { createOrder, createUser, explainPlan, openDatabase, resetSeed, searchOrders, searchPublic, type SearchFilters } from './db.ts';
import { startServer } from './index.ts';
import { databasePath } from './paths.ts';
import { bucketIp, clientIp, generalLimiter, loginLimiter, loginLockout, lookupLimiter, lookupLockout } from './rate-limit.ts';

const filename = path.join(os.tmpdir(), `repair-selfcheck-${process.pid}.sqlite`);
fs.rmSync(filename, { force: true });
fs.rmSync(`${filename}-wal`, { force: true });
fs.rmSync(`${filename}-shm`, { force: true });
const db = openDatabase(filename);
delete process.env.REPAIR_ADMIN_PASSWORD;
const seedLogs: string[] = [];
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  seedLogs.push(args.map((item) => String(item)).join(' '));
};
const seededAdmin = resetSeed(db);
console.log = originalLog;
assert(seededAdmin?.username === 'admin' && seededAdmin.password.length >= 20, '種子應產生管理員密碼');
assert(!seedLogs.some((line) => line.includes(seededAdmin.password)), '主控台不得印出管理員密碼');
const passwordFile = `${filename}.admin-password`;
assert(fs.readFileSync(passwordFile, 'utf8').trim() === seededAdmin.password, '初始密碼應寫入一次性檔案');
assert((fs.statSync(passwordFile).mode & 0o777) === 0o600, '密碼檔應為 600');
assert(seedLogs.some((line) => line.includes(passwordFile)), '主控台應印出密碼檔路徑');
const mustChange = db.prepare('SELECT must_change_password AS flag FROM users WHERE username = ?').get('admin') as { flag: number };
assert(Number(mustChange.flag) === 1, '預設管理員首次登入必須變更密碼');
const envFile = path.join(os.tmpdir(), `repair-selfcheck-env-${process.pid}.sqlite`);
fs.rmSync(envFile, { force: true });
const envDb = openDatabase(envFile);
process.env.REPAIR_ADMIN_PASSWORD = 'env-admin-password';
const envLogs: string[] = [];
console.log = (...args: unknown[]) => {
  envLogs.push(args.map((item) => String(item)).join(' '));
};
const envAdmin = resetSeed(envDb);
console.log = originalLog;
assert(envAdmin?.password === 'env-admin-password', '應採用 REPAIR_ADMIN_PASSWORD');
assert(!envLogs.some((line) => line.includes('env-admin-password')), '環境變數密碼不得印出');
assert(!fs.existsSync(`${envFile}.admin-password`), '有環境變數時不應再寫密碼檔');
delete process.env.REPAIR_ADMIN_PASSWORD;
envDb.close();
fs.rmSync(envFile, { force: true });
fs.rmSync(`${envFile}-wal`, { force: true });
fs.rmSync(`${envFile}-shm`, { force: true });
assert((fs.statSync(filename).mode & 0o777) === 0o600, `資料庫檔案應為 600，實際 ${(fs.statSync(filename).mode & 0o777).toString(8)}`);
for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${filename}${suffix}`;
  if (!fs.existsSync(sidecar)) continue;
  assert((fs.statSync(sidecar).mode & 0o777) === 0o600, `${suffix} 應為 600`);
}

const savedDbPath = process.env.REPAIR_DB_PATH;
process.env.REPAIR_DB_PATH = 'data/repair.sqlite';
let relativeRejected = false;
try {
  databasePath();
} catch (error) {
  relativeRejected = error instanceof Error && error.message.includes('絕對路徑');
}
if (savedDbPath === undefined) delete process.env.REPAIR_DB_PATH;
else process.env.REPAIR_DB_PATH = savedDbPath;
assert(relativeRejected, '相對資料庫路徑應被拒絕');
assert(bucketIp('2001:db8:1:2::1') === bucketIp('2001:db8:1:2:ffff::9'), '同一個 IPv6 /64 應共用配額');
assert(bucketIp('2001:db8:1:2::1') !== bucketIp('2001:db8:1:3::1'), '不同 IPv6 /64 應分開計算');
assert(bucketIp('::ffff:203.0.113.8') === '203.0.113.8', 'IPv4-mapped 位址應還原成 IPv4');
const untrustedPeer = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } } as unknown as IncomingMessage;
delete process.env.REPAIR_TRUSTED_PROXIES;
assert(clientIp(untrustedPeer) === '127.0.0.1', '未信任的來源應忽略 X-Forwarded-For');
process.env.REPAIR_TRUSTED_PROXIES = '127.0.0.1';
assert(clientIp(untrustedPeer) === '203.0.113.9', '信任代理時應採用轉送位址');
const v6Peer = { socket: { remoteAddress: '2001:db8:1:2::10' }, headers: { 'x-forwarded-for': '198.51.100.4, 203.0.113.50' } } as unknown as IncomingMessage;
process.env.REPAIR_TRUSTED_PROXIES = '2001:db8:1:2::10';
assert(clientIp(v6Peer) === '203.0.113.50', '應採用最右邊一個未信任的轉送位址');
delete process.env.REPAIR_TRUSTED_PROXIES;
createSession(db, 'admin');
db.prepare('UPDATE sessions SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
purgeExpiredSessions(db);
const remainingSessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
assert(Number(remainingSessions.n) === 0, '應清掉過期的 session');
process.env.REPAIR_DB_PATH = filename;
assert(databasePath() === filename, '應接受絕對路徑的 REPAIR_DB_PATH');
if (savedDbPath === undefined) delete process.env.REPAIR_DB_PATH;
else process.env.REPAIR_DB_PATH = savedDbPath;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function numbers(filters: SearchFilters) {
  return searchOrders(db, filters).map((order) => order.orderNumber);
}

function reasons(orderNumber: string, filters: SearchFilters) {
  return searchOrders(db, filters).find((order) => order.orderNumber === orderNumber)?.matches ?? [];
}

const lin = numbers({ number: '100002' });
assert(lin.includes('維修單-20261024-001') && lin.includes('維修單-20261025-001'), `公號應找到林承翰的兩張單：${lin.join(', ')}`);
assert(reasons('維修單-20261024-001', { number: '100002' }).includes('employee_number'), '公號比對應標成員工編號');

const serialOnes = numbers({ number: '1' });
assert(serialOnes.length >= 8, `流水號 1 應跨日命中多張單，實際 ${serialOnes.length}`);
assert(reasons('維修單-20261024-001', { number: '1' }).join() === 'order_serial', '純流水號只標當日序號');
const padded = numbers({ number: '000001' });
assert(padded.includes('維修單-20261024-001'), '000001 應比到流水號 001');

const oneDay = numbers({ number: '1', from: '2026-10-24', to: '2026-10-24' });
assert(oneDay.length === 1 && oneDay[0] === '維修單-20261024-001', `日期應縮小流水號結果：${oneDay.join(', ')}`);

const exact = numbers({ number: '維修單-20261028-002' });
assert(exact.length === 1 && exact[0] === '維修單-20261028-002', '完整單號應精準命中');
assert(reasons('維修單-20261028-002', { number: '維修單-20261028-2' }).includes('order_number'), '未補零的完整單號也應命中');
assert(numbers({ number: '維修單-20261028-002', from: '2026-10-01', to: '2026-10-02' }).length === 0, '日期範圍應排除完整單號');

const october28 = numbers({ from: '2026-10-28', to: '2026-10-28' });
assert(october28.length === 2, `10/28 應有兩張單：${october28.join(', ')}`);

for (const nt of ['chenghan', 'CORP\\chenghan', 'corp\\ChengHan', 'OTHER\\chenghan']) {
  const found = numbers({ nt });
  assert(found.includes('維修單-20261024-001'), `NT ${nt} 應找到林承翰`);
  assert(reasons('維修單-20261024-001', { nt }).includes('nt_account'), 'NT 比對應標成 NT 帳號');
}

const both = searchOrders(db, { number: '2', nt: 'jiahao' });
assert(both.length === 1 && both[0]?.orderNumber === '維修單-20261028-002', `公號與 NT 同時填寫時取交集：${both.map((order) => order.orderNumber).join(', ')}`);
assert(both[0]?.matches?.includes('order_serial') && both[0]?.matches?.includes('nt_account'), '交集應保留兩邊的比對來源');

const today = taipeiCalendar(new Date());
const created = createOrder(db, {
  customer: { mode: 'new', name: '測試員', phone: '0912-000-111', employeeNumber: '000001', ntAccount: 'corp\\tester' },
  device: { mode: 'new', kind: 'laptop', brand: 'Framework', model: 'Laptop 13' },
  repairKind: 'software',
  repairTarget: '無法連上公司 VPN',
  requirements: '請保留原系統',
  initialLog: 'ping 8.8.8.8',
  initialLogVisible: false,
  author: '林可恩',
});
assert(created.orderNumber === `維修單-${today.compact}-001`, `新單號應為當天 001，實際 ${created.orderNumber}`);
assert(created.logs.some((entry) => entry.content.includes('ping') && !entry.visibleToCustomer), '初始指令應為內部紀錄');
const dual = searchOrders(db, { number: '000001' }).find((order) => order.id === created.id);
assert(dual?.matches?.includes('employee_number') && dual.matches.includes('order_serial'), '6 位公號若也等於流水號，兩種來源都要標出');
const todayOnly = searchOrders(db, { number: '000001', from: today.ymd, to: today.ymd });
assert(todayOnly.length === 1 && todayOnly[0]?.id === created.id, '加上當天日期後，不應再帶出其他日子的 001');

const second = createOrder(db, {
  customer: { mode: 'existing', id: 'cus-chen' },
  device: { mode: 'existing', id: 'dev-zenbook' },
  repairKind: 'hardware',
  repairTarget: '第二張當日單',
  requirements: '',
  initialLog: '',
  initialLogVisible: false,
  author: '林可恩',
});
assert(second.serial === created.serial + 1, '同一天的下一張單應接續流水號');

let rejected = false;
try {
  createOrder(db, {
    customer: { mode: 'new', name: '壞公號', phone: '0912000222', employeeNumber: '12345', ntAccount: 'corp\\bad' },
    device: { mode: 'new', kind: 'laptop', brand: 'A', model: 'B' },
    repairKind: 'hardware',
    repairTarget: 'x',
    requirements: '',
    initialLog: '',
    initialLogVisible: false,
    author: '林可恩',
  });
} catch (error) {
  rejected = error instanceof Error && error.message.includes('6 位');
}
assert(rejected, '不足 6 位的公號應被拒絕');

let duplicate = false;
try {
  createOrder(db, {
    customer: { mode: 'new', name: '重複', phone: '0912000333', employeeNumber: '100001', ntAccount: 'corp\\dup' },
    device: { mode: 'new', kind: 'laptop', brand: 'A', model: 'B' },
    repairKind: 'hardware',
    repairTarget: 'x',
    requirements: '',
    initialLog: '',
    initialLogVisible: false,
    author: '林可恩',
  });
} catch (error) {
  duplicate = error instanceof Error && error.message === '無法建立客戶，請確認資料後再試' && !error.message.includes('公號') && !error.message.includes('100001');
}
assert(duplicate, '重複公號應被拒絕，且不得透露公號已存在');

let employeeBlocked = false;
try {
  employeeBlocked = searchPublic(db, { number: '100002', phoneLast4: '0334' }).length === 0;
} catch {
  employeeBlocked = true;
}
assert(employeeBlocked, '公號不得查出維修單');

let serialBlocked = false;
try {
  const leaked = searchPublic(db, { number: '1', phoneLast4: '0334' });
  serialBlocked = leaked.length === 0;
} catch {
  serialBlocked = true;
}
assert(serialBlocked, '流水號不得查出他人維修單');

const pub = searchPublic(db, { number: '維修單-20261024-001', phoneLast4: '0334' });
assert(pub.length === 1 && pub[0]?.orderNumber === '維修單-20261024-001', '完整單號加電話末四碼應只回一張單');
const woForm = searchPublic(db, { number: 'WO-20261024-001', phoneLast4: '0334' });
assert(woForm.length === 1 && woForm[0]?.orderNumber === '維修單-20261024-001', 'WO-YYYYMMDD-NNN 應等同完整單號');
assert(searchPublic(db, { number: '維修單-20261024-001', phoneLast4: '4567' }).length === 0, '電話末四碼不符不得回傳');
assert(searchPublic(db, { number: '維修單-20261028-002', phoneLast4: '0334' }).length === 0, '單號與他人電話不得交叉查出');
let unpadded = false;
try {
  unpadded = searchPublic(db, { number: '維修單-20261024-1', phoneLast4: '0334' }).length === 0;
} catch {
  unpadded = true;
}
assert(unpadded, '未補齊的單號不得作為客戶查詢');

const publicBody = JSON.stringify(pub);
for (const secret of ['diskutil', 'rsync', 'smartctl', 'nvlddmkm', 'memtest', '未備份的剪輯專案']) {
  assert(!publicBody.toLowerCase().includes(secret.toLowerCase()), `客戶查詢不該出現：${secret}`);
}
const staffBody = JSON.stringify(searchOrders(db, { number: '100002' }));
assert(staffBody.includes('diskutil'), '店內查詢應保留內部指令');
const invoice = JSON.stringify(searchPublic(db, { number: '維修單-20261026-001', phoneLast4: '7452' }));
assert(invoice.includes('維修單-20261026-001'), '正確的第二因素應查到該單');
assert(!invoice.includes('佩琪會計師事務所'), '客戶查詢不該回傳內部備註');
assert(!invoice.toLowerCase().includes('memtest'), '客戶查詢不該回傳內部指令');

let missingIdentity = false;
try {
  searchPublic(db, { number: '100002' });
} catch (error) {
  missingIdentity = error instanceof Error && error.message.includes('完整單號');
}
assert(missingIdentity, '客戶查詢必須使用完整單號');

for (const [label, sql, params] of [
  ['serial', 'SELECT id FROM work_orders WHERE serial = ? AND created_on >= ? AND created_on <= ?', [1, '2026-10-01', '2026-10-31']],
  ['created', 'SELECT id FROM work_orders WHERE created_on >= ? AND created_on <= ?', ['2026-10-01', '2026-10-31']],
  ['employee', 'SELECT id FROM customers WHERE employee_number = ?', ['100002']],
  ['nt', 'SELECT id FROM customers WHERE nt_sam = ?', ['chenghan']],
] as const) {
  const plan = explainPlan(db, sql, ...params);
  assert(/INDEX|COVERING/i.test(plan), `${label} 查詢沒有使用索引：${plan}`);
}

const raced = await Promise.all(
  Array.from({ length: 5 }, () =>
    new Promise<{ serial: number }>((resolve, reject) => {
      const worker = new Worker(new URL('./concurrency-worker.mjs', import.meta.url), {
        workerData: { dbPath: filename, orderDate: '20990101' },
      });
      worker.on('message', resolve);
      worker.on('error', reject);
    }),
  ),
);
const serials = raced.map((item) => item.serial).sort((a, b) => a - b);
assert(serials.join() === '1,2,3,4,5', `並行取號應得到 1 到 5，實際 ${serials.join()}`);

let backupRelative = false;
try {
  backupDatabase(db, 'backup.sqlite');
} catch (error) {
  backupRelative = error instanceof Error && error.message.includes('絕對');
}
assert(backupRelative, '相對備份路徑應被拒絕');
const backupPath = path.join(os.tmpdir(), `repair-selfcheck-backup-${process.pid}.sqlite`);
fs.rmSync(backupPath, { force: true });
backupDatabase(db, backupPath);
assert((fs.statSync(backupPath).mode & 0o777) === 0o600, '備份檔應為 600');
let existingRefused = false;
try {
  backupDatabase(db, backupPath);
} catch (error) {
  existingRefused = error instanceof Error && error.message.includes('已存在');
}
assert(existingRefused, '已存在的備份檔應被拒絕');
const backed = openDatabase(backupPath);
assert(searchOrders(backed, { number: '維修單-20261024-001' }).length === 1, '拒絕覆寫後，原備份仍應讀得到');
backed.close();
const backupDir = path.join(os.tmpdir(), `repair-backup-dir-${process.pid}`);
fs.mkdirSync(backupDir, { recursive: true });
process.env.REPAIR_BACKUP_DIR = backupDir;
const outside = path.join(os.tmpdir(), `repair-backup-outside-${process.pid}.sqlite`);
fs.rmSync(outside, { force: true });
let outsideRefused = false;
try {
  backupDatabase(db, outside);
} catch (error) {
  outsideRefused = error instanceof Error && error.message.includes('備份目錄');
}
assert(outsideRefused, '備份目錄以外的路徑應被拒絕');
assert(!fs.existsSync(outside), '被拒絕的備份不應留下檔案');
const inside = path.join(backupDir, 'copy.sqlite');
backupDatabase(db, inside);
assert((fs.statSync(inside).mode & 0o777) === 0o600, '目錄內的備份應為 600');
delete process.env.REPAIR_BACKUP_DIR;
fs.rmSync(inside, { force: true });
fs.rmSync(backupDir, { recursive: true, force: true });
fs.rmSync(backupPath, { force: true });
fs.rmSync(`${backupPath}-wal`, { force: true });
fs.rmSync(`${backupPath}-shm`, { force: true });

db.close();
await checkHttp();
fs.rmSync(filename, { force: true });
fs.rmSync(`${filename}-wal`, { force: true });
fs.rmSync(`${filename}-shm`, { force: true });
fs.rmSync(`${filename}.admin-password`, { force: true });
console.log('api selfcheck ok');

type HttpResult = { status: number; json: unknown; headers: http.IncomingHttpHeaders };

function request(
  port: number,
  method: string,
  pathname: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          if (text) json = JSON.parse(text) as unknown;
          resolve({ status: res.statusCode ?? 0, json, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('沒有 session cookie');
  return raw.split(';')[0] ?? '';
}

function ordersOf(payload: unknown): { orderNumber?: string }[] {
  if (!payload || typeof payload !== 'object' || !('orders' in payload)) return [];
  const orders = (payload as { orders?: unknown }).orders;
  return Array.isArray(orders) ? (orders as { orderNumber?: string }[]) : [];
}

async function checkHttp() {
  const httpFile = path.join(os.tmpdir(), `repair-selfcheck-http-${process.pid}.sqlite`);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${httpFile}${suffix}`, { force: true });
  const setup = openDatabase(httpFile);
  const admin = resetSeed(setup);
  assert(admin, 'HTTP 測試需要剛產生的管理員密碼');
  const staffPassword = randomBytes(12).toString('base64url');
  createUser(setup, { username: 'staff', password: staffPassword, role: 'staff' });
  setup.close();

  const previousEnv = process.env.NODE_ENV;
  const server = await startServer({ filename: httpFile, port: 0 });
  assert(server.host === '127.0.0.1', `API 應綁定 127.0.0.1，實際 ${server.host}`);
  const call = (method: string, pathname: string, body?: unknown, headers?: Record<string, string>) =>
    request(server.port, method, pathname, body, headers);

  try {
    const health = await call('GET', '/api/health');
    assert(health.status === 200, '健康檢查應可匿名');
    assert(health.headers['x-content-type-options'] === 'nosniff', '應送出 nosniff');
    assert(health.headers['x-frame-options'] === 'DENY', '應禁止被嵌入');
    assert(String(health.headers['content-security-policy'] ?? '').includes("frame-ancestors 'none'"), 'CSP 應包含 frame-ancestors');
    assert(health.headers['referrer-policy'] === 'no-referrer', '應設定 Referrer-Policy');
    assert(health.headers['access-control-allow-origin'] !== '*', '不得使用 CORS *');

    const allowed = await call('GET', '/api/health', undefined, { Origin: 'http://127.0.0.1:5173' });
    assert(allowed.headers['access-control-allow-origin'] === 'http://127.0.0.1:5173', '應允許本機來源');
    const evil = await call('POST', '/api/login', { username: 'admin', password: admin.password }, { Origin: 'http://evil.example' });
    assert(evil.status === 403, '狀態變更請求應拒絕不在允許清單的 Origin');
    assert(evil.headers['access-control-allow-origin'] !== '*', '拒絕的來源不得回 *');

    for (const [method, pathname, body] of [
      ['GET', '/api/state', undefined],
      ['GET', '/api/orders/search?number=100002', undefined],
      ['POST', '/api/orders', { repairKind: 'hardware' }],
      ['POST', '/api/orders/ord-2610001/status', { status: 'ready', author: '假冒者' }],
      ['POST', '/api/orders/ord-2610001/logs', { author: '假冒者', content: 'x', visibleToCustomer: false }],
      ['POST', '/api/admin/reset', undefined],
    ] as const) {
      const response = await call(method, pathname, body);
      assert(response.status === 401, `${method} ${pathname} 未登入應為 401，實際 ${response.status}`);
    }

    const byEmployee = await call('GET', '/api/lookup?number=100002&phoneLast4=0334');
    assert(byEmployee.status === 400 || ordersOf(byEmployee.json).length === 0, '公開查詢不得用公號');
    assert(!JSON.stringify(byEmployee.json).includes('維修單-20261025-001'), '公號查詢不得帶出他人的另一張單');
    const bySerial = await call('GET', '/api/lookup?number=1&phoneLast4=0334');
    assert(bySerial.status === 400 || ordersOf(bySerial.json).length === 0, '公開查詢不得用流水號');
    assert(!JSON.stringify(bySerial.json).includes('維修單-20261028-001'), '流水號不得列出別人的維修單');

    const found = await call('GET', `/api/lookup?number=${encodeURIComponent('維修單-20261024-001')}&phoneLast4=0334`);
    assert(found.status === 200 && ordersOf(found.json).length === 1, '完整單號與電話末四碼應查到一張單');
    assert(ordersOf(found.json)[0]?.orderNumber === '維修單-20261024-001', '查到的應是指定單號');
    assert(!JSON.stringify(found.json).toLowerCase().includes('diskutil'), '公開查詢不得含內部指令');
    const wrongPhone = await call('GET', `/api/lookup?number=${encodeURIComponent('維修單-20261024-001')}&phoneLast4=4567`);
    assert(wrongPhone.status === 200 && ordersOf(wrongPhone.json).length === 0, '錯誤電話末四碼不得回傳維修單');
    const crossed = await call('GET', `/api/lookup?number=${encodeURIComponent('WO-20261028-002')}&phoneLast4=0334`);
    assert(crossed.status === 200 && ordersOf(crossed.json).length === 0, '他人電話不得查出這張單');

    const staffLogin = await call('POST', '/api/login', { username: 'staff', password: staffPassword });
    assert(staffLogin.status === 200, '櫃檯人員應可登入');
    const staffCookie = cookieHeader(staffLogin.headers['set-cookie']);
    assert(/HttpOnly/i.test(String(staffLogin.headers['set-cookie'])), 'cookie 應為 HttpOnly');
    assert(/SameSite=Strict/i.test(String(staffLogin.headers['set-cookie'])), 'cookie 應為 SameSite=Strict');
    const staffReset = await call('POST', '/api/admin/reset', undefined, { Cookie: staffCookie });
    assert(staffReset.status === 403, '櫃檯人員不得還原示範資料');

    const adminLogin = await call('POST', '/api/login', { username: 'admin', password: admin.password });
    assert(adminLogin.status === 200, '管理員應可登入');
    const adminCookie = cookieHeader(adminLogin.headers['set-cookie']);
    const session = adminLogin.json as SessionUser;
    assert(session.role === 'admin' && session.username === 'admin', '登入回應應為管理員');
    assert(session.mustChangePassword === true, '預設管理員登入後應被要求變更密碼');
    const blockedState = await call('GET', '/api/state', undefined, { Cookie: adminCookie });
    assert(blockedState.status === 403, `變更密碼前不得讀取店內資料，實際 ${blockedState.status}`);
    const changed = await call(
      'POST',
      '/api/account/password',
      { currentPassword: admin.password, newPassword: 'replacement-pass-1' },
      { Cookie: adminCookie },
    );
    assert(changed.status === 200, `變更密碼應成功，實際 ${changed.status} ${JSON.stringify(changed.json)}`);
    assert((changed.json as SessionUser).mustChangePassword === false, '變更後應解除限制');
    const unlocked = await call('GET', '/api/state', undefined, { Cookie: adminCookie });
    assert(unlocked.status === 200, '變更密碼後應讀得到店內資料');

    process.env.NODE_ENV = 'production';
    const prodLogin = await call('POST', '/api/login', { username: 'admin', password: 'replacement-pass-1' });
    assert(prodLogin.status === 200, '正式環境應可登入');
    const prodSetCookie = String(prodLogin.headers['set-cookie']);
    assert(prodSetCookie.includes('__Host-nextone_session='), '正式環境 cookie 應使用 __Host- 前綴');
    assert(/;\s*Secure/i.test(prodSetCookie), '正式環境 cookie 應為 Secure');
    assert(!/Domain=/i.test(prodSetCookie), '__Host- cookie 不得帶 Domain');
    const prodCookie = cookieHeader(prodLogin.headers['set-cookie']);
    const blockedReset = await call('POST', '/api/admin/reset', undefined, { Cookie: prodCookie });
    assert(blockedReset.status === 403 && JSON.stringify(blockedReset.json).includes('正式環境'), '正式環境應停用還原示範資料');
    process.env.NODE_ENV = 'development';

    const created = await call(
      'POST',
      '/api/orders',
      {
        customer: { mode: 'existing', id: 'cus-chen' },
        device: { mode: 'existing', id: 'dev-zenbook' },
        repairKind: 'hardware',
        repairTarget: '測試紀錄人',
        requirements: '',
        initialLog: '內部檢查',
        initialLogVisible: false,
        author: '假冒者',
      },
      { Cookie: adminCookie },
    );
    assert(created.status === 201, `建立維修單應成功，實際 ${created.status} ${JSON.stringify(created.json)}`);
    const createdOrder = (created.json as { order?: RepairOrder }).order;
    assert(createdOrder?.logs.every((entry) => entry.author === 'admin'), '紀錄人應來自登入帳號，而不是請求內容');

    const badKind = await call(
      'POST',
      '/api/orders',
      {
        customer: { mode: 'existing', id: 'cus-chen' },
        device: { mode: 'existing', id: 'dev-zenbook' },
        repairKind: 'firmware',
        repairTarget: '不該建立',
        requirements: '',
        initialLog: '',
        initialLogVisible: false,
      },
      { Cookie: adminCookie },
    );
    assert(badKind.status === 400, '維修類型不在白名單應被拒絕');

    const state = await call('GET', '/api/state', undefined, { Cookie: adminCookie });
    assert(state.status === 200, '登入後應讀得到店內資料');
    const listed = state.json as Database;
    const target = listed.orders.find((order) => order.status !== 'ready');
    assert(target, '應有可改狀態的維修單');
    const statusUpdate = await call(
      'POST',
      `/api/orders/${target.id}/status`,
      { status: 'ready', author: '假冒者' },
      { Cookie: adminCookie },
    );
    assert(statusUpdate.status === 200, '管理員應可更新狀態');
    const after = await call('GET', '/api/state', undefined, { Cookie: adminCookie });
    const updated = (after.json as Database).orders.find((order) => order.id === target.id);
    const latest = updated?.statusHistory?.at(-1);
    assert(latest?.author === 'admin', `狀態紀錄人應為登入帳號，實際 ${latest?.author ?? ''}`);

    const logged = await call(
      'POST',
      `/api/orders/${target.id}/logs`,
      { author: '假冒者', content: '檢查紀錄人', visibleToCustomer: false },
      { Cookie: adminCookie },
    );
    assert(logged.status === 201, '應可新增處理紀錄');
    const withLog = await call('GET', '/api/state', undefined, { Cookie: adminCookie });
    const entry = (withLog.json as Database).orders
      .find((order) => order.id === target.id)
      ?.logs.find((item) => item.content === '檢查紀錄人');
    assert(entry?.author === 'admin', '處理紀錄作者不得採用請求內容');

    const allowedReset = await call('POST', '/api/admin/reset', undefined, { Cookie: adminCookie });
    assert(allowedReset.status === 200, '開發環境的管理員應可還原示範資料');

    delete process.env.REPAIR_TRUSTED_PROXIES;
    process.env.REPAIR_RATE_LIMIT = '1000';
    process.env.REPAIR_LOOKUP_LIMIT = '3';
    generalLimiter.reset();
    lookupLimiter.reset();
    let forwardedIgnored = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await call('GET', '/api/lookup?number=1', undefined, { 'X-Forwarded-For': `203.0.113.${attempt}` });
      if (response.status === 429) forwardedIgnored = true;
    }
    assert(forwardedIgnored, '未信任的來源應忽略 X-Forwarded-For，所有請求共用本機配額');

    process.env.REPAIR_TRUSTED_PROXIES = '127.0.0.1';
    process.env.REPAIR_LOOKUP_LIMIT = '1';
    lookupLimiter.reset();
    const forwardedFirst = await call('GET', '/api/lookup?number=1', undefined, { 'X-Forwarded-For': '203.0.113.10' });
    const forwardedSame = await call('GET', '/api/lookup?number=1', undefined, { 'X-Forwarded-For': '203.0.113.10' });
    const forwardedOther = await call('GET', '/api/lookup?number=1', undefined, { 'X-Forwarded-For': '203.0.113.11' });
    assert(forwardedFirst.status !== 429, '信任代理的第一個轉送位址不應立刻被限制');
    assert(forwardedSame.status === 429, '信任代理時，同一轉送 IP 應共用配額');
    assert(forwardedOther.status !== 429, '信任代理時，不同轉送 IP 應分開計算');
    delete process.env.REPAIR_TRUSTED_PROXIES;

    process.env.REPAIR_LOOKUP_LIMIT = '100';
    process.env.REPAIR_LOOKUP_LOCKOUT_LIMIT = '3';
    lookupLimiter.reset();
    lookupLockout.reset();
    const lockedNumber = encodeURIComponent('維修單-20261024-001');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await call('GET', `/api/lookup?number=${lockedNumber}&phoneLast4=0000`);
      assert(response.status === 200 && ordersOf(response.json).length === 0, '錯誤電話應查無資料');
    }
    const orderLocked = await call('GET', `/api/lookup?number=${lockedNumber}&phoneLast4=0334`);
    assert(orderLocked.status === 429, '同一單號失敗太多次應被鎖定');
    const otherOrder = await call('GET', `/api/lookup?number=${encodeURIComponent('維修單-20261028-001')}&phoneLast4=4567`);
    assert(otherOrder.status === 200 && ordersOf(otherOrder.json).length === 1, '其他單號不該被這次鎖定波及');
    lookupLockout.reset();
    const orderAgain = await call('GET', `/api/lookup?number=${lockedNumber}&phoneLast4=0334`);
    assert(orderAgain.status === 200 && ordersOf(orderAgain.json).length === 1, '解除鎖定後，正確的電話應查得到');

    process.env.REPAIR_LOGIN_LIMIT = '100';
    process.env.REPAIR_LOGIN_LOCKOUT_LIMIT = '3';
    loginLimiter.reset();
    loginLockout.reset();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await call('POST', '/api/login', { username: 'staff', password: 'wrong-password' });
      assert(response.status === 401, '錯誤密碼應被拒絕');
    }
    const accountLocked = await call('POST', '/api/login', { username: 'staff', password: staffPassword });
    assert(accountLocked.status === 429, '帳號失敗太多次後，正確密碼也應被鎖定');
    const otherAccount = await call('POST', '/api/login', { username: 'nobody', password: 'wrong-password' });
    assert(otherAccount.status === 401, '其他帳號不該被這次鎖定波及');
    loginLockout.reset();

    process.env.REPAIR_LOOKUP_LIMIT = '5';
    lookupLimiter.reset();
    let lookupLimited = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await call('GET', '/api/lookup?number=1');
      if (response.status === 429) lookupLimited = true;
    }
    assert(lookupLimited, '公開查詢應有每 IP 速率限制');

    process.env.REPAIR_RATE_LIMIT = '3';
    generalLimiter.reset();
    const codes: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) codes.push((await call('GET', '/api/health')).status);
    assert(codes.includes(429), `一般請求應有速率限制，實際 ${codes.join(',')}`);
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    delete process.env.REPAIR_LOOKUP_LIMIT;
    delete process.env.REPAIR_RATE_LIMIT;
    delete process.env.REPAIR_TRUSTED_PROXIES;
    delete process.env.REPAIR_LOOKUP_LOCKOUT_LIMIT;
    delete process.env.REPAIR_LOGIN_LIMIT;
    delete process.env.REPAIR_LOGIN_LOCKOUT_LIMIT;
    lookupLimiter.reset();
    generalLimiter.reset();
    loginLimiter.reset();
    lookupLockout.reset();
    loginLockout.reset();
    await server.close();
    for (const suffix of ['', '-wal', '-shm', '.admin-password']) fs.rmSync(`${httpFile}${suffix}`, { force: true });
  }
}

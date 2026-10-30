import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import type { Database, RepairOrder, SessionUser } from '../src/types.ts';
import { canonicalWorkOrderNumber, taipeiCalendar } from '../src/lib/orderNumber.ts';
import {
  INITIAL_PASSWORD_HINT,
  LOOKUP_NUMBER_HELP,
  LOOKUP_PHONE_PLACEHOLDER,
  PASSWORD_RULE,
  PASSWORD_UPDATED,
  PUBLIC_RECORDER,
  RESET_CONFIRM,
  SERIAL_HINT,
  attemptsRemainingWarning,
  countdownSeconds,
  loginLockoutMessage,
  lookupLockoutMessage,
  showDemoAndReset,
  statusConfirmText,
} from '../src/lib/ux.ts';
import { createSession, purgeExpiredSessions, readSession } from './auth.ts';
import { backupDatabase } from './backup.ts';
import { createOrder, createUser, explainPlan, openDatabase, resetSeed, searchOrders, searchPublic, type SearchFilters } from './db.ts';
import { startServer } from './index.ts';
import { databasePath } from './paths.ts';
import { bucketIp, clientIp, createLockout, createRateLimiter, generalLimiter, loginAccountLockout, loginLimiter, loginLockout, lookupLimiter, lookupLockout } from './rate-limit.ts';

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
assert(PASSWORD_RULE === '8 到 200 個字，不能與目前密碼相同', '變更密碼說明應使用指定文字');
assert(INITIAL_PASSWORD_HINT === '第一次登入時，目前密碼是初始密碼。', '應說明目前密碼是初始密碼');
assert(LOOKUP_NUMBER_HELP === '單號印在送修單上', '查詢說明應指出單號印在送修單上');
assert(LOOKUP_PHONE_PLACEHOLDER === '例：1234', '電話欄位提示應為例：1234');
assert(SERIAL_HINT === '流水號要 3 位，例如 001', '應提示流水號補成 3 位');
assert(PASSWORD_UPDATED.includes('密碼已更新') && PASSWORD_UPDATED.includes('其他視窗已登出'), '變更成功應說明密碼已更新且其他視窗已登出');
assert(attemptsRemainingWarning(2, 15 * 60_000) === '再錯 2 次會鎖定 15 分鐘', '剩兩次應提示鎖定時間');
assert(attemptsRemainingWarning(1, 15 * 60_000) === '再錯 1 次會鎖定 15 分鐘', '剩一次應提示鎖定時間');
assert(attemptsRemainingWarning(3, 15 * 60_000) === null, '剩餘較多時不需預警');
assert(countdownSeconds(10, 1_000, 4_500) === 7, '倒數應隨時間減少');
assert(countdownSeconds(10, 1_000, 20_000) === 0, '倒數結束後應為 0');
assert(RESET_CONFIRM === '還原示範資料', '還原必須輸入指定確認文字');
assert(statusConfirmText('維修中') === '確定要把狀態改成「維修中」嗎？', '變更狀態前應先確認');
assert(showDemoAndReset(false) === true, '開發環境應顯示示範與還原');
assert(showDemoAndReset(true) === false, '正式環境應隱藏示範按鈕與還原');
const untrustedPeer = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } } as unknown as IncomingMessage;
delete process.env.REPAIR_TRUSTED_PROXIES;
assert(clientIp(untrustedPeer) === '127.0.0.1', '未信任的來源應忽略 X-Forwarded-For');
process.env.REPAIR_TRUSTED_PROXIES = '127.0.0.1';
assert(clientIp(untrustedPeer) === '203.0.113.9', '信任代理時應採用轉送位址');
const v6Peer = { socket: { remoteAddress: '2001:db8:1:2::10' }, headers: { 'x-forwarded-for': '198.51.100.4, 203.0.113.50' } } as unknown as IncomingMessage;
process.env.REPAIR_TRUSTED_PROXIES = '2001:db8:1:2::10';
assert(clientIp(v6Peer) === '203.0.113.50', '應採用最右邊一個未信任的轉送位址');
delete process.env.REPAIR_TRUSTED_PROXIES;
const capped = createRateLimiter({ limit: () => 1, windowMs: () => 1_000, maxKeys: () => 2 });
assert(capped.allow('a', 0), '第一個位址應放行');
assert(!capped.allow('a', 0), '同一視窗內超過上限應拒絕');
assert(capped.allow('b', 0), '新位址應放行');
assert(capped.allow('c', 0), '再一個新位址應放行並淘汰最舊紀錄');
assert(capped.allow('a', 0), '超過筆數上限時應淘汰最舊的紀錄');
assert(capped.size() <= 2, `速率表應有上限，實際 ${capped.size()}`);
capped.purge(5_000);
assert(capped.size() === 0, '過期的速率紀錄應被清掉');
const locks = createLockout({ limit: () => 2, lockMs: () => 1_000, maxKeys: () => 10 });
assert(locks.fail('acct|203.0.113.10', 0) === false, '第一次失敗尚未鎖定');
assert(locks.fail('acct|203.0.113.10', 0) === true, '達到次數應鎖定');
assert(locks.isLocked('acct|203.0.113.10', 999), '鎖定視窗內應拒絕');
assert(!locks.isLocked('acct|203.0.113.10', 1_000), '超過鎖定視窗應自動解鎖');
assert(locks.fail('acct|203.0.113.10', 1_000) === false, '解鎖後應重新計次');
const staleLocks = createLockout({ limit: () => 5, lockMs: () => 1_000, maxKeys: () => 10 });
staleLocks.fail('old', 0);
staleLocks.purge(1_000);
assert(staleLocks.size() === 0, '過期的鎖定紀錄應被清掉');
const lockCap = createLockout({ limit: () => 2, lockMs: () => 60_000, maxKeys: () => 2 });
lockCap.fail('one', 0);
lockCap.fail('two', 0);
lockCap.fail('three', 0);
assert(lockCap.size() <= 2, `鎖定表應有上限，實際 ${lockCap.size()}`);
assert(lockCap.fail('one', 0) === false, '被淘汰的鎖定應重新計次，而不是沿用舊次數');
const legacyFile = path.join(os.tmpdir(), `repair-selfcheck-legacy-${process.pid}.sqlite`);
fs.rmSync(legacyFile, { force: true });
const legacy = new DatabaseSync(legacyFile);
legacy.exec(
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
);
legacy.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
  'old-admin',
  'admin',
  'hash',
  'admin',
  '2020-01-01T00:00:00.000Z',
);
legacy.close();
const migrated = openDatabase(legacyFile);
const migratedFlag = migrated.prepare('SELECT must_change_password AS flag FROM users WHERE username = ?').get('admin') as { flag: number };
assert(Number(migratedFlag.flag) === 1, '舊資料庫的管理員應被要求變更密碼');
migrated.close();
fs.rmSync(legacyFile, { force: true });
fs.rmSync(`${legacyFile}-wal`, { force: true });
fs.rmSync(`${legacyFile}-shm`, { force: true });
const liveSession = createSession(db, 'admin');
const expiredSession = createSession(db, 'admin');
db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(
  '2000-01-01T00:00:00.000Z',
  createHash('sha256').update(expiredSession.token).digest('hex'),
);
purgeExpiredSessions(db);
assert(readSession(db, liveSession.token)?.username === 'admin', '未過期的 session 應保留');
assert(readSession(db, expiredSession.token) === null, '過期的 session 應被清掉');
const remainingSessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
assert(Number(remainingSessions.n) === 1, `清除後應只留下未過期的 session，實際 ${remainingSessions.n}`);
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
assert(canonicalWorkOrderNumber('維修單-20261024-1') === '維修單-20261024-001', '不足 3 位的流水號應補零');
assert(canonicalWorkOrderNumber('WO-20261024-1') === '維修單-20261024-001', 'WO 短流水號也應補零');
const unpadded = searchPublic(db, { number: '維修單-20261024-1', phoneLast4: '0334' });
assert(unpadded.length === 1 && unpadded[0]?.orderNumber === '維修單-20261024-001', '未補零的完整單號應查到同一張單');
assert(unpadded[0]?.publicLogs.every((entry) => entry.author === PUBLIC_RECORDER), '客戶查詢的紀錄人應是門市');
assert(!JSON.stringify(unpadded).includes('林可恩') && !JSON.stringify(unpadded).includes('周予安'), '客戶查詢不得出現店內人員姓名');

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
const backupDir = path.join(os.tmpdir(), `repair-backup-dir-${process.pid}`);
fs.rmSync(backupDir, { recursive: true, force: true });
fs.mkdirSync(backupDir, { recursive: true });
delete process.env.REPAIR_BACKUP_DIR;
let backupDirRequired = false;
try {
  backupDatabase(db, path.join(backupDir, 'missing-dir.sqlite'));
} catch (error) {
  backupDirRequired = error instanceof Error && error.message.includes('REPAIR_BACKUP_DIR');
}
assert(backupDirRequired, '未設定備份目錄時應拒絕備份');
process.env.REPAIR_BACKUP_DIR = backupDir;
const backupPath = path.join(backupDir, `repair-selfcheck-backup-${process.pid}.sqlite`);
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
const outsideDir = path.join(os.tmpdir(), `repair-backup-outside-dir-${process.pid}`);
fs.rmSync(outsideDir, { recursive: true, force: true });
fs.mkdirSync(outsideDir, { recursive: true });
const escapeLink = path.join(backupDir, 'escape');
fs.symlinkSync(outsideDir, escapeLink);
let symlinkDirRefused = false;
try {
  backupDatabase(db, path.join(escapeLink, 'stolen.sqlite'));
} catch (error) {
  symlinkDirRefused = error instanceof Error && error.message.includes('備份目錄');
}
assert(symlinkDirRefused, '指向目錄外的符號連結應被拒絕');
assert(!fs.existsSync(path.join(outsideDir, 'stolen.sqlite')), '符號連結不應把備份寫到目錄外');
const victim = path.join(outsideDir, 'victim.sqlite');
fs.writeFileSync(victim, 'keep-me');
const victimLink = path.join(backupDir, 'victim-link.sqlite');
fs.symlinkSync(victim, victimLink);
let symlinkFileRefused = false;
try {
  backupDatabase(db, victimLink);
} catch (error) {
  symlinkFileRefused = error instanceof Error && error.message.includes('符號連結');
}
assert(symlinkFileRefused, '檔案符號連結不應被當成備份目標');
assert(fs.readFileSync(victim, 'utf8') === 'keep-me', '拒絕符號連結時不應改到連結目標');
const inside = path.join(backupDir, 'copy.sqlite');
backupDatabase(db, inside);
assert((fs.statSync(inside).mode & 0o777) === 0o600, '目錄內的備份應為 600');
delete process.env.REPAIR_BACKUP_DIR;
fs.rmSync(outsideDir, { recursive: true, force: true });
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
    assert(JSON.stringify(found.json).includes(`"author":"${PUBLIC_RECORDER}"`), '公開查詢 API 的紀錄人應是門市');
    assert(!JSON.stringify(found.json).includes('林可恩') && !JSON.stringify(found.json).includes('周予安'), '公開查詢 API 不得回傳店內人員姓名');
    const shortNumber = await call('GET', `/api/lookup?number=${encodeURIComponent('維修單-20261024-1')}&phoneLast4=0334`);
    assert(shortNumber.status === 200 && ordersOf(shortNumber.json)[0]?.orderNumber === '維修單-20261024-001', 'API 應把短流水號補成 3 位');
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
    let adminCookie = cookieHeader(adminLogin.headers['set-cookie']);
    const session = adminLogin.json as SessionUser;
    assert(session.role === 'admin' && session.username === 'admin', '登入回應應為管理員');
    assert(session.mustChangePassword === true, '預設管理員登入後應被要求變更密碼');
    const blockedState = await call('GET', '/api/state', undefined, { Cookie: adminCookie });
    assert(blockedState.status === 403, `變更密碼前不得讀取店內資料，實際 ${blockedState.status}`);
    const otherLogin = await call('POST', '/api/login', { username: 'admin', password: admin.password });
    assert(otherLogin.status === 200, '變更密碼前應能再開一個 session');
    const otherCookie = cookieHeader(otherLogin.headers['set-cookie']);
    const changed = await call(
      'POST',
      '/api/account/password',
      { currentPassword: admin.password, newPassword: 'replacement-pass-1' },
      { Cookie: adminCookie },
    );
    assert(changed.status === 200, `變更密碼應成功，實際 ${changed.status} ${JSON.stringify(changed.json)}`);
    assert((changed.json as SessionUser).mustChangePassword === false, '變更後應解除限制');
    const renewed = cookieHeader(changed.headers['set-cookie']);
    const retired = await call('GET', '/api/me', undefined, { Cookie: adminCookie });
    assert(retired.status === 401, '變更密碼應使這次登入的舊 session 失效');
    const otherMe = await call('GET', '/api/me', undefined, { Cookie: otherCookie });
    assert(otherMe.status === 401, '變更密碼應登出同一個帳號的其他 session');
    const staffStill = await call('GET', '/api/me', undefined, { Cookie: staffCookie });
    assert(staffStill.status === 200, '其他帳號的 session 不該被登出');
    assert(!fs.existsSync(`${httpFile}.admin-password`), '變更密碼應刪除初始密碼檔');
    adminCookie = renewed;
    const unlocked = await call('GET', '/api/state', undefined, { Cookie: adminCookie });
    assert(unlocked.status === 200, '變更密碼後新 session 應讀得到店內資料');

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

    process.env.REPAIR_STORE_PHONE = '02-2345-6780';
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
    assert(orderLocked.status === 429, '同一單號與同一來源失敗太多次應被鎖定');
    const lookupRetry = Number((orderLocked.json as { retryAfterSeconds?: number }).retryAfterSeconds);
    assert(lookupRetry >= 1, '查詢鎖定應回傳剩餘秒數');
    assert(orderLocked.headers['retry-after'] === String(lookupRetry), '查詢鎖定應送出 Retry-After');
    assert(JSON.stringify(orderLocked.json).includes('請聯絡門市人員'), '查詢鎖定應請客戶聯絡門市人員');
    assert(JSON.stringify(orderLocked.json).includes('02-2345-6780'), '查詢鎖定應帶出門市電話');
    assert(
      JSON.stringify(orderLocked.json) ===
        JSON.stringify({ error: lookupLockoutMessage(lookupRetry, '02-2345-6780'), retryAfterSeconds: lookupRetry }),
      '查詢鎖定文案應包含大約等待時間',
    );
    process.env.REPAIR_TRUSTED_PROXIES = '127.0.0.1';
    const otherIpLookup = await call('GET', `/api/lookup?number=${lockedNumber}&phoneLast4=0334`, undefined, {
      'X-Forwarded-For': '203.0.113.80',
    });
    assert(otherIpLookup.status === 200 && ordersOf(otherIpLookup.json).length === 1, '其他 IP 不該被這張單的鎖定波及');
    const sameIpLookup = await call('GET', `/api/lookup?number=${lockedNumber}&phoneLast4=0334`, undefined, {
      'X-Forwarded-For': '127.0.0.1',
    });
    assert(sameIpLookup.status === 429, '原來源仍應被這張單鎖定');
    const otherOrder = await call('GET', `/api/lookup?number=${encodeURIComponent('維修單-20261028-001')}&phoneLast4=4567`, undefined, {
      'X-Forwarded-For': '127.0.0.1',
    });
    assert(otherOrder.status === 200 && ordersOf(otherOrder.json).length === 1, '其他單號不該被這次鎖定波及');
    process.env.REPAIR_LOOKUP_LOCKOUT_LIMIT = '2';
    lookupLockout.reset();
    const samePrefix = ['2001:db8:1:2::1', '2001:db8:1:2::2'];
    for (const address of samePrefix) {
      const response = await call('GET', `/api/lookup?number=${encodeURIComponent('維修單-20261025-001')}&phoneLast4=0000`, undefined, {
        'X-Forwarded-For': address,
      });
      assert(response.status === 200, '同一 IPv6 /64 的失敗在鎖定前應只是查無資料');
    }
    const prefixLocked = await call('GET', `/api/lookup?number=${encodeURIComponent('維修單-20261025-001')}&phoneLast4=0334`, undefined, {
      'X-Forwarded-For': '2001:db8:1:2::9',
    });
    assert(prefixLocked.status === 429, '同一個 IPv6 /64 應共用單號鎖定');
    const otherPrefix = await call('GET', `/api/lookup?number=${encodeURIComponent('維修單-20261025-001')}&phoneLast4=0334`, undefined, {
      'X-Forwarded-For': '2001:db8:1:3::1',
    });
    assert(otherPrefix.status === 200 && ordersOf(otherPrefix.json).length === 1, '不同 IPv6 /64 不該被這張單鎖定');
    delete process.env.REPAIR_TRUSTED_PROXIES;
    lookupLockout.reset();
    const orderAgain = await call('GET', `/api/lookup?number=${lockedNumber}&phoneLast4=0334`);
    assert(orderAgain.status === 200 && ordersOf(orderAgain.json).length === 1, '解除鎖定後，正確的電話應查得到');

    process.env.REPAIR_LOGIN_LIMIT = '100';
    process.env.REPAIR_LOGIN_LOCKOUT_LIMIT = '3';
    process.env.REPAIR_LOGIN_ACCOUNT_LOCKOUT_LIMIT = '100';
    loginLimiter.reset();
    loginLockout.reset();
    loginAccountLockout.reset();
    const firstWrong = await call('POST', '/api/login', { username: 'staff', password: 'wrong-password' });
    assert(firstWrong.status === 401, '錯誤密碼應被拒絕');
    assert((firstWrong.json as { remainingAttempts?: number }).remainingAttempts === 2, '第一次失敗後應剩 2 次');
    assert(JSON.stringify(firstWrong.json).includes('再錯 2 次會鎖定 15 分鐘'), '剩兩次應提示鎖定 15 分鐘');
    const secondWrong = await call('POST', '/api/login', { username: 'staff', password: 'wrong-password' });
    assert(secondWrong.status === 401, '第二次錯誤密碼應被拒絕');
    assert((secondWrong.json as { remainingAttempts?: number }).remainingAttempts === 1, '第二次失敗後應剩 1 次');
    assert(JSON.stringify(secondWrong.json).includes('再錯 1 次會鎖定 15 分鐘'), '剩一次應提示鎖定 15 分鐘');
    const thirdWrong = await call('POST', '/api/login', { username: 'staff', password: 'wrong-password' });
    assert(thirdWrong.status === 401, '達到鎖定的那一次仍回密碼錯誤');
    assert(!JSON.stringify(thirdWrong.json).includes('再錯'), '已經鎖定時不再提示剩餘次數');
    const accountLocked = await call('POST', '/api/login', { username: 'staff', password: staffPassword });
    assert(accountLocked.status === 429, '帳號失敗太多次後，正確密碼也應被鎖定');
    const loginRetry = Number((accountLocked.json as { retryAfterSeconds?: number }).retryAfterSeconds);
    assert(loginRetry >= 1, '登入鎖定應回傳剩餘秒數');
    assert(accountLocked.headers['retry-after'] === String(loginRetry), '登入鎖定應送出 Retry-After');
    assert(JSON.stringify(accountLocked.json).includes('請聯絡系統管理員'), '登入鎖定應請對方聯絡系統管理員');
    assert(
      JSON.stringify(accountLocked.json) === JSON.stringify({ error: loginLockoutMessage(loginRetry), retryAfterSeconds: loginRetry }),
      '登入鎖定文案應包含大約等待時間',
    );
    const otherAccount = await call('POST', '/api/login', { username: 'nobody', password: 'wrong-password' });
    assert(otherAccount.status === 401, '其他帳號不該被這次鎖定波及');
    loginLockout.reset();

    process.env.REPAIR_TRUSTED_PROXIES = '127.0.0.1';
    process.env.REPAIR_LOGIN_LOCKOUT_LIMIT = '5';
    process.env.REPAIR_LOGIN_LIMIT = '100';
    process.env.REPAIR_RATE_LIMIT = '1000';
    loginLockout.reset();
    loginLimiter.reset();
    generalLimiter.reset();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await call('POST', '/api/login', { username: 'admin', password: 'wrong-password' }, {
        'X-Forwarded-For': `198.51.100.${attempt}`,
      });
      assert(response.status === 401, `分散來源的單次失敗不應鎖定管理員，實際 ${response.status}`);
    }
    const legitLogin = await call('POST', '/api/login', { username: 'admin', password: 'replacement-pass-1' }, {
      'X-Forwarded-For': '198.51.100.20',
    });
    assert(legitLogin.status === 200, '其他 IP 的失敗不應阻止正確密碼登入');
    process.env.REPAIR_LOGIN_LOCKOUT_LIMIT = '2';
    loginLockout.reset();
    for (const address of ['2001:db8:9:9::1', '2001:db8:9:9::2']) {
      const response = await call('POST', '/api/login', { username: 'admin', password: 'wrong-password' }, {
        'X-Forwarded-For': address,
      });
      assert(response.status === 401, '同一 IPv6 /64 在鎖定前應只是密碼錯誤');
    }
    const prefixLogin = await call('POST', '/api/login', { username: 'admin', password: 'replacement-pass-1' }, {
      'X-Forwarded-For': '2001:db8:9:9::8',
    });
    assert(prefixLogin.status === 429, '同一個 IPv6 /64 應共用帳號鎖定');
    const otherPrefixLogin = await call('POST', '/api/login', { username: 'admin', password: 'replacement-pass-1' }, {
      'X-Forwarded-For': '2001:db8:9:a::1',
    });
    assert(otherPrefixLogin.status === 200, '不同 IPv6 /64 不該被這個帳號鎖定');
    delete process.env.REPAIR_TRUSTED_PROXIES;
    loginLockout.reset();
    loginAccountLockout.reset();

    process.env.REPAIR_LOGIN_LIMIT = '2';
    process.env.REPAIR_LOGIN_LOCKOUT_LIMIT = '100';
    process.env.REPAIR_LOGIN_ACCOUNT_LOCKOUT_LIMIT = '100';
    loginLimiter.reset();
    loginLockout.reset();
    loginAccountLockout.reset();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await call('POST', '/api/login', { username: 'admin', password: 'replacement-pass-1' });
      assert(response.status === 200, `成功登入不應計入 IP 失敗次數，實際 ${response.status}`);
    }
    const ipFailOne = await call('POST', '/api/login', { username: 'nobody', password: 'wrong-password' });
    const ipFailTwo = await call('POST', '/api/login', { username: 'nobody', password: 'wrong-password' });
    assert(ipFailOne.status === 401 && ipFailTwo.status === 401, '兩次失敗仍應是密碼錯誤');
    const ipLimited = await call('POST', '/api/login', { username: 'nobody', password: 'wrong-password' });
    assert(ipLimited.status === 429, '同一 IP 的失敗次數達到上限後應拒絕');
    assert(Number((ipLimited.json as { retryAfterSeconds?: number }).retryAfterSeconds) >= 1, 'IP 登入限制應回傳 retryAfterSeconds');

    process.env.REPAIR_LOGIN_LIMIT = '100';
    process.env.REPAIR_LOGIN_LOCKOUT_LIMIT = '100';
    process.env.REPAIR_LOGIN_ACCOUNT_LOCKOUT_LIMIT = '3';
    process.env.REPAIR_TRUSTED_PROXIES = '127.0.0.1';
    loginLimiter.reset();
    loginLockout.reset();
    loginAccountLockout.reset();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await call('POST', '/api/login', { username: 'admin', password: 'wrong-password' }, {
        'X-Forwarded-For': `203.0.113.${attempt}`,
      });
      assert(response.status === 401, '全域帳號計數在鎖定前應是密碼錯誤');
    }
    const globalLocked = await call('POST', '/api/login', { username: 'admin', password: 'replacement-pass-1' }, {
      'X-Forwarded-For': '203.0.113.40',
    });
    assert(globalLocked.status === 429, '不同 IP 的失敗累積後應鎖定整個帳號');
    delete process.env.REPAIR_TRUSTED_PROXIES;
    loginLockout.reset();
    loginAccountLockout.reset();
    loginLimiter.reset();

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
    delete process.env.REPAIR_LOGIN_ACCOUNT_LOCKOUT_LIMIT;
    delete process.env.REPAIR_STORE_PHONE;
    lookupLimiter.reset();
    generalLimiter.reset();
    loginLimiter.reset();
    lookupLockout.reset();
    loginLockout.reset();
    loginAccountLockout.reset();
    await server.close();
    for (const suffix of ['', '-wal', '-shm', '.admin-password']) fs.rmSync(`${httpFile}${suffix}`, { force: true });
  }
}

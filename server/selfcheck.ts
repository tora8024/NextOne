import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { taipeiCalendar } from '../src/lib/orderNumber.ts';
import { createOrder, explainPlan, openDatabase, resetSeed, searchOrders, searchPublic, type SearchFilters } from './db.ts';

const filename = path.join(os.tmpdir(), `repair-selfcheck-${process.pid}.sqlite`);
fs.rmSync(filename, { force: true });
fs.rmSync(`${filename}-wal`, { force: true });
fs.rmSync(`${filename}-shm`, { force: true });
const db = openDatabase(filename);
resetSeed(db);

function assert(condition: unknown, message: string) {
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
  duplicate = error instanceof Error && error.message.includes('已經有客戶');
}
assert(duplicate, '重複公號應被拒絕');

const publicBody = JSON.stringify(searchPublic(db, { number: '100002' }));
for (const secret of ['diskutil', 'rsync', 'smartctl', 'nvlddmkm', 'memtest', '未備份的剪輯專案']) {
  assert(!publicBody.toLowerCase().includes(secret.toLowerCase()), `客戶查詢不該出現：${secret}`);
}
const staffBody = JSON.stringify(searchOrders(db, { number: '100002' }));
assert(staffBody.includes('diskutil'), '店內查詢應保留內部指令');
const invoice = JSON.stringify(searchPublic(db, { number: '100005' }));
assert(!invoice.includes('佩琪會計師事務所'), '客戶查詢不該回傳內部備註');

let missingIdentity = false;
try {
  searchPublic(db, { from: '2026-10-01', to: '2026-10-31' });
} catch (error) {
  missingIdentity = error instanceof Error && error.message.includes('公號');
}
assert(missingIdentity, '客戶查詢不能只靠日期');

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

db.close();
fs.rmSync(filename, { force: true });
fs.rmSync(`${filename}-wal`, { force: true });
fs.rmSync(`${filename}-shm`, { force: true });
console.log('api selfcheck ok');

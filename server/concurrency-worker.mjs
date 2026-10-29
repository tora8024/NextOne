import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(workerData.dbPath);
db.exec('PRAGMA busy_timeout = 8000');
db.exec('PRAGMA foreign_keys = ON');
db.exec('BEGIN IMMEDIATE');
try {
  const row = db
    .prepare(
      `INSERT INTO daily_serials (order_date, last_serial) VALUES (?, 1)
       ON CONFLICT(order_date) DO UPDATE SET last_serial = last_serial + 1
       RETURNING last_serial`,
    )
    .get(workerData.orderDate);
  const serial = Number(row.last_serial);
  const padded = serial < 1000 ? String(serial).padStart(3, '0') : String(serial);
  const orderNumber = `WO-${workerData.orderDate}-${padded}`;
  const createdOn = `${workerData.orderDate.slice(0, 4)}-${workerData.orderDate.slice(4, 6)}-${workerData.orderDate.slice(6, 8)}`;
  const stamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO work_orders (
      id, order_date, serial, order_number, customer_id, device_id, repair_kind, repair_target,
      requirements, status, created_on, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 'cus-chen', 'dev-zenbook', 'hardware', '並行測試', '', 'received', ?, ?, ?, NULL)`,
  ).run(`race-${serial}-${Math.random().toString(16).slice(2)}`, workerData.orderDate, serial, orderNumber, createdOn, stamp, stamp);
  db.exec('COMMIT');
  parentPort.postMessage({ serial, orderNumber });
} catch (error) {
  try {
    db.exec('ROLLBACK');
  } catch {
    // The original error is the one that matters.
  }
  throw error;
} finally {
  db.close();
}

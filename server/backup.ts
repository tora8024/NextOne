import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

function assertInsideBackupDir(target: string) {
  const configured = process.env.REPAIR_BACKUP_DIR?.trim();
  if (!configured) return;
  if (!path.isAbsolute(configured)) throw new Error('REPAIR_BACKUP_DIR 必須是絕對路徑');
  const root = path.resolve(configured);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('備份必須放在指定的備份目錄');
  }
}

export function backupDatabase(db: DatabaseSync, target: string) {
  if (!path.isAbsolute(target)) throw new Error('備份路徑必須是絕對路徑');
  if (target.includes('\0') || target.includes("'")) throw new Error('備份路徑不正確');
  assertInsideBackupDir(target);
  if (fs.existsSync(target)) throw new Error('備份檔已存在，請換一個路徑');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  db.exec(`VACUUM INTO '${target}'`);
  fs.chmodSync(target, 0o600);
}

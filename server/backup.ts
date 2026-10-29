import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export function backupDatabase(db: DatabaseSync, target: string) {
  if (!path.isAbsolute(target)) throw new Error('備份路徑必須是絕對路徑');
  if (target.includes('\0') || target.includes("'")) throw new Error('備份路徑不正確');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.rmSync(target, { force: true });
  db.exec(`VACUUM INTO '${target}'`);
  fs.chmodSync(target, 0o600);
}

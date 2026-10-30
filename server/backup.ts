import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return undefined;
}

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function backupRoot(): string {
  const configured = process.env.REPAIR_BACKUP_DIR?.trim();
  if (!configured) throw new Error('請設定 REPAIR_BACKUP_DIR');
  if (!path.isAbsolute(configured)) throw new Error('REPAIR_BACKUP_DIR 必須是絕對路徑');
  fs.mkdirSync(configured, { recursive: true, mode: 0o700 });
  return fs.realpathSync(configured);
}

function parentInsideRoot(parent: string, root: string): string {
  const missing: string[] = [];
  let current = path.resolve(parent);
  while (!fs.existsSync(current)) {
    const base = path.basename(current);
    if (base === '.' || base === '..') throw new Error('備份路徑不正確');
    missing.push(base);
    const next = path.dirname(current);
    if (next === current) throw new Error('備份路徑不正確');
    current = next;
  }
  const real = fs.realpathSync(current);
  if (!insideRoot(root, real)) throw new Error('備份必須放在指定的備份目錄');
  let built = real;
  for (const part of missing.reverse()) {
    built = path.join(built, part);
    try {
      fs.mkdirSync(built, 0o700);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    if (fs.lstatSync(built).isSymbolicLink()) throw new Error('備份路徑不能是符號連結');
    const created = fs.realpathSync(built);
    if (!insideRoot(root, created)) throw new Error('備份必須放在指定的備份目錄');
    built = created;
  }
  return built;
}

export function backupDatabase(db: DatabaseSync, target: string) {
  if (!path.isAbsolute(target)) throw new Error('備份路徑必須是絕對路徑');
  if (target.includes('\0') || target.includes("'")) throw new Error('備份路徑不正確');
  const root = backupRoot();
  const base = path.basename(target);
  if (!base || base === '.' || base === '..') throw new Error('備份路徑不正確');
  const parent = parentInsideRoot(path.dirname(target), root);
  const finalPath = path.join(parent, base);
  if (!insideRoot(root, finalPath) || finalPath.includes("'")) throw new Error('備份必須放在指定的備份目錄');
  refuseIfPresent(finalPath);
  const tempPath = path.join(parent, `.${randomBytes(16).toString('hex')}.tmp`);
  if (!insideRoot(root, tempPath) || tempPath.includes("'")) throw new Error('備份必須放在指定的備份目錄');
  try {
    db.exec(`VACUUM INTO '${tempPath}'`);
    fs.chmodSync(tempPath, 0o600);
    verifyBackupFile(tempPath);
    try {
      fs.linkSync(tempPath, finalPath);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      refuseIfPresent(finalPath);
      throw new Error('備份檔已存在，請換一個路徑');
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function refuseIfPresent(finalPath: string) {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(finalPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error('備份路徑不能是符號連結');
  throw new Error('備份檔已存在，請換一個路徑');
}

export function verifyBackupFile(filename: string) {
  let check: DatabaseSync;
  try {
    check = new DatabaseSync(filename, { readOnly: true });
  } catch {
    throw new Error('備份檔完整性檢查失敗');
  }
  try {
    const row = check.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (!row || row.integrity_check !== 'ok') throw new Error('備份檔完整性檢查失敗');
  } catch (error) {
    if (error instanceof Error && error.message === '備份檔完整性檢查失敗') throw error;
    throw new Error('備份檔完整性檢查失敗');
  } finally {
    check.close();
  }
}

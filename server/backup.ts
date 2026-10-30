import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

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
  let fd: number;
  try {
    fd = fs.openSync(
      finalPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW | fs.constants.O_WRONLY,
      0o600,
    );
  } catch (error) {
    if (errorCode(error) === 'EEXIST' || errorCode(error) === 'ELOOP') {
      try {
        if (fs.lstatSync(finalPath).isSymbolicLink()) throw new Error('備份路徑不能是符號連結');
      } catch (statError) {
        if (statError instanceof Error && statError.message.includes('符號連結')) throw statError;
      }
    }
    if (errorCode(error) === 'EEXIST') throw new Error('備份檔已存在，請換一個路徑');
    if (errorCode(error) === 'ELOOP') throw new Error('備份路徑不能是符號連結');
    throw error;
  }
  fs.closeSync(fd);
  fs.unlinkSync(finalPath);
  db.exec(`VACUUM INTO '${finalPath}'`);
  fs.chmodSync(finalPath, 0o600);
}

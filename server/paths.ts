import path from 'node:path';

export function databasePath(): string {
  const fromEnv = process.env.REPAIR_DB_PATH?.trim();
  if (fromEnv) {
    if (!path.isAbsolute(fromEnv)) throw new Error('REPAIR_DB_PATH 必須是絕對路徑');
    return fromEnv;
  }
  return path.resolve(process.cwd(), 'data', 'repair.sqlite');
}

import path from 'node:path';

export function databasePath(): string {
  return path.join(process.cwd(), 'data', 'repair.sqlite');
}

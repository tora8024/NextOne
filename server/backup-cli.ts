import { backupDatabase } from './backup.ts';
import { openDatabase } from './db.ts';
import { databasePath } from './paths.ts';

const target = process.argv[2] ?? process.env.REPAIR_BACKUP_PATH ?? '';
if (!target) {
  console.error('請提供備份檔的絕對路徑，例如 npm run backup -- /absolute/path/repair-backup.sqlite');
  process.exit(1);
}

const db = openDatabase(databasePath());
try {
  backupDatabase(db, target);
  console.log(`已備份到 ${target}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : '備份失敗');
  process.exitCode = 1;
} finally {
  db.close();
}

import { openDatabase, resetSeed } from './db.ts';
import { databasePath } from './paths.ts';

const filename = databasePath();
const db = openDatabase(filename);
resetSeed(db);
db.close();
console.log(`已寫入示範資料：${filename}`);

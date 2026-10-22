import { readFile } from 'node:fs/promises';
import type { Database } from './index.js';
export async function migrate(db: Database) {
 await db.transaction(async tx => {
  await tx.query('SELECT pg_advisory_xact_lock(31611)');
  await tx.query('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  for(const name of ['001_initial','002_protocol']) {
   if((await tx.query('SELECT name FROM migrations WHERE name=$1',[name])).rows.length) continue;
   await tx.query(await readFile(new URL(`./${name}.sql`,import.meta.url),'utf8'));
   await tx.query('INSERT INTO migrations(name) VALUES ($1)',[name]);
  }
 });
}

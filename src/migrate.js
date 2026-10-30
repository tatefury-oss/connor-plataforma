import { readdir, readFile } from 'node:fs/promises';
import { pool } from './db.js';

const dir = new URL('../migrations/', import.meta.url);

export async function migrate({ log = console.log } = {}) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, dir), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`migración aplicada: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => pool.end(), (err) => { console.error(err); process.exit(1); });
}

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadConfig } from '../config/env.js';
import { createDatabasePool } from './pool.js';

const migrationDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
const migrationLockName = 'load-balanced-backend-schema-migrations';

export async function runMigrations(
  pool: Pool,
  directory = migrationDirectory,
): Promise<string[]> {
  const files = (await readdir(directory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  const appliedNow: string[] = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [migrationLockName]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows: applied } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    );
    const appliedByName = new Map(applied.map((migration) => [migration.name, migration.checksum]));

    for (const file of files) {
      const sql = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previousChecksum = appliedByName.get(file);
      if (previousChecksum !== undefined) {
        if (previousChecksum !== checksum) {
          throw new Error(`Applied migration checksum mismatch: ${file}`);
        }
        continue;
      }

      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
      appliedNow.push(file);
    }

    await client.query('COMMIT');
    return appliedNow;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const pool = createDatabasePool(loadConfig().database);
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length === 0 ? 'Database schema is up to date' : `Applied ${applied.length} migration(s)`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    console.error('Database migrations failed');
    process.exitCode = 1;
  });
}

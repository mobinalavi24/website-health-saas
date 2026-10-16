import fs from 'node:fs';
import path from 'node:path';
import { query, withTransaction } from './connection.ts';

export function cleanSqlStatements(sql: string): string[] {
  // Strip block comments and single-line SQL comments
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let initInFlight: Promise<void> | null = null;

export async function initSchema(): Promise<void> {
  if (initInFlight) {
    return initInFlight;
  }

  initInFlight = (async () => {
    const schemaPath = path.resolve(process.cwd(), 'server/db/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const statements = cleanSqlStatements(sql);

    for (const statement of statements) {
      try {
        await query(statement);
      } catch (err: any) {
        // Ignore benign PostgreSQL concurrent IF NOT EXISTS catalog race (23505 pg_class_relname_nsp_index / 42P07 duplicate_table)
        if (err?.code === '23505' || err?.code === '42P07') {
          continue;
        }
        console.error(`[PostgreSQL Init Error]: Failed executing statement:\n${statement.substring(0, 100)}...\nError:`, err.message);
        throw err;
      }
    }
  })();

  try {
    await initInFlight;
  } finally {
    initInFlight = null;
  }
}

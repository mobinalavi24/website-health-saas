import pg from 'pg';

const { Pool } = pg;

export interface DbConfig {
  connectionString?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  maxConnections?: number;
  connectionTimeoutMillis?: number;
}

let activePool: pg.Pool | null = null;
let isDevInMemory = false;
let activeMemDb: any = null;

export function getDbConfig(): DbConfig {
  const connectionString = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!connectionString) {
    if (isProduction) {
      throw new Error(
        'DATABASE_URL environment variable is required in production mode. ' +
        'Please configure DATABASE_URL in your environment.'
      );
    }
  }

  let ssl: boolean | { rejectUnauthorized: boolean } = false;
  if (process.env.DATABASE_SSL === 'true' || connectionString?.includes('sslmode=require')) {
    ssl = { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' };
  }

  return {
    connectionString,
    ssl,
    maxConnections: parseInt(process.env.DATABASE_MAX_POOL || '20', 10),
    connectionTimeoutMillis: parseInt(process.env.DATABASE_TIMEOUT_MS || '10000', 10),
  };
}

export async function getPool(): Promise<pg.Pool> {
  if (activePool) return activePool;

  const config = getDbConfig();

  if (config.connectionString) {
    activePool = new Pool({
      connectionString: config.connectionString,
      ssl: config.ssl ? config.ssl : undefined,
      max: config.maxConnections || 20,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 10000,
      idleTimeoutMillis: 30000,
    });

    activePool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]: Unexpected idle client error:', err.message);
    });

    isDevInMemory = false;
    return activePool;
  }

  // Development / Testing fallback using in-memory PostgreSQL engine
  // This satisfies Rule 17: Explicitly development/test only, strictly disallowed in production
  console.log('[PostgreSQL]: DATABASE_URL not set in non-production. Initializing development/test PostgreSQL instance...');
  
  const { newDb } = await import('pg-mem');
  const memDb = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: true,
  });

  // Register common PostgreSQL functions
  memDb.public.registerFunction({
    name: 'version',
    args: [],
    returns: memDb.public.getType('text' as any) || undefined,
    implementation: () => 'PostgreSQL 16.0 (PulseVanguard Dev/Test In-Memory Engine)',
  });

  const adapter = memDb.adapters.createPg();
  activePool = new adapter.Pool() as unknown as pg.Pool;
  activeMemDb = memDb;
  isDevInMemory = true;

  return activePool;
}

export function isUsingDevInMemory(): boolean {
  return isDevInMemory;
}

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: any[] = []): Promise<pg.QueryResult<T>> {
  const pool = await getPool();
  return pool.query<T>(sql, params);
}

export async function withTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const client = await pool.connect();
  const devBackup = isDevInMemory && activeMemDb ? activeMemDb.backup() : null;

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    if (devBackup) {
      devBackup.restore();
    }
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[PostgreSQL Rollback Error]:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

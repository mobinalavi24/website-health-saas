import { query } from './db/connection.ts';

/**
 * Additive, idempotent schema changes for the security hardening work.
 * Nothing here drops or rewrites existing data. Safe to run on every boot.
 *
 * Rollback: all changes are additive columns/tables. Old application versions ignore them, so
 * rolling back the code does not require reverting the schema (see SECURITY.md).
 */
const STATEMENTS = [
  // --- sessions: idle/absolute expiry, revocation, CSRF token ---
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_reason TEXT',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS csrf_token TEXT',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_hash TEXT',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT',
  'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',

  // --- login attempt tracking & lockouts (persistent, concurrency-safe) ---
  `CREATE TABLE IF NOT EXISTS login_attempts (
     id TEXT PRIMARY KEY,
     account_key TEXT NOT NULL,
     ip_hash TEXT,
     outcome TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_login_attempts_account ON login_attempts(account_key, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_hash, created_at)',
  `CREATE TABLE IF NOT EXISTS account_lockouts (
     account_key TEXT PRIMARY KEY,
     user_id TEXT,
     locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     expires_at TIMESTAMPTZ NOT NULL,
     reason TEXT NOT NULL DEFAULT 'too_many_failed_logins',
     unlocked_at TIMESTAMPTZ,
     unlocked_by TEXT,
     unlock_method TEXT
   )`,

  // --- password recovery (single-use, hashed, expiring tokens) ---
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     token_hash TEXT UNIQUE NOT NULL,
     expires_at TIMESTAMPTZ NOT NULL,
     used_at TIMESTAMPTZ,
     ip_hash TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at)',

  // --- structured security audit trail (separate from business audit_logs) ---
  `CREATE TABLE IF NOT EXISTS security_events (
     id TEXT PRIMARY KEY,
     ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     event_type TEXT NOT NULL,
     outcome TEXT NOT NULL,
     user_id TEXT,
     account_hint TEXT,
     actor_role TEXT,
     ip TEXT,
     user_agent TEXT,
     request_id TEXT,
     details TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS idx_security_events_ts ON security_events(ts)',
  'CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, ts)',
];

let ensured: Promise<void> | null = null;

export function ensureSecuritySchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      for (const st of STATEMENTS) {
        try {
          await query(st);
        } catch (err: any) {
          // Surface unexpected failures but never print SQL parameters/credentials.
          if (!/already exists/i.test(err?.message || '')) {
            console.warn('[SecuritySchema] statement skipped:', String(err?.message || err).slice(0, 160));
          }
        }
      }
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

/** Test helper: forces the next ensureSecuritySchema() call to re-run. */
export function resetSecuritySchemaCache(): void {
  ensured = null;
}

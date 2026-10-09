import crypto from 'node:crypto';
import { query } from './connection.ts';
import type { User, Organization } from '../db.ts';

export interface PersistentSession {
  userId: string;
  orgId: string;
  expiresAt: number;
  user: User;
  org: Organization;
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  token: string,
  userId: string,
  orgId: string,
  expiresAtMs: number
): Promise<void> {
  const tokenHash = hashSessionToken(token);
  const id = `sess_${crypto.randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(expiresAtMs).toISOString();

  await query(
    `INSERT INTO sessions (id, token_hash, user_id, org_id, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (token_hash) DO UPDATE SET
       expires_at = EXCLUDED.expires_at`,
    [id, tokenHash, userId, orgId, expiresAt]
  );
}

export async function findSessionByToken(token: string): Promise<PersistentSession | null> {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);

  const res = await query(
    `SELECT s.user_id, s.org_id, s.expires_at,
            u.id as u_id, u.email as u_email, u.name as u_name, u.password_hash as u_password_hash,
            u.role as u_role, u.org_id as u_org_id, u.avatar_url as u_avatar_url,
            u.email_verified as u_email_verified, u.created_at as u_created_at,
            o.id as o_id, o.name as o_name, o.plan_id as o_plan_id, o.billing_interval as o_billing_interval,
            o.currency as o_currency, o.owner_id as o_owner_id, o.trial_started_at as o_trial_started_at,
            o.trial_ends_at as o_trial_ends_at, o.trial_used as o_trial_used, o.white_label as o_white_label,
            o.clients as o_clients, o.created_at as o_created_at
     FROM sessions s
     INNER JOIN users u ON s.user_id = u.id
     INNER JOIN organizations o ON s.org_id = o.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];

  const user: User = {
    id: row.u_id,
    email: row.u_email,
    name: row.u_name,
    passwordHash: row.u_password_hash,
    role: row.u_role,
    orgId: row.u_org_id,
    avatarUrl: row.u_avatar_url || undefined,
    emailVerified: Boolean(row.u_email_verified),
    createdAt: new Date(row.u_created_at).toISOString(),
  };

  const org: Organization = {
    id: row.o_id,
    name: row.o_name,
    planId: row.o_plan_id,
    billingInterval: row.o_billing_interval,
    currency: row.o_currency,
    ownerId: row.o_owner_id,
    trialStartedAt: row.o_trial_started_at ? new Date(row.o_trial_started_at).toISOString() : undefined,
    trialEndsAt: row.o_trial_ends_at ? new Date(row.o_trial_ends_at).toISOString() : undefined,
    trialUsed: Boolean(row.o_trial_used),
    whiteLabel: typeof row.o_white_label === 'string' ? JSON.parse(row.o_white_label) : row.o_white_label || { enabled: false, brandName: '' },
    clients: typeof row.o_clients === 'string' ? JSON.parse(row.o_clients) : row.o_clients || [],
    createdAt: new Date(row.o_created_at).toISOString(),
  };

  return {
    userId: row.user_id,
    orgId: row.org_id,
    expiresAt: new Date(row.expires_at).getTime(),
    user,
    org,
  };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashSessionToken(token);
  await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

export async function cleanupExpiredSessions(): Promise<number> {
  const res = await query('DELETE FROM sessions WHERE expires_at <= NOW()');
  return res.rowCount || 0;
}

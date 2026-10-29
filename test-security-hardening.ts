import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRoute } from './server/api.ts';
import {
  db,
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  verifyPasswordAsync,
  needsPasswordRehash,
} from './server/db.ts';
import { runMigration } from './server/db/migrate.ts';
import { query } from './server/db/connection.ts';
import { SESSION_IDLE_MS, lookupSession } from './server/db/sessionRepo.ts';
import { isBlockedIp, parseSafeUrl, safeFetch, SsrfBlockedError } from './server/ssrf.ts';
import { resetRateLimits, validateProductionEnvironment } from './server/security.ts';

interface MockResponseResult {
  status: number;
  body: any;
  headers: Record<string, string | string[]>;
}

async function callApi(options: {
  method: string;
  url: string;
  token?: string;
  cookie?: string;
  csrfToken?: string;
  body?: any;
  ip?: string;
  headers?: Record<string, string>;
}): Promise<MockResponseResult> {
  const payload = options.body !== undefined ? JSON.stringify(options.body) : '';
  const stream = Readable.from(payload ? [Buffer.from(payload, 'utf-8')] : []);

  const reqHeaders: Record<string, string> = {
    host: 'localhost:3000',
    'user-agent': 'PulseVanguarde-SecurityTest/1.0',
    ...(options.headers || {}),
  };
  if (payload && !reqHeaders['content-type']) {
    reqHeaders['content-type'] = 'application/json';
    reqHeaders['content-length'] = String(Buffer.byteLength(payload));
  }
  if (options.token) {
    reqHeaders['authorization'] = `Bearer ${options.token}`;
  }
  if (options.cookie) {
    reqHeaders['cookie'] = options.cookie;
  }
  if (options.csrfToken) {
    reqHeaders['x-csrf-token'] = options.csrfToken;
  }

  const req = Object.assign(stream, {
    method: options.method,
    url: options.url,
    headers: reqHeaders,
    socket: { remoteAddress: options.ip || '203.0.113.10' },
  }) as unknown as IncomingMessage;

  let statusCode = 200;
  const resHeaders: Record<string, string | string[]> = {};
  const chunks: Buffer[] = [];

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(val: number) {
      statusCode = val;
    },
    headersSent: false,
    setHeader(name: string, value: string | string[]) {
      resHeaders[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return resHeaders[name.toLowerCase()];
    },
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          resHeaders[k.toLowerCase()] = v;
        }
      }
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      (this as any).headersSent = true;
    },
  } as unknown as ServerResponse;

  await handleApiRoute(req, res);

  const rawText = Buffer.concat(chunks).toString('utf-8');
  let parsedBody: any = rawText;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : {};
  } catch {}

  return {
    status: statusCode,
    body: parsedBody,
    headers: resHeaders,
  };
}

function extractCookiesFromHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Record<string, string> = {};
  for (const item of list) {
    const firstPair = item.split(';')[0] || '';
    const eqIdx = firstPair.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPair.slice(0, eqIdx).trim();
      const val = firstPair.slice(eqIdx + 1).trim();
      out[name] = val;
    }
  }
  return out;
}

async function runSecurityHardeningTests() {
  console.log('=== Starting PulseVanguarde Comprehensive Security & Authentication Audit Tests ===');
  process.env.SECURITY_EXPOSE_RESET_TOKEN_FOR_TESTS = 'true';

  await runMigration();
  await db.initFromPostgres();
  resetRateLimits();

  // ---------------------------------------------------------------------------
  // 1 & 2. Password Hashing (scrypt, unique random salts, legacy rehash support)
  // ---------------------------------------------------------------------------
  console.log('Test 1 & 2: Password hashing uses memory-hard scrypt with unique 16-byte random salts...');
  const samplePass = 'CorrectHorseBatteryStaple!2026';
  const hash1 = await hashPasswordAsync(samplePass);
  const hash2 = await hashPasswordAsync(samplePass);
  assert.ok(hash1.startsWith('scrypt$32768$8$1$'), `Expected scrypt hash prefix, got ${hash1}`);
  assert.ok(hash2.startsWith('scrypt$32768$8$1$'), `Expected scrypt hash prefix, got ${hash2}`);
  assert.notEqual(hash1, hash2, 'Same password hashed twice must produce distinct hashes due to random salts');
  assert.ok(!hash1.includes(samplePass), 'Hash must never contain plaintext password');
  assert.equal(await verifyPasswordAsync(samplePass, hash1), true);
  assert.equal(await verifyPasswordAsync(samplePass, hash2), true);
  assert.equal(await verifyPasswordAsync('WrongPassword!2026', hash1), false);
  assert.equal(needsPasswordRehash(hash1), false);

  // Register a user and verify stored hash in DB is scrypt
  const ts = Date.now();
  const userAEmail = `sec_user_a_${ts}@example.com`;
  const userAPass = 'SecPass_UserA_987!';
  const regA = await callApi({
    method: 'POST',
    url: '/api/auth/register',
    ip: '198.51.100.11',
    body: {
      name: 'Security User A',
      email: userAEmail,
      password: userAPass,
      orgName: 'Sec Org A',
    },
  });
  assert.equal(regA.status, 201, `Expected 201 on registration, got ${regA.status}: ${JSON.stringify(regA.body)}`);
  const storedUserA = db.findUserByEmail(userAEmail);
  assert.ok(storedUserA, 'Registered user must exist in DB');
  assert.ok(
    storedUserA.passwordHash.startsWith('scrypt$'),
    `Stored user passwordHash must use scrypt, got ${storedUserA.passwordHash.slice(0, 15)}`
  );
  assert.notEqual(storedUserA.passwordHash, userAPass);
  assert.equal((regA.body.user as any).passwordHash, undefined, 'Registration response must never expose passwordHash');

  // ---------------------------------------------------------------------------
  // 3. Valid login creates server-backed session + HttpOnly cookie + CSRF token
  // ---------------------------------------------------------------------------
  console.log('Test 3: Valid login creates a PostgreSQL-backed session with HttpOnly cookie & CSRF token...');
  const loginA = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.11',
    body: { email: userAEmail, password: userAPass },
  });
  assert.equal(loginA.status, 200);
  assert.ok(loginA.body.token?.startsWith('pv_sess_'), 'Programmatic login returns session token');
  const setCookieHeader = loginA.headers['set-cookie'];
  const setCookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join(' | ') : String(setCookieHeader || '');
  assert.ok(setCookieStr.includes('pv_session='), 'Set-Cookie must include pv_session');
  assert.ok(setCookieStr.includes('HttpOnly'), 'pv_session cookie must be HttpOnly');
  assert.ok(setCookieStr.includes('SameSite=Lax'), 'pv_session cookie must set SameSite=Lax');
  assert.ok(setCookieStr.includes('pv_csrf='), 'Set-Cookie must include pv_csrf companion cookie');

  // Verify web client mode (`X-PV-Client: web`) omits raw token from response body
  const webLoginA = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.12',
    headers: { 'x-pv-client': 'web' },
    body: { email: userAEmail, password: userAPass },
  });
  assert.equal(webLoginA.status, 200);
  assert.equal(webLoginA.body.token, undefined, 'Web client login must not expose raw session token in JSON body');
  const webCookies = extractCookiesFromHeaders(webLoginA.headers);
  assert.ok(webCookies.pv_session, 'Web login must set pv_session cookie');
  assert.ok(webCookies.pv_csrf, 'Web login must set pv_csrf cookie');

  // ---------------------------------------------------------------------------
  // 4, 5, 6, 7. Login Attempt Tracking & 6th Failed Attempt Lockout
  // ---------------------------------------------------------------------------
  console.log('Test 4, 5, 6, 7: Login attempt tracking (5 failures do not lock; 6th failure locks; success before 6th works)...');
  const lockTestEmail1 = `lock_before6_${ts}@example.com`;
  const lockTestPass = 'ValidLockTestPass!123';
  await callApi({
    method: 'POST',
    url: '/api/auth/register',
    ip: '198.51.100.20',
    body: { name: 'Lock Test 1', email: lockTestEmail1, password: lockTestPass },
  });

  // 4 failed attempts followed by a valid login on the 5th attempt -> MUST SUCCEED (Test 7)
  for (let i = 1; i <= 4; i++) {
    const failRes = await callApi({
      method: 'POST',
      url: '/api/auth/login',
      ip: `198.51.100.${20 + i}`,
      body: { email: lockTestEmail1, password: `WrongPass_${i}` },
    });
    assert.equal(failRes.status, 401);
  }
  const fifthValidRes = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.29',
    body: { email: lockTestEmail1, password: lockTestPass },
  });
  assert.equal(fifthValidRes.status, 200, 'Successful login before the 6th failure must not be locked');

  // Now test exact 5 failures vs 6th failure on a fresh account (Tests 4, 5, 6)
  const lockTestEmail2 = `lock_sixth_${ts}@example.com`;
  await callApi({
    method: 'POST',
    url: '/api/auth/register',
    ip: '198.51.100.30',
    body: { name: 'Lock Test 2', email: lockTestEmail2, password: lockTestPass },
  });

  // First 5 failures do NOT lock the account
  for (let i = 1; i <= 5; i++) {
    const res = await callApi({
      method: 'POST',
      url: '/api/auth/login',
      ip: `198.51.100.${30 + i}`,
      body: { email: lockTestEmail2, password: `WrongAttempt_${i}` },
    });
    assert.equal(res.status, 401, `Attempt ${i} should fail with 401`);
  }
  const lockRowsAfter5 = await query(
    `SELECT * FROM account_lockouts WHERE user_id = $1 AND unlocked_at IS NULL`,
    [db.findUserByEmail(lockTestEmail2)!.id]
  );
  assert.equal(lockRowsAfter5.rows.length, 0, '5 failed login attempts must NOT lock the account prematurely');

  // The 6th failed attempt within 24 hours locks the account
  const sixthFail = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.37',
    body: { email: lockTestEmail2, password: 'WrongAttempt_6' },
  });
  assert.equal(sixthFail.status, 401);

  const lockRowsAfter6 = await query(
    `SELECT * FROM account_lockouts WHERE user_id = $1 AND unlocked_at IS NULL`,
    [db.findUserByEmail(lockTestEmail2)!.id]
  );
  assert.equal(lockRowsAfter6.rows.length, 1, 'The 6th failed login attempt within 24h MUST lock the account');

  // Locked account cannot log in even with the CORRECT password (Test 6)
  const lockedCorrectPass = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.38',
    body: { email: lockTestEmail2, password: lockTestPass },
  });
  assert.equal(lockedCorrectPass.status, 401, 'Locked account must reject login even with the valid password');
  assert.equal(lockedCorrectPass.body.token, undefined);

  // ---------------------------------------------------------------------------
  // 8. Concurrent Failed Login Attempts Cannot Bypass the 6-Attempt Threshold
  // ---------------------------------------------------------------------------
  console.log('Test 8: Concurrent failed login burst cannot bypass the 6-attempt lockout threshold...');
  resetRateLimits();
  const raceEmail = `lock_race_${ts}@example.com`;
  await callApi({
    method: 'POST',
    url: '/api/auth/register',
    ip: '198.51.100.50',
    body: { name: 'Race User', email: raceEmail, password: lockTestPass },
  });

  // Fire 8 concurrent wrong password attempts followed immediately by a valid password attempt
  await Promise.all(
    Array.from({ length: 8 }, (_, idx) =>
      callApi({
        method: 'POST',
        url: '/api/auth/login',
        ip: `198.51.100.${60 + idx}`,
        body: { email: raceEmail, password: `ConcurrentWrong_${idx}` },
      })
    )
  );
  const postRaceValid = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.75',
    body: { email: raceEmail, password: lockTestPass },
  });
  assert.equal(postRaceValid.status, 401, 'Account must be locked after concurrent failed login burst');

  // ---------------------------------------------------------------------------
  // 9. Account Unlock & Verified Password Reset Flow
  // ---------------------------------------------------------------------------
  console.log('Test 9: Verified password recovery and Super Admin unlock flows...');
  resetRateLimits();
  // 9a. Unlock lockTestEmail2 via password reset flow
  const resetReq = await callApi({
    method: 'POST',
    url: '/api/auth/reset-password',
    ip: '198.51.100.80',
    body: { email: lockTestEmail2 },
  });
  assert.equal(resetReq.status, 200);
  const resetToken = resetReq.body.resetToken;
  assert.ok(resetToken && resetToken.length > 20, 'Reset token generated in test mode');

  // Forged reset token must fail
  const badConfirm = await callApi({
    method: 'POST',
    url: '/api/auth/reset-password/confirm',
    ip: '198.51.100.80',
    body: { token: 'forged_token_value_12345678901234567890', newPassword: 'NewUnlockedPassword!2026' },
  });
  assert.equal(badConfirm.status, 400);

  // Valid reset token updates password, unlocks account, and is single-use
  const newPass2 = 'NewUnlockedPassword!2026';
  const goodConfirm = await callApi({
    method: 'POST',
    url: '/api/auth/reset-password/confirm',
    ip: '198.51.100.80',
    body: { token: resetToken, newPassword: newPass2 },
  });
  assert.equal(goodConfirm.status, 200);

  // Reusing the same reset token must fail
  const replayConfirm = await callApi({
    method: 'POST',
    url: '/api/auth/reset-password/confirm',
    ip: '198.51.100.80',
    body: { token: resetToken, newPassword: 'AnotherPassword!2026' },
  });
  assert.equal(replayConfirm.status, 400, 'Reset token must be single-use');

  // Unlocked user can now sign in with the new password
  const relogin2 = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.81',
    body: { email: lockTestEmail2, password: newPass2 },
  });
  assert.equal(relogin2.status, 200, 'Unlocked user must be able to sign in with new password');

  // 9b. Super Admin unlocks raceEmail via /api/admin/users/:id/unlock
  const adminLogin = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.1',
    body: { email: 'mobinalavi7491@gmail.com', password: 'Mobin_Admin_2026!SecurePassword' },
  });
  // Ensure super_admin account exists or set known password for test
  let superAdminToken = adminLogin.body?.token;
  if (!superAdminToken) {
    const adminUser = db.findUserByEmail('mobinalavi7491@gmail.com');
    assert.ok(adminUser, 'Super admin mobinalavi7491@gmail.com must exist');
    const knownAdminHash = await hashPasswordAsync('Mobin_Admin_2026!SecurePassword');
    await db.setUserPasswordHash(adminUser.id, knownAdminHash);
    resetRateLimits();
    const retryAdmin = await callApi({
      method: 'POST',
      url: '/api/auth/login',
      ip: '198.51.100.2',
      body: { email: 'mobinalavi7491@gmail.com', password: 'Mobin_Admin_2026!SecurePassword' },
    });
    assert.equal(retryAdmin.status, 200);
    superAdminToken = retryAdmin.body.token;
  }

  // Regular user cannot call admin unlock endpoint
  const raceUser = db.findUserByEmail(raceEmail)!;
  const unauthUnlock = await callApi({
    method: 'POST',
    url: `/api/admin/users/${raceUser.id}/unlock`,
    token: loginA.body.token,
    body: {},
  });
  assert.equal(unauthUnlock.status, 403, 'Regular user cannot unlock accounts');

  // Super Admin unlocks raceUser
  const adminUnlockRes = await callApi({
    method: 'POST',
    url: `/api/admin/users/${raceUser.id}/unlock`,
    token: superAdminToken,
    body: { adminPassword: 'Mobin_Admin_2026!SecurePassword' },
  });
  assert.equal(adminUnlockRes.status, 200);

  const raceLoginAfterUnlock = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    ip: '198.51.100.76',
    body: { email: raceEmail, password: lockTestPass },
  });
  assert.equal(raceLoginAfterUnlock.status, 200, 'Admin-unlocked user can log in again');

  // ---------------------------------------------------------------------------
  // 10, 11, 12, 13, 14, 15, 16. Session Management & 6-Hour Inactivity Expiration
  // ---------------------------------------------------------------------------
  console.log('Test 10-16: Session 6-hour inactivity expiration, sliding activity, logout revocation, and invalid tokens...');
  assert.equal(SESSION_IDLE_MS, 6 * 60 * 60 * 1000, 'SESSION_IDLE_MS must be exactly 6 hours (21,600,000 ms)');

  const sessionToken = relogin2.body.token as string;
  const lookedUp1 = await lookupSession(sessionToken);
  assert.equal(lookedUp1.status, 'valid');
  const initialLastActivity = lookedUp1.session.lastActivityAt;
  const initialExpiresAt = lookedUp1.session.expiresAt;
  assert.ok(
    Math.abs(initialExpiresAt - initialLastActivity - SESSION_IDLE_MS) < 5000,
    'Initial session expiration must be 6 hours from last_activity_at'
  );

  // Test 10 & 11: Session active within 6h window works and slides last_activity_at + expires_at forward
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  await query(
    `UPDATE sessions SET last_activity_at = $1, expires_at = $2 WHERE token_hash = $3`,
    [twoHoursAgo, fourHoursFromNow, lookedUp1.session.tokenHash]
  );

  const activeMeRes = await callApi({
    method: 'GET',
    url: '/api/auth/me',
    token: sessionToken,
  });
  assert.equal(activeMeRes.status, 200, 'Session active within 6h window must remain valid');

  const lookedUpAfterTouch = await lookupSession(sessionToken);
  assert.equal(lookedUpAfterTouch.status, 'valid');
  assert.ok(
    lookedUpAfterTouch.session.lastActivityAt > new Date(twoHoursAgo).getTime(),
    'Authenticated activity must update last_activity_at'
  );
  assert.ok(
    lookedUpAfterTouch.session.expiresAt > new Date(fourHoursFromNow).getTime(),
    'Authenticated activity must extend expires_at to 6 hours from now'
  );

  // Test 12 & 13: Session inactive for > 6 hours (6h + 1 minute) is expired and rejected
  const sixHoursOneMinAgo = new Date(Date.now() - (6 * 60 * 60 * 1000 + 60_000)).toISOString();
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  await query(
    `UPDATE sessions SET last_activity_at = $1, expires_at = $2 WHERE token_hash = $3`,
    [sixHoursOneMinAgo, oneMinAgo, lookedUp1.session.tokenHash]
  );

  const expiredMeRes = await callApi({
    method: 'GET',
    url: '/api/auth/me',
    token: sessionToken,
  });
  assert.equal(expiredMeRes.status, 401, 'Session inactive for > 6 hours must be rejected with 401');

  // Test 14 & 15: Logout immediately invalidates the session; reusing logged-out token fails
  const tokenToLogout = raceLoginAfterUnlock.body.token as string;
  const preLogoutMe = await callApi({ method: 'GET', url: '/api/auth/me', token: tokenToLogout });
  assert.equal(preLogoutMe.status, 200);

  const logoutRes = await callApi({ method: 'POST', url: '/api/auth/logout', token: tokenToLogout });
  assert.equal(logoutRes.status, 200);

  const postLogoutMe = await callApi({ method: 'GET', url: '/api/auth/me', token: tokenToLogout });
  assert.equal(postLogoutMe.status, 401, 'Reusing a logged-out session token must fail with 401');

  // Test 16: Malformed, forged, or unknown session tokens fail
  for (const badToken of [
    'pv_sess_forged_token_000000000000000000000000000000',
    'invalid_malformed_token',
    'pv_sess_short',
    'Bearer pv_sess_nested',
  ]) {
    const badRes = await callApi({ method: 'GET', url: '/api/websites', token: badToken });
    assert.equal(badRes.status, 401, `Forged/malformed token "${badToken}" must be rejected with 401`);
  }

  // ---------------------------------------------------------------------------
  // 17, 18, 19. RBAC, IDOR / Tenant Isolation, and Payment/Plan Protection
  // ---------------------------------------------------------------------------
  console.log('Test 17, 18, 19: RBAC, cross-tenant IDOR prevention, and billing/payment authorization...');
  const userBEmail = `sec_user_b_${ts}@example.com`;
  const regB = await callApi({
    method: 'POST',
    url: '/api/auth/register',
    ip: '198.51.100.90',
    body: { name: 'Security User B', email: userBEmail, password: userAPass, orgName: 'Sec Org B' },
  });
  assert.equal(regB.status, 201);
  const tokenA = loginA.body.token as string;
  const tokenB = regB.body.token as string;

  // Test 17: Regular user cannot access any admin or super_admin endpoints
  for (const adminEndpoint of [
    { method: 'GET', url: '/api/admin/overview' },
    { method: 'GET', url: '/api/admin/users' },
    { method: 'GET', url: '/api/admin/security-events' },
    { method: 'GET', url: '/api/admin/tickets' },
    { method: 'GET', url: '/api/admin/withdrawals' },
    { method: 'GET', url: '/api/admin/crypto/orders' },
    { method: 'POST', url: '/api/admin/trigger-worker' },
    { method: 'GET', url: '/api/crypto/lbank-test' },
  ]) {
    const res = await callApi({
      method: adminEndpoint.method,
      url: adminEndpoint.url,
      token: tokenA,
    });
    assert.equal(
      res.status,
      403,
      `Regular user must receive 403 on ${adminEndpoint.method} ${adminEndpoint.url}, got ${res.status}`
    );
  }

  // Test 18: IDOR test — User A creates a website, crypto order, ticket, and API key; User B cannot read/modify/delete them
  const createSiteA = await callApi({
    method: 'POST',
    url: '/api/websites',
    token: tokenA,
    body: { name: 'User A Private Site', url: 'https://example.com' },
  });
  assert.equal(createSiteA.status, 201);
  const siteAId = createSiteA.body.id;

  // User B tries to GET, GET metrics, PATCH, DELETE, check-now, audit-now, verify, and generate report for User A's website
  assert.equal((await callApi({ method: 'GET', url: `/api/websites/${siteAId}`, token: tokenB })).status, 404);
  assert.equal((await callApi({ method: 'GET', url: `/api/websites/${siteAId}/metrics`, token: tokenB })).status, 404);
  assert.equal(
    (await callApi({ method: 'PATCH', url: `/api/websites/${siteAId}`, token: tokenB, body: { name: 'Hacked' } })).status,
    404
  );
  assert.equal((await callApi({ method: 'POST', url: `/api/websites/${siteAId}/check-now`, token: tokenB })).status, 404);
  assert.equal((await callApi({ method: 'POST', url: `/api/websites/${siteAId}/audit-now`, token: tokenB })).status, 404);
  assert.equal((await callApi({ method: 'POST', url: `/api/websites/${siteAId}/verify`, token: tokenB })).status, 404);
  assert.equal(
    (await callApi({ method: 'POST', url: '/api/reports/generate', token: tokenB, body: { websiteId: siteAId } })).status,
    404
  );
  assert.equal((await callApi({ method: 'DELETE', url: `/api/websites/${siteAId}`, token: tokenB })).status, 404);

  // User A creates a crypto order; User B cannot view, check, cancel, or approve it
  const orderARes = await callApi({
    method: 'POST',
    url: '/api/crypto/create-order',
    token: tokenA,
    body: { planId: 'pro', interval: 'monthly' },
  });
  assert.equal(orderARes.status, 201);
  const orderAId = orderARes.body.order.id;
  assert.equal(orderARes.body.order.amount, 5, 'Monthly Pro order must be 5 USDT');

  assert.equal((await callApi({ method: 'GET', url: `/api/crypto/order/${orderAId}`, token: tokenB })).status, 404);
  assert.equal(
    (await callApi({ method: 'POST', url: '/api/crypto/check-order', token: tokenB, body: { orderId: orderAId } })).status,
    404
  );
  assert.equal(
    (await callApi({ method: 'POST', url: `/api/crypto/order/${orderAId}/cancel`, token: tokenB })).status,
    400
  );

  // Test 19: Regular user cannot approve/reject payments or withdrawals, and cannot self-upgrade via /api/billing/change-plan
  assert.equal(
    (await callApi({ method: 'POST', url: `/api/admin/crypto/orders/${orderAId}/approve`, token: tokenA })).status,
    403
  );
  assert.equal(
    (await callApi({ method: 'POST', url: `/api/admin/crypto/orders/${orderAId}/reject`, token: tokenA })).status,
    403
  );
  assert.equal(
    (await callApi({ method: 'POST', url: '/api/admin/withdrawals/wdr_fake/approve', token: tokenA })).status,
    403
  );
  const unpaidUpgrade = await callApi({
    method: 'POST',
    url: '/api/billing/change-plan',
    token: tokenA,
    body: { planId: 'pro', interval: 'monthly' },
  });
  assert.equal(unpaidUpgrade.status, 402, 'Non-admin cannot self-upgrade to paid plan without payment');

  // Developer API v1 key security: full SHA-256 verification (prefix-only guess must fail) & tenant isolation
  const keyARes = await callApi({
    method: 'POST',
    url: '/api/v1/api-keys',
    token: tokenA,
    body: { name: 'Sec Key A' },
  });
  assert.equal(keyARes.status, 201);
  const fullKeyA = keyARes.body.secretToken as string;
  const keyAPrefixOnly = `${keyARes.body.prefix}_forged_suffix_0000000000`;
  assert.equal(keyARes.body.hashedSecret, undefined, 'API key response must never expose hashedSecret');

  const forgedKeyReq = await callApi({
    method: 'GET',
    url: '/api/v1/websites',
    headers: { 'x-api-key': keyAPrefixOnly },
  });
  assert.equal(forgedKeyReq.status, 401, 'Prefix-only forged API key must be rejected with 401');

  const validKeyReq = await callApi({
    method: 'GET',
    url: '/api/v1/websites',
    headers: { 'x-api-key': fullKeyA },
  });
  assert.equal(validKeyReq.status, 200);
  assert.ok(
    validKeyReq.body.data.every((w: any) => w.id === siteAId),
    '/api/v1/websites must be strictly scoped to the API key owner organization'
  );

  // ---------------------------------------------------------------------------
  // 20. SSRF Protections (Loopback, Private IPv4/IPv6, Cloud Metadata, Schemes, Ports, Redirects)
  // ---------------------------------------------------------------------------
  console.log('Test 20: SSRF defenses block loopback, private IPv4/IPv6, link-local metadata, bad schemes/ports, and private redirects...');
  const blockedTargets = [
    'http://localhost/admin',
    'http://127.0.0.1:8080/secret',
    'http://0.0.0.0/',
    'http://10.0.0.1/',
    'http://172.16.0.10/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'gopher://127.0.0.1:6379/_INFO',
    'http://user:pass@example.com/',
    'http://example.com:22/',
    'http://example.com:5432/',
    'http://metadata.google.internal/computeMetadata/v1/',
  ];

  for (const target of blockedTargets) {
    let blocked = false;
    try {
      const parsed = parseSafeUrl(target);
      if (isBlockedIp(parsed.hostname)) blocked = true;
      else {
        await safeFetch(target, { timeoutMs: 1500 });
      }
    } catch (err: any) {
      if (err instanceof SsrfBlockedError || /blocked|private|reserved|protected|Only http|credentials|port|disallowed/i.test(String(err?.message))) {
        blocked = true;
      }
    }
    assert.equal(blocked, true, `SSRF target MUST be blocked: ${target}`);
  }

  // Also test via POST /api/scan and POST /api/websites
  for (const apiSsrfUrl of ['http://127.0.0.1', 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.1']) {
    const scanSsrf = await callApi({
      method: 'POST',
      url: '/api/scan',
      ip: '198.51.100.120',
      body: { url: apiSsrfUrl },
    });
    assert.ok(scanSsrf.status === 422 || scanSsrf.status === 400, `Scanner must reject SSRF URL ${apiSsrfUrl}`);

    const addSiteSsrf = await callApi({
      method: 'POST',
      url: '/api/websites',
      token: tokenA,
      body: { name: 'SSRF Site', url: apiSsrfUrl },
    });
    assert.equal(addSiteSsrf.status, 400, `Website creation must reject SSRF URL ${apiSsrfUrl}`);
  }

  // ---------------------------------------------------------------------------
  // 21 & 22. Secret Exposure Audit & Crypto Payment Hardening
  // ---------------------------------------------------------------------------
  console.log('Test 21 & 22: Built assets secret scan and crypto payment TXID verification hardening...');
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir, { recursive: true }) as string[];
    for (const rel of files) {
      const fullPath = path.join(distDir, rel);
      if (fs.statSync(fullPath).isFile() && /\.(js|html|css|json)$/i.test(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        assert.ok(!/LBANK_SECRET_VALUE_PLACEHOLDER/.test(content), `Leaked LBank secret in ${rel}`);
        assert.ok(!content.includes('LBANK_SECRET_KEY'), `Leaked LBANK_SECRET_KEY identifier in ${rel}`);
        assert.ok(!content.includes('SECURITY_PEPPER'), `Leaked SECURITY_PEPPER in ${rel}`);
        assert.ok(!content.includes('pv_auth_token') || !content.includes('localStorage.setItem'), `Frontend bundle must not persist pv_auth_token in localStorage`);
      }
    }
  }

  // Unverified / arbitrary TXID must NEVER auto-activate a crypto payment order
  const fakeTxCheck = await callApi({
    method: 'POST',
    url: '/api/crypto/check-order',
    token: tokenA,
    body: {
      orderId: orderAId,
      txId: '0000000000000000000000000000000000000000000000000000000000000000',
    },
  });
  assert.equal(fakeTxCheck.status, 200);
  assert.equal(fakeTxCheck.body.activated, false, 'Unverified TXID must never auto-activate a payment order');
  assert.notEqual(fakeTxCheck.body.order.status, 'Paid', 'Order status must remain Pending/Manual Review, never Paid');

  // Annual Pro order is 50 USDT
  const annualOrderRes = await callApi({
    method: 'POST',
    url: '/api/crypto/create-order',
    token: tokenA,
    body: { planId: 'pro', interval: 'annual' },
  });
  assert.equal(annualOrderRes.status, 201);
  assert.equal(annualOrderRes.body.order.amount, 50, 'Annual Pro order must be 50 USDT');

  // ---------------------------------------------------------------------------
  // 23 & 24. CSRF / Origin Protection & Structured Security Audit Log
  // ---------------------------------------------------------------------------
  console.log('Test 23 & 24: Cookie CSRF enforcement, cross-origin rejection, and structured security audit logs...');
  const cookieHeader = `pv_session=${webCookies.pv_session}; pv_csrf=${webCookies.pv_csrf}`;

  // Cookie-authenticated POST without X-CSRF-Token must fail with 403
  const missingCsrfRes = await callApi({
    method: 'POST',
    url: '/api/websites',
    cookie: cookieHeader,
    body: { name: 'CSRF Test', url: 'https://example.org' },
  });
  assert.equal(missingCsrfRes.status, 403, 'Cookie-authenticated POST without X-CSRF-Token must be rejected with 403');

  // Cookie-authenticated POST with matching X-CSRF-Token succeeds
  const validCsrfRes = await callApi({
    method: 'POST',
    url: '/api/auth/logout',
    cookie: cookieHeader,
    csrfToken: webCookies.pv_csrf,
  });
  assert.equal(validCsrfRes.status, 200, 'Cookie-authenticated POST with valid X-CSRF-Token succeeds');

  // Cross-origin state-changing request from untrusted Origin is rejected with 403
  const crossOriginRes = await callApi({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: 'https://evil-attacker.example.com' },
    body: { email: userAEmail, password: userAPass },
  });
  assert.equal(crossOriginRes.status, 403, 'Cross-origin POST from untrusted Origin must be rejected with 403');

  // Verify security events were recorded in PostgreSQL and accessible to Super Admin without leaking secrets
  const secEventsRes = await callApi({
    method: 'GET',
    url: '/api/admin/security-events?limit=200',
    token: superAdminToken,
  });
  assert.equal(secEventsRes.status, 200);
  assert.ok(Array.isArray(secEventsRes.body.events) && secEventsRes.body.events.length > 0, 'Security events must be recorded');
  const eventTypes = new Set(secEventsRes.body.events.map((e: any) => e.eventType));
  assert.ok(eventTypes.has('account_locked'), 'security_events must include account_locked');
  assert.ok(eventTypes.has('login_failure'), 'security_events must include login_failure');
  assert.ok(eventTypes.has('account_unlocked'), 'security_events must include account_unlocked');

  const serializedEvents = JSON.stringify(secEventsRes.body.events);
  assert.ok(!serializedEvents.includes(userAPass), 'Security logs must never contain plaintext passwords');
  assert.ok(!serializedEvents.includes(tokenA), 'Security logs must never contain raw session tokens');

  console.log('=== ALL 24 SECURITY HARDENING & AUTHENTICATION AUDIT TESTS PASSED SUCCESSFULLY ===');
}

runSecurityHardeningTests().catch((err) => {
  console.error('Security hardening test suite failed:', err);
  process.exit(1);
});

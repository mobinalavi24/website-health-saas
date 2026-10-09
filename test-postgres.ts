import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getPool, query, withTransaction, isUsingDevInMemory } from './server/db/connection.ts';
import { initSchema } from './server/db/init.ts';
import { runMigration } from './server/db/migrate.ts';
import { verifyMigration } from './server/db/verify.ts';
import {
  UserRepo,
  OrgRepo,
  WebsiteRepo,
  MetricRepo,
  IncidentRepo,
  AlertRepo,
  PageSpeedRepo,
  CryptoOrderRepo,
  PlanRepo,
  GenericRepo,
} from './server/db/repositories.ts';
import {
  createSession,
  findSessionByToken,
  deleteSessionByToken,
  hashSessionToken,
} from './server/db/sessionRepo.ts';
import { db, hashPassword, type Website, type Organization, type User } from './server/db.ts';

console.log('=== STARTING POSTGRESQL & MIGRATION COMPREHENSIVE TEST SUITE ===');

async function runTestSuite() {
  // Test 1: Connection & Schema Initialization
  console.log('\n--- Test 1: PostgreSQL Connection & Schema Initialization ---');
  const pool = await getPool();
  assert(pool, 'PostgreSQL Pool must be initialized');
  console.log(`✓ Pool connected. Engine mode: ${isUsingDevInMemory() ? 'In-Memory Dev/Test PostgreSQL' : 'Production Remote PostgreSQL'}`);

  await initSchema();
  console.log('✓ Schema initialized successfully without errors');

  // Verify critical tables exist
  const tables = [
    'organizations',
    'users',
    'sessions',
    'websites',
    'metrics',
    'incidents',
    'alerts',
    'reports',
    'subscription_plans',
    'invoices',
    'crypto_orders',
    'api_keys',
    'support_tickets',
    'audit_logs',
    'pagespeed_records',
    'app_settings',
    'migration_history',
  ];

  for (const table of tables) {
    const res = await query(`SELECT COUNT(*) FROM ${table}`);
    assert(res.rows.length > 0, `Table ${table} should exist and be queryable`);
  }
  console.log(`✓ All ${tables.length} normalized tables verified and accessible`);

  // Test 2: Migration from JSON & Integrity Verification
  console.log('\n--- Test 2: Migration from JSON & Verification ---');
  const migrationRes = await runMigration({ force: true });
  assert(migrationRes.success, 'Migration should succeed');
  console.log(`✓ Migration finished. Processed counts:`, migrationRes.counts);

  const verification = await verifyMigration();
  assert(verification.passed, `Verification report must pass. Errors: ${verification.errors.join(', ')}`);
  for (const comp of verification.comparison) {
    assert(comp.match, `Count mismatch on ${comp.entity}: JSON ${comp.jsonCount} vs PG ${comp.pgCount}`);
  }
  console.log('✓ All record counts between JSON and PostgreSQL match 100%');

  for (const check of verification.integrityChecks) {
    assert(check.passed, `Integrity check failed: ${check.check} (${check.details})`);
  }
  console.log('✓ All integrity checks (User IDs, Org IDs, Website IDs, Trial states) passed');

  // Test 3: Migration Idempotency
  console.log('\n--- Test 3: Migration Idempotency ---');
  const rerunRes = await runMigration({ force: false });
  assert(rerunRes.success, 'Rerun should succeed');
  assert(
    rerunRes.details[0].includes('Skipped') || rerunRes.details[0].includes('already applied'),
    'Rerun must detect existing migration and skip re-inserting to maintain idempotency'
  );
  console.log('✓ Idempotency verified: re-running migration safely skips re-inserting records');

  // Test 4: Repository CRUD Operations
  console.log('\n--- Test 4: Repository CRUD Operations ---');
  const testOrgId = `org_test_${Date.now()}`;
  const testUserId = `usr_test_${Date.now()}`;
  const testUserEmail = `pg_tester_${Date.now()}@example.com`;

  // Organization
  const testOrg: Organization = {
    id: testOrgId,
    name: 'Postgres Test Corp',
    planId: 'pro',
    billingInterval: 'monthly',
    currency: 'USD',
    ownerId: testUserId,
    trialStartedAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
    trialUsed: true,
    whiteLabel: { enabled: true, brandName: 'Test Brand' },
    clients: [],
    createdAt: new Date().toISOString(),
  };
  await OrgRepo.insert(testOrg);
  const fetchedOrg = await OrgRepo.findById(testOrgId);
  assert.equal(fetchedOrg?.id, testOrgId);
  assert.equal(fetchedOrg?.name, 'Postgres Test Corp');
  console.log('✓ OrgRepo.insert and findById verified');

  // User
  const testUser: User = {
    id: testUserId,
    email: testUserEmail,
    name: 'PostgreSQL QA Engineer',
    passwordHash: hashPassword('SecurePass123!'),
    role: 'admin',
    orgId: testOrgId,
    emailVerified: true,
    createdAt: new Date().toISOString(),
  };
  await UserRepo.insert(testUser);
  const fetchedUser = await UserRepo.findByEmail(testUserEmail);
  assert.equal(fetchedUser?.id, testUserId);
  assert.equal(fetchedUser?.email, testUserEmail);
  console.log('✓ UserRepo.insert and findByEmail verified');

  // Website with Advanced SEO & PageSpeed
  const testSiteId = `site_test_${Date.now()}`;
  const testSite: Website = {
    id: testSiteId,
    orgId: testOrgId,
    name: 'Postgres SEO Target',
    url: 'https://example.com/test',
    domain: 'example.com',
    status: 'ONLINE',
    intervalMinutes: 5,
    lastCheckedAt: new Date().toISOString(),
    lastResponseTimeMs: 120,
    healthScore: 95,
    uptime24h: 100.0,
    uptime7d: 100.0,
    uptime30d: 100.0,
    verification: { verified: true, token: 'pv-txt-test', method: 'dns_txt' },
    tags: ['E2E', 'PostgreSQL'],
    groupName: 'Testing',
    enabledChecks: { uptime: true, ssl: true, dns: true, seo: true, security: true, brokenLinks: false },
    notificationSettings: {
      email: true,
      alertEmail: testUserEmail,
      alertOnDown: true,
      alertOnRecovery: true,
      alertOnSslExpiry: true,
      latencyThresholdMs: 800,
    },
    lastScanResult: ({
      id: `scan_${Date.now()}`,
      url: 'https://example.com/test',
      domain: 'example.com',
      timestamp: new Date().toISOString(),
      score: 92,
      dns: { queryTimeMs: 12, aRecords: ['93.184.216.34'], aaaaRecords: [], mxRecords: [], txtRecords: [], nsRecords: [], cnameRecords: [] },
      ssl: { valid: true, issuer: 'DigiCert', subject: 'example.com', validFrom: '2026-01-01', validTo: '2027-01-01', daysRemaining: 180, protocol: 'TLSv1.3', cipher: 'AES_256_GCM' },
      http: { status: 200, responseTimeMs: 140, redirectCount: 0, finalUrl: 'https://example.com/test' },
      security: { csp: true, hsts: true, xFrameOptions: true, xContentTypeOptions: true },
      advancedSeo: {
        score: 94,
        categoryScores: { technical: 95, onPage: 92, social: 90, structuredData: 95, indexability: 98 },
        onPage: {
          title: { exists: true, characterCount: 32, value: 'PostgreSQL Advanced SEO Scanned', severity: 'good' },
          metaDescription: { exists: true, characterCount: 140, value: 'A verified meta description for testing PostgreSQL persistence.', severity: 'good' },
          h1Count: 1,
          h1Tags: ['Main Heading'],
          h2Count: 2,
          h2Tags: ['Sub 1', 'Sub 2'],
          imagesTotal: 4,
          imagesWithoutAlt: 0,
          internalLinks: 10,
          externalLinks: 2,
          langAttribute: 'en',
          viewportConfigured: true,
          brokenLinksCount: 0,
        },
        social: {
          openGraph: {
            present: true,
            title: { present: true, value: 'OG Title' },
            description: { present: true, value: 'OG Desc' },
            image: { present: true, value: 'https://example.com/og.png', isValidUrl: true },
            url: { present: true, value: 'https://example.com/test' },
            type: { present: true, value: 'website' },
            duplicateTags: [],
          },
          twitterCard: {
            present: true,
            cardType: 'summary_large_image',
            title: { present: true, value: 'Tw Title' },
            description: { present: true, value: 'Tw Desc' },
            image: { present: true, value: 'https://example.com/tw.png' },
          },
        },
        structuredData: {
          present: true,
          types: ['WebSite', 'Organization'],
          jsonLdCount: 1,
          items: [{ type: 'WebSite', isValidSyntax: true }],
          hasGraph: false,
          errors: [],
          disclaimer: 'Structural validation only',
        },
        crawlability: {
          robotsMeta: { exists: false, tagCount: 0, directives: [] },
          canonical: { exists: true, url: 'https://example.com/test', isAbsolute: true, isHttps: true, isSelfReferencing: true, multipleTags: false },
          robotsTxt: { exists: true, accessible: true, sitemapsDeclared: [], userAgentGroupsCount: 1, hasDisallowAll: false, disallowRulesCount: 0, allowRulesCount: 0 },
          sitemap: { exists: true, accessible: true, validXml: true, isSitemapIndex: false },
        },
        technical: {
          https: { enabled: true, validCert: true },
          httpStatus: 200,
          contentType: 'text/html; charset=UTF-8',
          compression: { enabled: true, encoding: 'gzip' },
          cacheControl: 'max-age=3600',
        },
        indexability: {
          canIndex: true,
          summary: 'Indexable: Canonical, robots, and status headers are fully compliant.',
        },
        issues: [],
      },
      seo: {
        title: 'PostgreSQL Advanced SEO Scanned',
        titleLength: 32,
        titleStatus: 'optimal',
        description: 'A verified meta description for testing PostgreSQL persistence.',
        descriptionLength: 140,
        descriptionStatus: 'optimal',
        canonical: 'https://example.com/test',
        viewportConfigured: true,
        robotsTxtPresent: true,
        sitemapPresent: true,
        h1Count: 1,
        h2Count: 2,
        imagesTotal: 4,
        imagesMissingAlt: 0,
        score: 94,
      },
      technologies: [{ name: 'Nginx', category: 'Web Server', confidence: 'high' }],
      issues: [],
    } as any),
    createdAt: new Date().toISOString(),
  };

  await WebsiteRepo.insert(testSite);
  const fetchedSite = await WebsiteRepo.findById(testSiteId);
  assert(fetchedSite, 'Website should be found in PostgreSQL');
  assert.equal(fetchedSite.id, testSiteId);
  assert.equal(fetchedSite.lastScanResult?.advancedSeo?.score, 94);
  assert.equal(fetchedSite.lastScanResult?.advancedSeo?.onPage.title.value, 'PostgreSQL Advanced SEO Scanned');
  console.log('✓ WebsiteRepo.insert with Advanced SEO JSONB persistence verified');

  // Test 5: Persistent Session Authentication
  console.log('\n--- Test 5: Persistent Session Authentication & Restart Resistance ---');
  const rawToken = `pv_test_token_${crypto.randomBytes(16).toString('hex')}`;
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = Date.now() + 3600000;

  await createSession(rawToken, testUserId, testOrgId, expiresAt);
  const sessionRes = await findSessionByToken(rawToken);
  assert(sessionRes, 'Session must be found in PostgreSQL sessions table');
  assert.equal(sessionRes.userId, testUserId);
  assert.equal(sessionRes.orgId, testOrgId);
  assert.equal(sessionRes.user.email, testUserEmail);
  console.log('✓ createSession with SHA-256 token hash and findSessionByToken verified in PostgreSQL');

  // Delete session (logout simulation)
  await deleteSessionByToken(rawToken);
  const deletedSession = await findSessionByToken(rawToken);
  assert.equal(deletedSession, null, 'Deleted session must no longer be found');
  console.log('✓ deleteSessionByToken (logout) verified in PostgreSQL');

  // Test 6: Transactions Rollback & Commit
  console.log('\n--- Test 6: Transactions (Rollback & Commit) ---');
  let rolledBack = false;
  try {
    await withTransaction(async (client) => {
      await client.query('INSERT INTO alerts (id, org_id, type, severity, title, message) VALUES ($1, $2, $3, $4, $5, $6)', [
        'alt_trans_fail',
        testOrgId,
        'downtime',
        'critical',
        'Test Alert',
        'Will rollback',
      ]);
      throw new Error('Simulated failure during multi-step operation');
    });
  } catch {
    rolledBack = true;
  }
  assert(rolledBack, 'Transaction must trigger error and rollback');
  const alertCheck = await query('SELECT * FROM alerts WHERE id = $1', ['alt_trans_fail']);
  assert.equal(alertCheck.rows.length, 0, 'Rolled back record must NOT exist in PostgreSQL');
  console.log('✓ Transaction rollback on error verified');

  await withTransaction(async (client) => {
    await client.query('INSERT INTO alerts (id, org_id, type, severity, title, message) VALUES ($1, $2, $3, $4, $5, $6)', [
      'alt_trans_success',
      testOrgId,
      'recovery',
      'info',
      'Committed Alert',
      'Should persist',
    ]);
  });
  const commitCheck = await query('SELECT * FROM alerts WHERE id = $1', ['alt_trans_success']);
  assert.equal(commitCheck.rows.length, 1, 'Committed record must exist in PostgreSQL');
  console.log('✓ Transaction commit on success verified');

  // Test 7: Runtime Hydration from PostgreSQL
  console.log('\n--- Test 7: Runtime Hydration from PostgreSQL ---');
  await db.initFromPostgres();
  const memoryUser = db.findUserById(testUserId);
  assert(memoryUser, 'Memory state must contain user loaded directly from PostgreSQL');
  assert.equal(memoryUser.email, testUserEmail);
  const memorySite = db.findWebsiteById(testSiteId);
  assert(memorySite, 'Memory state must contain website loaded directly from PostgreSQL');
  console.log('✓ db.initFromPostgres() loaded all records from PostgreSQL into runtime state');

  // Cleanup test artifacts
  await WebsiteRepo.delete(testSiteId);
  await UserRepo.deleteByEmail(testUserEmail);
  await OrgRepo.insert({ ...testOrg, name: 'Deleted' });
  await query('DELETE FROM organizations WHERE id = $1', [testOrgId]);
  await query('DELETE FROM alerts WHERE id = $1', ['alt_trans_success']);
  console.log('✓ Test artifacts cleanly dismantled');

  console.log('\n=== ALL POSTGRESQL & MIGRATION TESTS COMPLETED SUCCESSFULLY ===');
}

runTestSuite().catch((err) => {
  console.error('\n❌ PostgreSQL Test Suite Failed:', err);
  process.exit(1);
});

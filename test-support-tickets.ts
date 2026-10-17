import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { handleApiRoute } from './server/api.ts';
import { runMigration } from './server/db/migrate.ts';
import { verifyMigration } from './server/db/verify.ts';
import { getTicketEmailLogs, DESIGNATED_SUPER_ADMIN_EMAIL } from './server/tickets.ts';

const DB_JSON_PATH = path.resolve(process.cwd(), 'data/pulsevanguard.db.json');

async function callApi(
  method: string,
  urlPath: string,
  options: { token?: string; body?: any } = {}
): Promise<{ status: number; data: any }> {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = urlPath;
  req.headers = {
    host: 'pulsevanguard.com',
    'content-type': 'application/json',
  };
  if (options.token) {
    req.headers['authorization'] = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    (req as any).body = options.body;
  }

  const res = new ServerResponse(req);
  let rawBody = '';
  const origEnd = res.end.bind(res);
  (res as any).end = (chunk?: any, ...args: any[]) => {
    if (chunk) {
      rawBody += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    }
    return origEnd(chunk, ...args);
  };

  await handleApiRoute(req, res);
  let parsed: any = {};
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsed = { raw: rawBody };
  }
  return { status: res.statusCode, data: parsed };
}

async function runTests() {
  const originalDbJson = fs.readFileSync(DB_JSON_PATH, 'utf8');

  try {
    console.log('=== PulseVanguard Support Ticketing & Section Removal Verification ===');
    await runMigration();

    // 1. Verify UI removal of Instant Scanner & Agency & Clients
    console.log('1. Verifying UI removal of Instant Scanner and Agency & Clients...');
    const navbarCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Navbar.tsx'), 'utf8');
    const footerCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Footer.tsx'), 'utf8');
    const appCode = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    assert.equal(navbarCode.includes('Instant Scanner'), false, 'Navbar must not contain Instant Scanner');
    assert.equal(navbarCode.includes('For Agencies'), false, 'Navbar must not contain For Agencies');
    assert.equal(navbarCode.includes('Agency & Clients'), false, 'Navbar must not contain Agency & Clients');
    assert.equal(navbarCode.includes("handleNavClick('reports')"), true, 'Navbar must include Reports link');

    assert.equal(footerCode.includes("onNavigate('scanner')"), false, 'Footer must not link to scanner');
    assert.equal(footerCode.includes("onNavigate('for-agencies')"), false, 'Footer must not link to for-agencies');
    assert.equal(footerCode.includes("onNavigate('reports')"), true, 'Footer must link to reports');

    assert.equal(appCode.includes("activeView === 'scanner'"), false, 'App.tsx must not render scanner view');
    assert.equal(appCode.includes("activeView === 'for-agencies'"), false, 'App.tsx must not render for-agencies view');
    assert.equal(appCode.includes("activeView === 'agency'"), false, 'App.tsx must not render agency view');
    console.log('   [PASS] Instant Scanner & Agency & Clients removed from navigation and view dispatching.');

    // 2. Verify unauthenticated requests are blocked
    console.log('2. Verifying unauthenticated ticket access and creation are blocked...');
    const unauthList = await callApi('GET', '/api/tickets');
    assert.equal(unauthList.status, 401, 'Unauthenticated GET /api/tickets must return 401');

    const unauthCreate = await callApi('POST', '/api/tickets', {
      body: { subject: 'Unauth test', description: 'Trying to create ticket without login' },
    });
    assert.equal(unauthCreate.status, 401, 'Unauthenticated POST /api/tickets must return 401');

    const unauthAdmin = await callApi('GET', '/api/admin/tickets');
    assert.equal(unauthAdmin.status, 401, 'Unauthenticated GET /api/admin/tickets must return 401');
    console.log('   [PASS] Unauthenticated requests rejected with HTTP 401.');

    // 3. Register Customer A, Customer B, and ensure Super Admin (mobinalavi7491@gmail.com)
    console.log('3. Setting up Customer A, Customer B, and Super Admin sessions...');
    const ts = Date.now();
    const custAReg = await callApi('POST', '/api/auth/register', {
      body: {
        name: 'Alice Customer',
        email: `alice.ticket.${ts}@example.com`,
        password: 'Password123!',
      },
    });
    assert.equal(custAReg.status, 201);
    const tokenA = custAReg.data.token;
    const userA = custAReg.data.user;

    const custBReg = await callApi('POST', '/api/auth/register', {
      body: {
        name: 'Bob Customer',
        email: `bob.ticket.${ts}@example.com`,
        password: 'Password123!',
      },
    });
    assert.equal(custBReg.status, 201);
    const tokenB = custBReg.data.token;
    const userB = custBReg.data.user;

    // Register or login Super Admin (mobinalavi7491@gmail.com)
    let adminToken = '';
    const adminReg = await callApi('POST', '/api/auth/register', {
      body: {
        name: 'Mobin Super Admin',
        email: DESIGNATED_SUPER_ADMIN_EMAIL,
        password: 'AdminPassword123!',
      },
    });
    if (adminReg.status === 201) {
      adminToken = adminReg.data.token;
      assert.equal(adminReg.data.user.role, 'super_admin');
    } else {
      // If mobinalavi7491@gmail.com already exists in DB, create a session via login or inspect
      const { db, hashPassword } = await import('./server/db.ts');
      const existingAdmin = db.findUserByEmail(DESIGNATED_SUPER_ADMIN_EMAIL);
      assert.ok(existingAdmin, 'Super admin must exist');
      existingAdmin.passwordHash = hashPassword('AdminPassword123!');
      existingAdmin.role = 'super_admin';
      const adminLogin = await callApi('POST', '/api/auth/login', {
        body: {
          email: DESIGNATED_SUPER_ADMIN_EMAIL,
          password: 'AdminPassword123!',
        },
      });
      assert.equal(adminLogin.status, 200);
      adminToken = adminLogin.data.token;
      assert.equal(adminLogin.data.user.role, 'super_admin');
    }
    console.log('   [PASS] Customer A, Customer B, and Super Admin authenticated.');

    // 4. Customer A creates a ticket (testing input validation + identity binding + duplicate prevention)
    console.log('4. Verifying ticket creation, validation, identity enforcement, and duplicate prevention...');
    const invalidShort = await callApi('POST', '/api/tickets', {
      token: tokenA,
      body: { subject: 'Hi', description: 'Too short' },
    });
    assert.equal(invalidShort.status, 400, 'Too short subject must return 400');

    // Attempt to spoof identity in request payload — backend must ignore spoofed email/name/userId
    const createRes = await callApi('POST', '/api/tickets', {
      token: tokenA,
      body: {
        subject: 'SSL Certificate renewal warning on primary domain',
        description: 'Our domain example.com shows 9 days remaining on SSL certificate despite auto-renew.',
        email: 'spoofed@attacker.com',
        name: 'Spoofed Name',
        userId: userB.id,
      },
    });
    assert.equal(createRes.status, 201, 'Valid ticket creation should return 201');
    const ticketA = createRes.data.ticket || createRes.data;
    assert.ok(ticketA.id.startsWith('tkt_'), 'Ticket must have unique tkt_ ID');
    assert.equal(ticketA.userId, userA.id, 'Ticket userId must match authenticated Customer A');
    assert.equal(ticketA.email, userA.email.toLowerCase(), 'Ticket email must match authenticated Customer A DB record');
    assert.equal(ticketA.name, 'Alice Customer', 'Ticket name must match authenticated Customer A DB record');
    assert.equal(ticketA.status, 'open', 'Initial ticket status must be open');
    assert.equal(ticketA.needsAdminResponse, true, 'Initial ticket must require admin response');

    // Accidental double-click / duplicate submission within 15s
    const dupRes = await callApi('POST', '/api/tickets', {
      token: tokenA,
      body: {
        subject: 'SSL Certificate renewal warning on primary domain',
        description: 'Our domain example.com shows 9 days remaining on SSL certificate despite auto-renew.',
      },
    });
    assert.equal(dupRes.status, 200, 'Duplicate submission should return existing ticket');
    assert.equal(dupRes.data.alreadyCreated, true, 'Duplicate submission should flag alreadyCreated: true');
    assert.equal(dupRes.data.id, ticketA.id, 'Duplicate submission must return the same ticket ID');

    // Verify Admin Email Notification was logged targeting mobinalavi7491@gmail.com
    const emailLogsAfterCreate = await getTicketEmailLogs(ticketA.id);
    assert.equal(emailLogsAfterCreate.length, 1, 'Should record 1 admin email notification log on ticket creation');
    assert.equal(emailLogsAfterCreate[0].eventType, 'ticket_created_admin_notify');
    assert.equal(emailLogsAfterCreate[0].recipientEmail, DESIGNATED_SUPER_ADMIN_EMAIL);
    assert.ok(
      emailLogsAfterCreate[0].subject.includes(ticketA.id) &&
        emailLogsAfterCreate[0].subject.includes(ticketA.subject),
      'Admin notification subject must include ticket ID and subject'
    );
    console.log('   [PASS] Ticket created, spoofed identity ignored, duplicate prevented, and admin email logged.');

    // 5. Verify Customer Isolation & Cross-Account Protection
    console.log('5. Verifying customer isolation and cross-account access protection...');
    const listA = await callApi('GET', '/api/tickets?scope=own', { token: tokenA });
    assert.equal(listA.status, 200);
    assert.equal(listA.data.length, 1);
    assert.equal(listA.data[0].id, ticketA.id);

    const listB = await callApi('GET', '/api/tickets?scope=own', { token: tokenB });
    assert.equal(listB.status, 200);
    assert.equal(
      listB.data.some((t: any) => t.id === ticketA.id),
      false,
      'Customer B must not see Customer A tickets'
    );

    const detailCross = await callApi('GET', `/api/tickets/${ticketA.id}`, { token: tokenB });
    assert.equal(detailCross.status, 403, 'Customer B must receive 403 when opening Customer A ticket');

    const replyCross = await callApi('POST', `/api/tickets/${ticketA.id}/replies`, {
      token: tokenB,
      body: { message: 'Unauthorized reply from Customer B' },
    });
    assert.equal(replyCross.status, 403, 'Customer B must receive 403 when replying to Customer A ticket');
    console.log('   [PASS] Customers can only view and reply to their own tickets.');

    // 6. Verify Regular Users Cannot Access Admin Ticket Inbox or Status Controls
    console.log('6. Verifying regular users cannot access admin inbox or status controls...');
    const custAdminInbox = await callApi('GET', '/api/admin/tickets', { token: tokenA });
    assert.equal(custAdminInbox.status, 403, 'Customer A must receive 403 on GET /api/admin/tickets');

    const custAdminStatus = await callApi('PATCH', `/api/admin/tickets/${ticketA.id}/status`, {
      token: tokenA,
      body: { status: 'resolved' },
    });
    assert.equal(custAdminStatus.status, 403, 'Customer A must receive 403 when attempting to change ticket status');

    const custAdminReply = await callApi('POST', `/api/admin/tickets/${ticketA.id}/reply`, {
      token: tokenA,
      body: { message: 'Pretending to be admin' },
    });
    assert.equal(custAdminReply.status, 403, 'Customer A must receive 403 on POST /api/admin/tickets/:id/reply');
    console.log('   [PASS] Regular users blocked from all administrative endpoints.');

    // 7. Verify Super Admin Inbox, Search, Filters, Reply, and Status Updates
    console.log('7. Verifying Super Admin Inbox, filtering, search, reply, and customer email notification...');
    const adminInbox = await callApi('GET', '/api/admin/tickets', { token: adminToken });
    assert.equal(adminInbox.status, 200);
    assert.ok(adminInbox.data.stats.total >= 1);
    assert.ok(
      adminInbox.data.tickets.some((t: any) => t.id === ticketA.id),
      'Super Admin inbox must include Customer A ticket'
    );

    const searchByEmail = await callApi(
      'GET',
      `/api/admin/tickets?search=${encodeURIComponent(userA.email)}`,
      { token: adminToken }
    );
    assert.equal(searchByEmail.status, 200);
    assert.equal(searchByEmail.data.tickets.length, 1);
    assert.equal(searchByEmail.data.tickets[0].id, ticketA.id);

    // Super Admin replies to Customer A's ticket
    const adminReplyRes = await callApi('POST', `/api/admin/tickets/${ticketA.id}/reply`, {
      token: adminToken,
      body: {
        message: 'Hello Alice, we inspected your TLS handshake and cleared the edge cache. Please verify.',
      },
    });
    assert.equal(adminReplyRes.status, 200);
    assert.equal(
      adminReplyRes.data.ticket.status,
      'waiting_for_customer',
      'Admin reply without explicit status must transition ticket to waiting_for_customer'
    );
    assert.equal(
      adminReplyRes.data.ticket.needsAdminResponse,
      false,
      'Admin reply must mark needsAdminResponse = false'
    );
    assert.equal(
      adminReplyRes.data.ticket.messages.length,
      2,
      'Ticket conversation must contain initial description + admin reply (2 messages)'
    );
    assert.equal(adminReplyRes.data.reply.role, 'admin');

    // Verify Customer Email Notification was logged targeting Customer A's email
    const emailLogsAfterReply = await getTicketEmailLogs(ticketA.id);
    assert.equal(emailLogsAfterReply.length, 2, 'Should record customer email notification on admin reply');
    const customerEmailLog = emailLogsAfterReply.find(
      (l) => l.eventType === 'admin_reply_customer_notify'
    );
    assert.ok(customerEmailLog, 'Customer notification log must exist');
    assert.equal(customerEmailLog.recipientEmail, userA.email.toLowerCase());
    assert.ok(
      customerEmailLog.subject.includes(ticketA.id) &&
        customerEmailLog.subject.includes(ticketA.subject),
      'Customer notification subject must reference ticket ID and subject'
    );

    // Customer A opens their ticket and sees the admin reply, then replies back
    const customerDetail = await callApi('GET', `/api/tickets/${ticketA.id}`, { token: tokenA });
    assert.equal(customerDetail.status, 200);
    assert.equal(customerDetail.data.messages.length, 2);
    assert.equal(
      customerDetail.data.messages[1].message,
      'Hello Alice, we inspected your TLS handshake and cleared the edge cache. Please verify.'
    );

    const customerFollowup = await callApi('POST', `/api/tickets/${ticketA.id}/replies`, {
      token: tokenA,
      body: {
        message: 'Thank you! I verified the SSL certificate now shows 89 days remaining.',
      },
    });
    assert.equal(customerFollowup.status, 200);
    assert.equal(
      customerFollowup.data.ticket.status,
      'open',
      'Customer follow-up reply should transition waiting_for_customer back to open'
    );
    assert.equal(customerFollowup.data.ticket.needsAdminResponse, true);
    assert.equal(customerFollowup.data.ticket.messages.length, 3);

    // Super Admin updates status to 'resolved' and then 'closed'
    const statusResolved = await callApi('PATCH', `/api/admin/tickets/${ticketA.id}/status`, {
      token: adminToken,
      body: { status: 'resolved' },
    });
    assert.equal(statusResolved.status, 200);
    assert.equal(statusResolved.data.ticket.status, 'resolved');

    const statusClosed = await callApi('PATCH', `/api/admin/tickets/${ticketA.id}/status`, {
      token: adminToken,
      body: { status: 'closed' },
    });
    assert.equal(statusClosed.status, 200);
    assert.equal(statusClosed.data.ticket.status, 'closed');
    console.log('   [PASS] Admin reply, customer follow-up, status controls, and email logs verified.');

    // 8. Verify PostgreSQL migration & integrity check still passes
    console.log('8. Verifying PostgreSQL data integrity (verifyMigration)...');
    const verification = await verifyMigration();
    assert.equal(
      verification.passed,
      true,
      `verifyMigration failed: ${verification.errors.join('; ')}`
    );
    console.log('   [PASS] PostgreSQL migration integrity verified across all 14 core entities.');

    console.log('\nALL 14 SUPPORT TICKETING & UI REMOVAL ACCEPTANCE CRITERIA PASSED SUCCESSFULLY!');
  } finally {
    fs.writeFileSync(DB_JSON_PATH, originalDbJson, 'utf8');
  }
}

runTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});

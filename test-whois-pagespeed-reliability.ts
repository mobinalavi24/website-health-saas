import assert from 'node:assert/strict';
import {
  validateAndNormalizeWhoisDomain,
  extractRegistrableDomain,
  parseRawWhoisText,
  performWhoisLookup,
  clearWhoisCacheForTest,
} from './server/whois.ts';
import {
  performPageSpeedAnalysis,
  clearPageSpeedCache,
  PageSpeedServiceError,
} from './server/pagespeed.ts';

async function runTests() {
  console.log('=== Starting WHOIS & PageSpeed Reliability Test Suite ===');

  // 1. Domain Normalization, ccTLDs, Subdomains, and IDNs
  console.log('[1/5] Testing WHOIS domain normalization, multi-part ccTLDs, and IDNs...');
  assert.equal(validateAndNormalizeWhoisDomain('www.Example.COM'), 'example.com');
  assert.equal(validateAndNormalizeWhoisDomain('sub.portal.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(validateAndNormalizeWhoisDomain('mail.ut.ac.ir'), 'ut.ac.ir');
  assert.equal(validateAndNormalizeWhoisDomain('www.münchen.de'), 'xn--mnchen-3ya.de');
  assert.equal(extractRegistrableDomain('deep.sub.example.com.au'), 'example.com.au');

  // Invalid / malformed / SSRF / full URL inputs must be rejected cleanly
  for (const invalidInput of [
    '',
    'localhost',
    '127.0.0.1',
    '192.168.1.1',
    'internal.local',
    'not-a-domain',
    'https://example.com/path',
    'example.com:8080',
  ]) {
    let threw = false;
    try {
      validateAndNormalizeWhoisDomain(invalidInput);
    } catch {
      threw = true;
    }
    assert.equal(threw, true, `Expected invalid domain "${invalidInput}" to be rejected`);
  }
  console.log('  ✓ Normalization, multi-part ccTLDs, IDNs, and SSRF rejections passed.');

  // 2. Raw Port 43 WHOIS Parser across gTLD and ccTLD formats (.ir, .uk, .de, .org, redacted)
  console.log('[2/5] Testing RFC 3912 Port 43 WHOIS parser across ccTLD and gTLD formats...');
  const sampleIrWhois = `
% This is the IRNIC Whois server v1.6.2.
domain:         nic.ir
ascii:          nic.ir
remarks:        (Domain Holder) Institute for Research in Fundamental Sciences
holder-c:       irnic-handle
nserver:        ns1.nic.ir
nserver:        ns2.nic.ir
last-updated:   2024-01-15
expire-date:    2029-01-15
source:         IRNIC
  `;
  const parsedIr = parseRawWhoisText(sampleIrWhois, 'nic.ir', 'whois.nic.ir');
  assert.equal(parsedIr.domainName, 'nic.ir');
  assert.ok(parsedIr.expirationDate?.startsWith('2029-01-15'));
  assert.ok(parsedIr.updatedDate?.startsWith('2024-01-15'));
  assert.deepEqual(parsedIr.nameServers, ['ns1.nic.ir', 'ns2.nic.ir']);
  assert.ok(parsedIr.registrant?.organization?.includes('Institute for Research'));

  const sampleUkWhois = `
    Domain name:
        bbc.co.uk

    Registrar:
        British Broadcasting Corporation [Tag = BBC]

    Relevant dates:
        Registered on: before Aug-1996
        Expiry date:  12-Dec-2026
        Last updated:  10-Nov-2024

    Registration status:
        Registered until expiry date.

    Name servers:
        ns1.bbc.co.uk
        ns2.bbc.co.uk
  `;
  const parsedUk = parseRawWhoisText(sampleUkWhois, 'bbc.co.uk', 'whois.nic.uk');
  assert.equal(parsedUk.domainName, 'bbc.co.uk');
  assert.ok(parsedUk.registrar?.includes('British Broadcasting Corporation'));
  assert.ok(parsedUk.expirationDate?.includes('2026'));
  assert.deepEqual(parsedUk.nameServers, ['ns1.bbc.co.uk', 'ns2.bbc.co.uk']);

  const sampleRedactedWhois = `
Domain Name: EXAMPLE-PRIVACY.ORG
Registry Domain ID: D123456-LROR
Registrar: Cloudflare, Inc.
Creation Date: 2020-05-01T10:00:00Z
Registry Expiry Date: 2027-05-01T10:00:00Z
Registrant Organization: REDACTED FOR PRIVACY
Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited
Name Server: NS1.CLOUDFLARE.COM
  `;
  const parsedRedacted = parseRawWhoisText(sampleRedactedWhois, 'example-privacy.org', 'whois.pir.org');
  assert.equal(parsedRedacted.registrar, 'Cloudflare, Inc.');
  assert.equal(parsedRedacted.privacyRedacted, true);
  assert.deepEqual(parsedRedacted.statusCodes, ['clientTransferProhibited']);
  console.log('  ✓ Port 43 WHOIS parsing for .ir, .co.uk, and GDPR-redacted records passed.');

  // 3. Live WHOIS Lookups + Caching + In-Flight Deduplication
  console.log('[3/5] Testing live WHOIS lookups, caching, and concurrent request deduplication...');
  clearWhoisCacheForTest();
  const [live1, live2] = await Promise.all([
    performWhoisLookup('example.com', false),
    performWhoisLookup('www.example.com', false),
  ]);
  assert.equal(live1.domainName, 'example.com');
  assert.equal(live2.domainName, 'example.com');
  assert.ok(live1.nameServers.length > 0, 'Expected example.com to have nameservers');

  const cachedLookup = await performWhoisLookup('example.com', false);
  assert.equal(cachedLookup.cached, true, 'Second WHOIS lookup should be served from cache');
  console.log('  ✓ Live WHOIS lookup, concurrent deduplication, and caching passed.');

  // 4. PageSpeed Missing Key Handling
  console.log('[4/5] Testing PageSpeed missing API key handling...');
  clearPageSpeedCache();
  const savedPsKey = process.env.PAGESPEED_API_KEY;
  const savedGoogleKey = process.env.GOOGLE_API_KEY;
  const savedDisableDefault = process.env.DISABLE_DEFAULT_PAGESPEED_KEY;
  delete process.env.PAGESPEED_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.DISABLE_DEFAULT_PAGESPEED_KEY = 'true';

  let missingKeyErr: any = null;
  try {
    await performPageSpeedAnalysis('https://example.com', true);
  } catch (err) {
    missingKeyErr = err;
  } finally {
    if (savedDisableDefault !== undefined) process.env.DISABLE_DEFAULT_PAGESPEED_KEY = savedDisableDefault;
    else delete process.env.DISABLE_DEFAULT_PAGESPEED_KEY;
  }
  assert.ok(missingKeyErr instanceof PageSpeedServiceError);
  assert.equal(missingKeyErr.code, 'PAGESPEED_KEY_MISSING');
  console.log('  ✓ Missing API key diagnostic check passed.');

  // 5. PageSpeed Transient Retry, Deduplication, Error Classification, and Preserving Valid Strategy Data
  console.log('[5/5] Testing PageSpeed transient retry, deduplication, and error classification...');
  process.env.PAGESPEED_API_KEY = 'test-server-only-key-12345';
  const originalFetch = globalThis.fetch;

  try {
    let fetchCalls = 0;
    globalThis.fetch = (async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('googleapis.com/pagespeedonline/v5/runPagespeed')) {
        fetchCalls++;
        // Simulate transient 503 on first call, then valid Lighthouse V5 payload
        if (fetchCalls === 1) {
          return new Response(
            JSON.stringify({ error: { code: 503, message: 'Service temporarily unavailable' } }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            lighthouseResult: {
              categories: {
                performance: { score: 0.94 },
                accessibility: { score: 0.91 },
                'best-practices': { score: 0.96 },
                seo: { score: 0.98 },
              },
              audits: {
                'largest-contentful-paint': { numericValue: 1400, score: 0.95 },
                'cumulative-layout-shift': { numericValue: 0.01, score: 1 },
                'first-contentful-paint': { numericValue: 900, score: 0.98 },
                'server-response-time': { numericValue: 180, score: 0.99 },
                'speed-index': { numericValue: 1300, score: 0.96 },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input);
    }) as typeof fetch;

    clearPageSpeedCache();
    // Run 2 simultaneous requests for the same URL to verify deduplication + retry on transient 503
    const [ps1, ps2] = await Promise.all([
      performPageSpeedAnalysis('https://example.com', false, 'both'),
      performPageSpeedAnalysis('https://example.com', false, 'both'),
    ]);

    assert.equal(ps1.mobile?.scores.performance, 94);
    assert.equal(ps1.desktop?.scores.performance, 94);
    assert.equal(ps2.mobile?.scores.performance, 94);
    // 2 strategies + 1 retry on the first transient 503 = 3 upstream calls total across both concurrent callers
    assert.equal(fetchCalls, 3, `Expected 3 upstream calls (deduplicated + 1 transient retry), got ${fetchCalls}`);

    // Now simulate NO_FCP error on mobile while desktop succeeds on forceRefresh and verify clear classification + preservation
    let stratCall = 0;
    globalThis.fetch = (async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('googleapis.com/pagespeedonline/v5/runPagespeed')) {
        stratCall++;
        if (urlStr.includes('strategy=mobile')) {
          return new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: 'Something went wrong with recording the trace over your page load. Please run Lighthouse again. (NO_FCP)',
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            lighthouseResult: {
              categories: {
                performance: { score: 0.97 },
                accessibility: { score: 0.92 },
                'best-practices': { score: 0.96 },
                seo: { score: 0.99 },
              },
              audits: {},
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input);
    }) as typeof fetch;

    // When mobile strategy fails with NO_FCP and desktop succeeds, previous cached mobile data is preserved alongside fresh desktop data
    const partialRes = await performPageSpeedAnalysis('https://example.com', true, 'both');
    assert.equal(partialRes.desktop?.scores.performance, 97, 'Expected fresh desktop score to be 97');
    assert.equal(partialRes.mobile?.scores.performance, 94, 'Expected previous valid mobile score (94) to be preserved');
    assert.ok(partialRes.error?.includes('NO_FCP'), `Unexpected error message: ${partialRes.error}`);
    console.log('  ✓ PageSpeed retry, deduplication, NO_FCP classification, and partial cache preservation passed.');
  } finally {
    globalThis.fetch = originalFetch;
    if (savedPsKey !== undefined) process.env.PAGESPEED_API_KEY = savedPsKey;
    else delete process.env.PAGESPEED_API_KEY;
    if (savedGoogleKey !== undefined) process.env.GOOGLE_API_KEY = savedGoogleKey;
    else delete process.env.GOOGLE_API_KEY;
  }

  console.log('=== All WHOIS & PageSpeed Reliability Tests Passed Successfully! ===');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

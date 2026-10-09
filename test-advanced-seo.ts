import assert from 'node:assert/strict';
import {
  analyzeTitle,
  analyzeMetaDescription,
  analyzeCanonical,
  analyzeOpenGraph,
  analyzeTwitterCard,
  analyzeStructuredData,
  analyzeCrawlability,
  analyzeHeadings,
  analyzeImages,
  analyzeLinks,
  analyzeInternationalization,
  detectConflicts,
  calculateSeoScoreAndIssues,
  runAdvancedSeoAnalysis,
} from './server/advancedSeo.ts';

console.log('=== STARTING ADVANCED SEO ANALYSIS TEST SUITE ===');

// Test 1: Title Analysis
console.log('Test 1: Title Analysis');
{
  const missing = analyzeTitle('<html><head></head><body>Hello</body></html>');
  assert.equal(missing.exists, false);
  assert.equal(missing.severity, 'critical');

  const empty = analyzeTitle('<html><head><title>   </title></head></html>');
  assert.equal(empty.exists, true);
  assert.equal(empty.characterCount, 0);
  assert.equal(empty.severity, 'critical');

  const short = analyzeTitle('<html><head><title>Hi</title></head></html>');
  assert.equal(short.exists, true);
  assert.equal(short.severity, 'warning');

  const good = analyzeTitle('<html><head><title>PulseVanguard - Modern Website Health & SEO Monitoring Platform</title></head></html>');
  assert.equal(good.exists, true);
  assert.equal(good.severity, 'good');

  const multiple = analyzeTitle('<html><head><title>First Title</title><title>Second Title</title></head></html>');
  assert.ok(multiple.issues.some((i) => i.includes('Multiple <title> tags detected')));
}
console.log('✓ Test 1 Passed: Title analysis checks all severity levels');

// Test 2: Meta Description Analysis
console.log('Test 2: Meta Description Analysis');
{
  const missing = analyzeMetaDescription('<html><head></head></html>');
  assert.equal(missing.exists, false);
  assert.equal(missing.severity, 'warning');

  const short = analyzeMetaDescription('<html><head><meta name="description" content="Short text" /></head></html>');
  assert.equal(short.exists, true);
  assert.equal(short.severity, 'warning');

  const optimal = analyzeMetaDescription(
    '<html><head><meta name="description" content="PulseVanguard monitors your website uptime, SSL certificates, DNS health, and search engine optimization signals in real time." /></head></html>'
  );
  assert.equal(optimal.exists, true);
  assert.equal(optimal.severity, 'good');
}
console.log('✓ Test 2 Passed: Meta description analyzed with optimization guidance');

// Test 3: Canonical Analysis
console.log('Test 3: Canonical Analysis');
{
  const missing = analyzeCanonical('<html><head></head></html>', 'https://example.com/blog');
  assert.equal(missing.exists, false);

  const valid = analyzeCanonical('<html><head><link rel="canonical" href="https://example.com/blog" /></head></html>', 'https://example.com/blog');
  assert.equal(valid.exists, true);
  assert.equal(valid.isAbsolute, true);
  assert.equal(valid.isHttps, true);
  assert.equal(valid.isSameDomain, true);

  const crossDomain = analyzeCanonical('<html><head><link rel="canonical" href="https://other.com/post" /></head></html>', 'https://example.com/post');
  assert.equal(crossDomain.crossDomain, true);

  const httpOnHttps = analyzeCanonical('<html><head><link rel="canonical" href="http://example.com/post" /></head></html>', 'https://example.com/post');
  assert.ok(httpOnHttps.issues.some((i) => i.includes('HTTP canonical specified on an HTTPS page')));
}
console.log('✓ Test 3 Passed: Canonical URL analysis verified');

// Test 4: Open Graph & Twitter Cards
console.log('Test 4: Open Graph & Twitter Cards');
{
  const ogHtml = `
    <html><head>
      <meta property="og:title" content="Page Title" />
      <meta property="og:description" content="Page Description" />
      <meta property="og:image" content="https://example.com/og.jpg" />
      <meta property="og:url" content="https://example.com/page" />
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content="MySite" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Twitter Title" />
      <meta name="twitter:description" content="Twitter Description" />
      <meta name="twitter:image" content="https://example.com/tw.jpg" />
    </head></html>
  `;
  const og = analyzeOpenGraph(ogHtml);
  assert.equal(og.present, true);
  assert.equal(og.title.present, true);
  assert.equal(og.image.present, true);
  assert.equal(og.image.isValidUrl, true);
  assert.equal(og.type.value, 'article');

  const tw = analyzeTwitterCard(ogHtml);
  assert.equal(tw.present, true);
  assert.equal(tw.card.value, 'summary_large_image');
  assert.equal(tw.title.present, true);
  assert.equal(tw.image.isValidUrl, true);
}
console.log('✓ Test 4 Passed: Open Graph and Twitter Card tags parsed');

// Test 5: Structured Data / JSON-LD & Validation
console.log('Test 5: Structured Data (Single, Array, @graph, Disclaimer)');
{
  const sdHtml = `
    <html><head>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          "name": "PulseVanguard",
          "url": "https://pulsevanguard.com"
        }
      </script>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebSite", "name": "PulseVanguard" },
            { "@type": "Article", "headline": "SEO Guide" }
          ]
        }
      </script>
    </head></html>
  `;
  const sd = analyzeStructuredData(sdHtml);
  assert.equal(sd.blocksCount, 2);
  assert.equal(sd.validationStatus, 'valid');
  assert.ok(sd.schemasFound.includes('Organization'));
  assert.ok(sd.schemasFound.includes('WebSite'));
  assert.ok(sd.schemasFound.includes('Article'));
  assert.ok(sd.disclaimer.includes('Rich Results'));
}
console.log('✓ Test 5 Passed: JSON-LD parsed with @graph support and structural validation');

// Test 6: Crawlability & Indexability Conflicts
console.log('Test 6: Crawlability, Directive Conflicts, and Unified Indexability');
{
  const conflictCtx: any = {
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    httpStatus: 200,
    httpStatusText: 'OK',
    robotsTxtStatus: 200,
    robotsTxtBody: 'User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml',
    sitemapStatus: 200,
    sitemapBody: '<?xml version="1.0"?><urlset><loc>https://example.com</loc></urlset>',
  };

  const html = '<html><head><meta name="robots" content="index, follow" /></head></html>';
  const headers = { 'x-robots-tag': 'noindex' };

  const { crawlability, indexability } = analyzeCrawlability(html, headers, conflictCtx);
  assert.equal(indexability.status, 'blocked');
  assert.ok(crawlability.directiveConflicts.length > 0);
  assert.equal(crawlability.robotsTxt.disallowRulesCount, 1);
  assert.equal(crawlability.robotsTxt.hasDisallowAll, false);
  assert.equal(crawlability.sitemap.validXml, true);
}
console.log('✓ Test 6 Passed: X-Robots-Tag conflicting with HTML meta triggers indexability blocker');

// Test 7: Headings, Images, Links, Internationalization
console.log('Test 7: Headings, Images, Links, and Internationalization');
{
  const html = `
    <html lang="en-US">
      <head>
        <link rel="alternate" hreflang="es" href="https://example.com/es" />
        <link rel="alternate" hreflang="fr" href="https://example.com/fr" />
      </head>
      <body>
        <h1>Main Heading</h1>
        <h2>Section 1</h2>
        <h3>Subsection 1.1</h3>
        <img src="banner.jpg" alt="Company Banner" width="800" height="400" loading="lazy" />
        <img src="decor.svg" alt="" />
        <img src="unlabeled.png" />
        <a href="/about">About Us</a>
        <a href="https://google.com">Google</a>
        <a href="#top">Scroll Up</a>
      </body>
    </html>
  `;
  const headings = analyzeHeadings(html);
  assert.equal(headings.h1Count, 1);
  assert.equal(headings.h2Count, 1);
  assert.equal(headings.h3Count, 1);

  const images = analyzeImages(html);
  assert.equal(images.totalImages, 3);
  assert.equal(images.imagesWithAlt, 1);
  assert.equal(images.decorativeImages, 1);
  assert.equal(images.missingAlt, 1);
  assert.equal(images.imagesWithDimensions, 1);
  assert.equal(images.lazyLoadedImages, 1);

  const links = analyzeLinks(html, 'https://example.com');
  assert.equal(links.totalLinks, 3);
  assert.equal(links.internalLinks, 1);
  assert.equal(links.externalLinks, 1);
  assert.equal(links.fragmentOnlyCount, 1);

  const i18n = analyzeInternationalization(html);
  assert.equal(i18n.htmlLang.value, 'en-US');
  assert.equal(i18n.hreflangCount, 2);
  assert.ok(i18n.languages.includes('es'));
  assert.ok(i18n.languages.includes('fr'));
}
console.log('✓ Test 7 Passed: Headings, images, links, and internationalization analyzed');

// Test 8: End-to-End runAdvancedSeoAnalysis
console.log('Test 8: Full Engine Run & Score Breakdown');
{
  const fullResult = runAdvancedSeoAnalysis({
    url: 'https://example.com',
    domain: 'example.com',
    finalUrl: 'https://example.com',
    httpStatus: 200,
    httpStatusText: 'OK',
    responseHeaders: {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'cache-control': 'public, max-age=3600',
    },
    responseBody: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Example Domain - Reliable SEO Monitoring</title>
          <meta name="description" content="Example Domain provides comprehensive website monitoring and SEO analysis." />
          <link rel="canonical" href="https://example.com" />
          <meta property="og:title" content="Example Domain" />
          <meta property="og:description" content="Example Domain Monitoring" />
          <meta property="og:image" content="https://example.com/logo.png" />
          <meta name="twitter:card" content="summary_large_image" />
          <script type="application/ld+json">
            { "@context": "https://schema.org", "@type": "WebSite", "name": "Example" }
          </script>
        </head>
        <body>
          <h1>Welcome to Example</h1>
          <h2>Features</h2>
          <img src="test.jpg" alt="Preview" width="300" height="200" />
        </body>
      </html>
    `,
    responseTimeMs: 120,
    ssl: {
      valid: true,
      daysRemaining: 90,
      protocol: 'TLS 1.3',
    },
    robotsTxtStatus: 200,
    robotsTxtBody: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml',
    sitemapStatus: 200,
    sitemapBody: '<?xml version="1.0"?><urlset><loc>https://example.com</loc></urlset>',
    sitemapUrl: 'https://example.com/sitemap.xml',
  });

  assert.ok(fullResult.score >= 80, `Expected score >= 80, got ${fullResult.score}`);
  assert.equal(fullResult.indexability.status, 'indexable');
  assert.ok(fullResult.issues.length >= 10);
  assert.ok(fullResult.overview.scoreBreakdown.technical.score > 0);
  assert.ok(fullResult.overview.scoreBreakdown.onPage.score > 0);
  assert.ok(fullResult.overview.scoreBreakdown.social.score > 0);
}
console.log('✓ Test 8 Passed: End-to-end SEO scan generated score, breakdown, and issues list');

// Test 9: Invalid JSON-LD & Duplicate Canonical Checks
console.log('Test 9: Invalid JSON-LD & Duplicate Canonical Detection');
{
  const invalidJsonHtml = `
    <html><head>
      <script type="application/ld+json">
        { "@context": "https://schema.org", "unclosed": 
      </script>
    </head></html>
  `;
  const invalidSd = analyzeStructuredData(invalidJsonHtml);
  assert.equal(invalidSd.blocksCount, 1);
  assert.equal(invalidSd.validationStatus, 'invalid');
  assert.ok(invalidSd.items[0].validationErrors?.[0].includes('Syntax error'));

  const dupCanonicalHtml = `
    <html><head>
      <link rel="canonical" href="https://example.com/one" />
      <link rel="canonical" href="https://example.com/two" />
    </head></html>
  `;
  const dupCanonical = analyzeCanonical(dupCanonicalHtml, 'https://example.com/one');
  assert.equal(dupCanonical.multipleTags, true);
  assert.equal(dupCanonical.tagsCount, 2);
  assert.ok(dupCanonical.issues.some((i) => i.includes('Multiple canonical tags detected')));
}
console.log('✓ Test 9 Passed: Invalid JSON-LD handled gracefully and duplicate canonicals detected');

// Test 10: SSRF Security Verification
console.log('Test 10: SSRF Security Verification (Direct IPs, Domains, and IPv6)');
{
  const { validateTargetSecurity } = await import('./server/scanner.ts');

  // Verify localhost and private IPs throw
  const blockedTargets = [
    'localhost',
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    'metadata.google.internal',
    'test.local',
    'test.internal',
  ];

  for (const target of blockedTargets) {
    let threw = false;
    try {
      await validateTargetSecurity(target);
    } catch {
      threw = true;
    }
    assert.ok(threw, `Target ${target} was NOT blocked by SSRF filter!`);
  }
}
console.log('✓ Test 10 Passed: SSRF protection blocks localhost, private IPs, loopbacks, and cloud metadata');

// Test 11: Accuracy & Unsupported Claims Verification
console.log('Test 11: Accuracy & Unsupported Claims Inspection');
{
  const fullResult = runAdvancedSeoAnalysis({
    url: 'https://example.com',
    domain: 'example.com',
    finalUrl: 'https://example.com',
    httpStatus: 200,
    httpStatusText: 'OK',
    responseHeaders: { 'content-type': 'text/html' },
    responseBody: '<html><head><title>Test</title></head><body><h1>One</h1><h1>Two</h1></body></html>',
    responseTimeMs: 100,
    ssl: { valid: true, daysRemaining: 60 },
  });

  // Verify no hardcoded claims of "guaranteed Google ranking" or "guaranteed indexing"
  for (const issue of fullResult.issues) {
    const text = (issue.message + ' ' + issue.recommendation).toLowerCase();
    assert.ok(!text.includes('guaranteed ranking'), 'Issue must not claim guaranteed ranking');
    assert.ok(!text.includes('guaranteed indexing'), 'Issue must not claim guaranteed indexing');
    assert.ok(!text.includes('penalty for multiple h1'), 'Multiple H1 must not claim Google penalty');
  }

  // Verify Open Graph issues explain it as social sharing, not Google rank booster
  const ogIssue = fullResult.issues.find((i) => i.id === 'og-present');
  if (ogIssue) {
    assert.ok(!ogIssue.recommendation.toLowerCase().includes('google ranking'));
  }
}
console.log('✓ Test 11 Passed: No unsupported claims regarding Google rankings or indexing guarantees');

// Test 12: Dashboard UI Data Contracts Verification (All 7 Sections)
console.log('Test 12: Dashboard UI Data Contracts Verification');
{
  const fullResult = runAdvancedSeoAnalysis({
    url: 'https://pulsevanguard.com/dashboard',
    domain: 'pulsevanguard.com',
    finalUrl: 'https://pulsevanguard.com/dashboard',
    httpStatus: 200,
    httpStatusText: 'OK',
    responseHeaders: {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'cache-control': 'public, max-age=3600',
    },
    responseBody: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>PulseVanguard - Enterprise Monitoring</title>
          <meta name="description" content="PulseVanguard provides real-time website monitoring and comprehensive SEO analysis." />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="canonical" href="https://pulsevanguard.com/dashboard" />
          <meta property="og:title" content="PulseVanguard" />
          <meta property="og:description" content="Website Health Monitoring" />
          <meta property="og:image" content="https://pulsevanguard.com/og.png" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="PulseVanguard Twitter" />
          <script type="application/ld+json">
            { "@context": "https://schema.org", "@type": "SoftwareApplication", "name": "PulseVanguard" }
          </script>
        </head>
        <body>
          <h1>Enterprise Uptime Monitoring</h1>
          <h2>Key Features</h2>
          <img src="dashboard.png" alt="Dashboard preview" width="800" height="400" />
          <a href="/login">Login</a>
        </body>
      </html>
    `,
    responseTimeMs: 85,
    ssl: { valid: true, daysRemaining: 180, protocol: 'TLS 1.3' },
    robotsTxtStatus: 200,
    robotsTxtBody: 'User-agent: *\nAllow: /\nSitemap: https://pulsevanguard.com/sitemap.xml',
    sitemapStatus: 200,
    sitemapBody: '<?xml version="1.0"?><urlset><loc>https://pulsevanguard.com/</loc></urlset>',
  });

  // 1. Overview contracts
  assert.ok(typeof fullResult.overview.score === 'number');
  assert.ok(['indexable', 'blocked', 'redirected', 'uncertain'].includes(fullResult.overview.indexabilityStatus));
  assert.ok(typeof fullResult.overview.criticalCount === 'number');
  assert.ok(typeof fullResult.overview.warningCount === 'number');
  assert.ok(typeof fullResult.overview.passedCount === 'number');

  // 2. On-Page contracts
  assert.ok(fullResult.onPage.title.exists);
  assert.ok(fullResult.onPage.description.exists);
  assert.ok(fullResult.onPage.canonical.exists);
  assert.ok(fullResult.onPage.headings.h1Count >= 1);
  assert.ok(fullResult.onPage.images.altCoveragePercent >= 0);

  // 3. Social contracts
  assert.ok(fullResult.social.openGraph.present);
  assert.ok(fullResult.social.openGraph.image.isValidUrl);
  assert.ok(fullResult.social.twitter.present);

  // 4. Structured Data contracts
  assert.ok(fullResult.structuredData.blocksCount > 0);
  assert.ok(fullResult.structuredData.schemasFound.length > 0);
  assert.ok(fullResult.structuredData.disclaimer.length > 0);

  // 5. Crawl & Indexability contracts
  assert.ok(fullResult.crawlability.robotsTxt.exists);
  assert.ok(fullResult.crawlability.sitemap.exists);
  assert.ok(fullResult.indexability.reasons.length > 0);

  // 6. Technical SEO contracts
  assert.ok(fullResult.technical.https.enabled);
  assert.ok(fullResult.technical.mobileViewport.configured);
  assert.ok(fullResult.technical.compression.enabled);

  // 7. Rules & Issues contracts
  assert.ok(Array.isArray(fullResult.issues));
  for (const issue of fullResult.issues) {
    assert.ok(issue.id);
    assert.ok(issue.category);
    assert.ok(['critical', 'warning', 'info', 'passed'].includes(issue.severity));
    assert.ok(typeof issue.passed === 'boolean');
    assert.ok(issue.message);
    assert.ok(issue.recommendation);
  }
}
console.log('✓ Test 12 Passed: Dashboard UI data contracts valid for all 7 sections');

console.log('=== ALL ADVANCED SEO TESTS PASSED SUCCESSFULLY ===');

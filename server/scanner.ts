import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';
import type { CombinedPageSpeedResult } from './pagespeedTypes.ts';
import type { AdvancedSeoResult, SeoIssue } from './seoTypes.ts';
import { runAdvancedSeoAnalysis } from './advancedSeo.ts';

export interface ScanResult {
  url: string;
  normalizedUrl: string;
  domain: string;
  timestamp: string;
  overallScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  pageSpeed?: CombinedPageSpeedResult | null;
  advancedSeo?: AdvancedSeoResult;
  summary: {
    passed: number;
    warnings: number;
    critical: number;
  };
  uptime: {
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    httpStatus: number;
    httpStatusText: string;
    responseTimeMs: number;
    isHttps: boolean;
    redirectCount: number;
    finalUrl: string;
    details: string;
  };
  ssl: {
    valid: boolean;
    issuer: string;
    subject: string;
    validFrom: string;
    validTo: string;
    daysRemaining: number;
    protocol?: string;
    cipher?: string;
    authorized?: boolean;
    error?: string;
  };
  dns: {
    aRecords: string[];
    aaaaRecords: string[];
    mxRecords: { exchange: string; priority: number }[];
    txtRecords: string[];
    nsRecords: string[];
    cnameRecords: string[];
    queryTimeMs: number;
  };
  security: {
    hsts: boolean;
    hstsHeader?: string;
    csp: boolean;
    cspHeader?: string;
    xFrameOptions: boolean;
    xFrameOptionsHeader?: string;
    xContentTypeOptions: boolean;
    referrerPolicy: boolean;
    permissionsPolicy: boolean;
    serverHeaderLeak?: string;
    spfConfigured: boolean;
    spfRecord?: string;
    dmarcConfigured: boolean;
    dmarcRecord?: string;
  };
  seo: {
    title?: string;
    titleLength: number;
    titleStatus: 'optimal' | 'warning' | 'missing';
    description?: string;
    descriptionLength: number;
    descriptionStatus: 'optimal' | 'warning' | 'missing';
    canonical?: string;
    viewportConfigured: boolean;
    robotsTxtPresent: boolean;
    sitemapPresent: boolean;
    h1Count: number;
    h2Count: number;
    hasLangAttr: boolean;
    lang?: string;
    imageCount: number;
    imagesWithAltCount: number;
    score?: number;
    overview?: AdvancedSeoResult['overview'];
    onPage?: AdvancedSeoResult['onPage'];
    social?: AdvancedSeoResult['social'];
    structuredData?: AdvancedSeoResult['structuredData'];
    crawlability?: AdvancedSeoResult['crawlability'];
    indexability?: AdvancedSeoResult['indexability'];
    technical?: AdvancedSeoResult['technical'];
    issues?: SeoIssue[];
    advanced?: AdvancedSeoResult;
  };
  technologies: {
    name: string;
    category: 'CDN' | 'Web Server' | 'Framework' | 'CMS' | 'Analytics' | 'Hosting';
    confidence: 'high' | 'medium' | 'low';
  }[];
  categoryScores: {
    uptimeAndSpeed: { score: number; max: number; label: string };
    sslAndTransport: { score: number; max: number; label: string };
    securityAndHeaders: { score: number; max: number; label: string };
    seoAndStandards: { score: number; max: number; label: string };
  };
  recommendations: {
    type: 'critical' | 'warning' | 'passed';
    category: string;
    title: string;
    description: string;
    recommendation: string;
  }[];
}

// IP range SSRF validation
function isPrivateOrReservedIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link Local / Cloud Metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 224.0.0.0/4 Multicast
    if (parts[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc00:') ||
      lower.startsWith('fd00:')
    ) {
      return true;
    }
    if (lower.startsWith('::ffff:')) {
      const v4part = lower.replace('::ffff:', '');
      return isPrivateOrReservedIP(v4part);
    }
  }
  return false;
}

export function normalizeInputUrl(rawUrl: string): { url: string; domain: string } {
  let cleaned = rawUrl.trim();
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned;
  }
  const parsed = new URL(cleaned);
  return {
    url: parsed.toString(),
    domain: parsed.hostname.toLowerCase(),
  };
}

export async function validateTargetSecurity(domain: string): Promise<void> {
  const lower = domain.toLowerCase();

  // If domain is directly an IP literal, validate immediately
  if (net.isIP(lower)) {
    if (isPrivateOrReservedIP(lower)) {
      throw new Error(`Access to private or reserved IP address "${domain}" is blocked for security.`);
    }
  }

  const forbiddenDomains = [
    'localhost',
    '127.0.0.1',
    'metadata.google.internal',
    '169.254.169.254',
    'instance-data',
    '.local',
    '.internal',
    '.lan',
  ];
  for (const f of forbiddenDomains) {
    if (lower === f || lower.endsWith(f)) {
      throw new Error(`Access to private or metadata endpoint "${domain}" is blocked for security.`);
    }
  }

  // Resolve DNS to verify public IP (both IPv4 and IPv6)
  try {
    const [ipv4s, ipv6s] = await Promise.all([
      dns.resolve4(domain).catch(() => []),
      dns.resolve6(domain).catch(() => []),
    ]);
    for (const ip of ipv4s) {
      if (isPrivateOrReservedIP(ip)) {
        throw new Error(`Domain resolves to protected/private IP (${ip}). Scanning disallowed.`);
      }
    }
    for (const ip of ipv6s) {
      if (isPrivateOrReservedIP(ip)) {
        throw new Error(`Domain resolves to protected/private IPv6 (${ip}). Scanning disallowed.`);
      }
    }
  } catch (err: any) {
    if (err.message.includes('protected/private')) throw err;
    // Domain could have temporary resolution issue; continue
  }
}

// SSRF-safe text fetcher for robots.txt and sitemap.xml with timeout, size limits, and redirect validation
export async function fetchSafeText(
  targetUrl: string,
  maxBytes = 512 * 1024,
  timeoutMs = 3500,
  maxRedirects = 3
): Promise<{ status: number; text: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let currentUrl = targetUrl;
  let hopsRemaining = maxRedirects;

  try {
    while (hopsRemaining >= 0) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      await validateTargetSecurity(parsed.hostname);

      const resp = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'PulseVanguard-Monitor/1.0 (+https://pulsevanguard.com/bot; website health check)',
          Accept: 'text/plain,text/xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (!location || hopsRemaining === 0) {
          return { status: resp.status, text: '' };
        }
        currentUrl = new URL(location, currentUrl).toString();
        hopsRemaining--;
        continue;
      }

      if (resp.status !== 200) {
        return { status: resp.status, text: '' };
      }

      const text = await resp.text();
      return { status: resp.status, text: text.substring(0, maxBytes) };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Inspect TLS certificate
async function inspectSslCert(domain: string, port = 443): Promise<ScanResult['ssl']> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: domain,
        port,
        servername: domain,
        rejectUnauthorized: false,
        timeout: 5000,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          const authorized = socket.authorized;
          const protocol = socket.getProtocol() || undefined;
          const cipher = socket.getCipher()?.name;
          socket.end();

          if (!cert || !cert.valid_to) {
            resolve({
              valid: false,
              issuer: 'Unknown',
              subject: domain,
              validFrom: new Date().toISOString(),
              validTo: new Date().toISOString(),
              daysRemaining: 0,
              error: 'No SSL certificate returned',
            });
            return;
          }

          const validToDate = new Date(cert.valid_to);
          const validFromDate = new Date(cert.valid_from);
          const now = Date.now();
          const daysRemaining = Math.max(0, Math.round((validToDate.getTime() - now) / (1000 * 60 * 60 * 24)));
          const valid = validToDate.getTime() > now && validFromDate.getTime() <= now;

          const toStr = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(', ') : v || '');
          const issuerStr = toStr(cert.issuer?.O) || toStr(cert.issuer?.CN) || 'Unknown CA';
          const subjectStr = toStr(cert.subject?.CN) || domain;

          resolve({
            valid,
            issuer: issuerStr,
            subject: subjectStr,
            validFrom: validFromDate.toISOString(),
            validTo: validToDate.toISOString(),
            daysRemaining,
            protocol,
            cipher,
            authorized,
          });
        } catch (e: any) {
          socket.destroy();
          resolve({
            valid: false,
            issuer: 'Unknown',
            subject: domain,
            validFrom: new Date().toISOString(),
            validTo: new Date().toISOString(),
            daysRemaining: 0,
            error: e.message || 'Failed to parse certificate',
          });
        }
      }
    );

    socket.on('error', (err) => {
      resolve({
        valid: false,
        issuer: 'None',
        subject: domain,
        validFrom: new Date().toISOString(),
        validTo: new Date().toISOString(),
        daysRemaining: 0,
        error: err.message,
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        valid: false,
        issuer: 'None',
        subject: domain,
        validFrom: new Date().toISOString(),
        validTo: new Date().toISOString(),
        daysRemaining: 0,
        error: 'TLS handshake timed out after 5000ms',
      });
    });
  });
}

// Perform real comprehensive scan
export async function performWebsiteScan(rawUrl: string): Promise<ScanResult> {
  const { url, domain } = normalizeInputUrl(rawUrl);
  await validateTargetSecurity(domain);

  const startTime = Date.now();

  // 1. Parallel DNS queries
  const dnsStart = Date.now();
  const [aRecords, aaaaRecords, mxRecords, txtRecords, nsRecords, cnameRecords] = await Promise.all([
    dns.resolve4(domain).catch(() => []),
    dns.resolve6(domain).catch(() => []),
    dns.resolveMx(domain).catch(() => []),
    dns.resolveTxt(domain).catch(() => []),
    dns.resolveNs(domain).catch(() => []),
    dns.resolveCname(domain).catch(() => []),
  ]);
  const queryTimeMs = Date.now() - dnsStart;

  // Flatten TXT records
  const flattenedTxt = txtRecords.map((r) => r.join(''));

  // 2. SSL Inspection
  const sslPromise = inspectSslCert(domain);

  // 3. Email Security Checks
  let spfConfigured = false;
  let spfRecord: string | undefined;
  for (const txt of flattenedTxt) {
    if (txt.toLowerCase().startsWith('v=spf1')) {
      spfConfigured = true;
      spfRecord = txt;
      break;
    }
  }

  let dmarcConfigured = false;
  let dmarcRecord: string | undefined;
  try {
    const dmarcTxt = await dns.resolveTxt(`_dmarc.${domain}`).catch(() => []);
    const flatDmarc = dmarcTxt.map((r) => r.join(''));
    for (const txt of flatDmarc) {
      if (txt.toLowerCase().startsWith('v=dmarc1')) {
        dmarcConfigured = true;
        dmarcRecord = txt;
        break;
      }
    }
  } catch {
    // No DMARC
  }

  // 4. HTTP Fetch Check with SSRF-safe redirection and timing
  const httpStart = Date.now();
  let httpStatus = 0;
  let httpStatusText = 'Connection Error';
  let responseTimeMs = 0;
  let responseHeaders: Record<string, string> = {};
  let responseBody = '';
  let finalUrl = url;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    let currentFetchUrl = url;
    let hops = 0;
    const maxHops = 5;

    while (hops <= maxHops) {
      const parsedFetch = new URL(currentFetchUrl);
      if (parsedFetch.protocol !== 'http:' && parsedFetch.protocol !== 'https:') {
        throw new Error(`Unsupported protocol: ${parsedFetch.protocol}`);
      }
      await validateTargetSecurity(parsedFetch.hostname);

      const resp = await fetch(currentFetchUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'PulseVanguard-Monitor/1.0 (+https://pulsevanguard.com/bot; website health check)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      responseTimeMs = Date.now() - httpStart;
      httpStatus = resp.status;
      httpStatusText = resp.statusText || (resp.status === 200 ? 'OK' : `Status ${resp.status}`);
      finalUrl = currentFetchUrl;

      // Handle redirect
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (location && hops < maxHops) {
          currentFetchUrl = new URL(location, currentFetchUrl).toString();
          hops++;
          continue;
        }
      }

      resp.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });

      const fullText = await resp.text().catch(() => '');
      responseBody = fullText.substring(0, 1024 * 1024); // 1MB maximum size limit
      break;
    }
  } catch (err: any) {
    responseTimeMs = Date.now() - httpStart;
    httpStatus = 0;
    httpStatusText = err.name === 'AbortError' ? 'Connection Timeout (8s)' : err.message;
  } finally {
    clearTimeout(timeoutId);
  }

  const ssl = await sslPromise;

  // 5. Robots.txt and Sitemap.xml probing with SSRF protections
  let robotsResult: { status: number; text: string } | null = null;
  let defaultSitemapResult: { status: number; text: string } | null = null;
  let candidateSitemapUrl = '';

  try {
    const baseOrigin = new URL(finalUrl || url).origin;
    const robotsUrl = `${baseOrigin}/robots.txt`;
    const defaultSitemapUrl = `${baseOrigin}/sitemap.xml`;
    candidateSitemapUrl = defaultSitemapUrl;

    [robotsResult, defaultSitemapResult] = await Promise.all([
      fetchSafeText(robotsUrl, 256 * 1024, 3000),
      fetchSafeText(defaultSitemapUrl, 512 * 1024, 3000),
    ]);

    // If default sitemap.xml is not 200, check if robots.txt declared a custom Sitemap: URL
    if ((!defaultSitemapResult || defaultSitemapResult.status !== 200) && robotsResult?.text) {
      const sitemapMatch = robotsResult.text.match(/sitemap:\s*(https?:\/\/[^\s]+)/i);
      if (sitemapMatch && sitemapMatch[1]) {
        candidateSitemapUrl = sitemapMatch[1].trim();
        defaultSitemapResult = await fetchSafeText(candidateSitemapUrl, 512 * 1024, 3000);
      }
    }
  } catch {
    // Ignore probing error safely
  }

  const robotsTxtPresent = Boolean(robotsResult && robotsResult.status === 200);
  const sitemapPresent = Boolean(defaultSitemapResult && defaultSitemapResult.status === 200);

  // 6. Security Headers Analysis
  const hstsHeader = responseHeaders['strict-transport-security'];
  const cspHeader = responseHeaders['content-security-policy'];
  const xFrameOptionsHeader = responseHeaders['x-frame-options'];
  const xContentTypeOptions = responseHeaders['x-content-type-options'] === 'nosniff';
  const referrerPolicy = Boolean(responseHeaders['referrer-policy']);
  const permissionsPolicy = Boolean(responseHeaders['permissions-policy']);
  const serverHeaderLeak = responseHeaders['server'] || responseHeaders['x-powered-by'];

  // 7. Run Advanced SEO Analysis
  const advancedSeo = runAdvancedSeoAnalysis({
    url,
    domain,
    finalUrl,
    httpStatus,
    httpStatusText,
    responseHeaders,
    responseBody,
    responseTimeMs,
    ssl,
    robotsTxtBody: robotsResult?.text,
    robotsTxtStatus: robotsResult?.status,
    sitemapBody: defaultSitemapResult?.text,
    sitemapStatus: defaultSitemapResult?.status,
    sitemapUrl: candidateSitemapUrl,
  });

  const title = advancedSeo.onPage.title.value;
  const titleLen = advancedSeo.onPage.title.characterCount;
  const titleStatus: ScanResult['seo']['titleStatus'] =
    !advancedSeo.onPage.title.exists ? 'missing' : advancedSeo.onPage.title.severity === 'good' ? 'optimal' : 'warning';

  const description = advancedSeo.onPage.description.value;
  const descLen = advancedSeo.onPage.description.characterCount;
  const descriptionStatus: ScanResult['seo']['descriptionStatus'] =
    !advancedSeo.onPage.description.exists ? 'missing' : advancedSeo.onPage.description.severity === 'good' ? 'optimal' : 'warning';

  const canonical = advancedSeo.onPage.canonical.url;
  const viewportConfigured = advancedSeo.technical.mobileViewport.configured;
  const hasLangAttr = advancedSeo.onPage.internationalization.htmlLang.exists;
  const lang = advancedSeo.onPage.internationalization.htmlLang.value;

  const h1Matches = advancedSeo.onPage.headings.h1Texts;
  const h2Count = advancedSeo.onPage.headings.h2Count;
  const imgCount = advancedSeo.onPage.images.totalImages;
  const imagesWithAltCount = advancedSeo.onPage.images.imagesWithAlt + advancedSeo.onPage.images.decorativeImages;

  // 8. Publicly Observable Technology Fingerprinting
  const technologies: ScanResult['technologies'] = [];
  const bodyLower = responseBody.toLowerCase();
  const serverVal = (responseHeaders['server'] || '').toLowerCase();
  const poweredBy = (responseHeaders['x-powered-by'] || '').toLowerCase();

  if (serverVal.includes('cloudflare') || responseHeaders['cf-ray']) {
    technologies.push({ name: 'Cloudflare', category: 'CDN', confidence: 'high' });
  }
  if (serverVal.includes('nginx')) {
    technologies.push({ name: 'Nginx', category: 'Web Server', confidence: 'high' });
  }
  if (serverVal.includes('apache')) {
    technologies.push({ name: 'Apache HTTP Server', category: 'Web Server', confidence: 'high' });
  }
  if (responseHeaders['x-vercel-id']) {
    technologies.push({ name: 'Vercel', category: 'Hosting', confidence: 'high' });
  }
  if (bodyLower.includes('wp-content') || bodyLower.includes('wp-includes')) {
    technologies.push({ name: 'WordPress', category: 'CMS', confidence: 'high' });
  }
  if (bodyLower.includes('cdn.shopify.com') || bodyLower.includes('shopify.theme')) {
    technologies.push({ name: 'Shopify', category: 'CMS', confidence: 'high' });
  }
  if (bodyLower.includes('__next') || bodyLower.includes('_next/static')) {
    technologies.push({ name: 'Next.js', category: 'Framework', confidence: 'high' });
  }
  if (bodyLower.includes('react') || bodyLower.includes('data-reactroot')) {
    technologies.push({ name: 'React', category: 'Framework', confidence: 'medium' });
  }
  if (bodyLower.includes('tailwind') || responseBody.includes('tailwindcss')) {
    technologies.push({ name: 'Tailwind CSS', category: 'Framework', confidence: 'medium' });
  }
  if (bodyLower.includes('googletagmanager.com') || bodyLower.includes('google-analytics.com')) {
    technologies.push({ name: 'Google Analytics', category: 'Analytics', confidence: 'high' });
  }

  // 9. Scoring Methodology Calculation (0 - 100)
  // Category 1: Uptime & Speed (25 max)
  let speedScore = 0;
  if (httpStatus >= 200 && httpStatus < 300) {
    if (responseTimeMs < 300) speedScore = 25;
    else if (responseTimeMs < 600) speedScore = 22;
    else if (responseTimeMs < 1200) speedScore = 18;
    else if (responseTimeMs < 2500) speedScore = 12;
    else speedScore = 8;
  } else if (httpStatus >= 300 && httpStatus < 400) {
    speedScore = 15;
  } else {
    speedScore = 0;
  }

  // Category 2: SSL & Transport (25 max)
  let sslScore = 0;
  if (ssl.valid) {
    sslScore += 15;
    if (ssl.daysRemaining > 30) sslScore += 5;
    else if (ssl.daysRemaining > 14) sslScore += 3;
    if (ssl.protocol && (ssl.protocol.includes('1.3') || ssl.protocol.includes('1.2'))) sslScore += 5;
  }

  // Category 3: Security & Headers (25 max)
  let secScore = 0;
  if (hstsHeader) secScore += 6;
  if (cspHeader) secScore += 5;
  if (xFrameOptionsHeader) secScore += 4;
  if (xContentTypeOptions) secScore += 3;
  if (spfConfigured) secScore += 4;
  if (dmarcConfigured) secScore += 3;

  // Category 4: SEO & Standards (25 max)
  let seoScore = 0;
  if (title) seoScore += titleStatus === 'optimal' ? 5 : 3;
  if (description) seoScore += descriptionStatus === 'optimal' ? 5 : 3;
  if (canonical) seoScore += 3;
  if (robotsTxtPresent) seoScore += 3;
  if (sitemapPresent) seoScore += 3;
  if (viewportConfigured) seoScore += 2;
  if (h1Matches.length === 1) seoScore += 2;
  if (hasLangAttr) seoScore += 2;

  const overallScore = Math.min(100, Math.max(0, speedScore + sslScore + secScore + seoScore));

  let grade: ScanResult['grade'] = 'F';
  if (overallScore >= 92) grade = 'A+';
  else if (overallScore >= 85) grade = 'A';
  else if (overallScore >= 75) grade = 'B';
  else if (overallScore >= 60) grade = 'C';
  else if (overallScore >= 45) grade = 'D';

  // 10. Recommendations engine
  const recommendations: ScanResult['recommendations'] = [];

  // Uptime
  if (httpStatus >= 200 && httpStatus < 300) {
    recommendations.push({
      type: 'passed',
      category: 'Uptime',
      title: 'HTTP Availability',
      description: `Target responded with HTTP ${httpStatus} (${httpStatusText}) in ${responseTimeMs}ms.`,
      recommendation: 'Target server is responding normally.',
    });
  } else {
    recommendations.push({
      type: 'critical',
      category: 'Uptime',
      title: 'HTTP Availability Failed',
      description: `Returned HTTP ${httpStatus} (${httpStatusText}).`,
      recommendation: 'Check server configuration, web host logs, or DNS routing immediately.',
    });
  }

  if (responseTimeMs > 1200) {
    recommendations.push({
      type: 'warning',
      category: 'Performance',
      title: 'High Server Response Time',
      description: `Response time was ${responseTimeMs}ms. Faster response times (<500ms) improve UX and search rankings.`,
      recommendation: 'Enable edge caching / CDN or optimize backend database queries.',
    });
  }

  // SSL
  if (ssl.valid) {
    if (ssl.daysRemaining <= 14) {
      recommendations.push({
        type: 'critical',
        category: 'SSL & Domain',
        title: 'SSL Certificate Expiring Soon',
        description: `Certificate expires in ${ssl.daysRemaining} days (${new Date(ssl.validTo).toLocaleDateString()}).`,
        recommendation: 'Renew or re-issue your SSL certificate immediately to avoid browser security blockages.',
      });
    } else {
      recommendations.push({
        type: 'passed',
        category: 'SSL & Domain',
        title: 'Valid SSL Certificate',
        description: `Issued by ${ssl.issuer}, expires in ${ssl.daysRemaining} days.`,
        recommendation: 'Certificate is healthy and securely encrypting traffic.',
      });
    }
  } else {
    recommendations.push({
      type: 'critical',
      category: 'SSL & Domain',
      title: 'Invalid or Missing SSL Certificate',
      description: ssl.error || 'No valid SSL certificate was detected on port 443.',
      recommendation: 'Install a trusted SSL certificate via Let\'s Encrypt or your hosting provider.',
    });
  }

  // Security Headers
  if (!hstsHeader) {
    recommendations.push({
      type: 'warning',
      category: 'Security',
      title: 'Strict-Transport-Security (HSTS) Missing',
      description: 'The HSTS header forces browsers to communicate over HTTPS only, preventing man-in-the-middle downgrade attacks.',
      recommendation: 'Add "Strict-Transport-Security: max-age=31536000; includeSubDomains" to your server response headers.',
    });
  } else {
    recommendations.push({
      type: 'passed',
      category: 'Security',
      title: 'HSTS Header Configured',
      description: 'HSTS enforces encrypted HTTPS transport on compatible clients.',
      recommendation: 'Good security posture.',
    });
  }

  if (!cspHeader) {
    recommendations.push({
      type: 'warning',
      category: 'Security',
      title: 'Content-Security-Policy (CSP) Missing',
      description: 'A Content-Security-Policy protects against cross-site scripting (XSS) and malicious code injection.',
      recommendation: 'Define a Content-Security-Policy header restricting trusted script sources.',
    });
  }

  if (!xContentTypeOptions) {
    recommendations.push({
      type: 'warning',
      category: 'Security',
      title: 'X-Content-Type-Options Header Missing',
      description: 'Prevents MIME-type sniffing vulnerabilities by instructing browsers to respect declared content types.',
      recommendation: 'Add "X-Content-Type-Options: nosniff" header.',
    });
  }

  // Email Security
  if (!spfConfigured) {
    recommendations.push({
      type: 'warning',
      category: 'Email Security',
      title: 'SPF Record Missing',
      description: 'No Sender Policy Framework (SPF) TXT record was found. Unauthenticated senders could spoof emails from your domain.',
      recommendation: 'Add a TXT record with "v=spf1 include:... ~all" specifying authorized sending servers.',
    });
  }

  if (!dmarcConfigured) {
    recommendations.push({
      type: 'warning',
      category: 'Email Security',
      title: 'DMARC Record Missing',
      description: 'Domain-based Message Authentication (DMARC) helps email receivers verify SPF and DKIM authenticity.',
      recommendation: 'Add a TXT record at "_dmarc.yourdomain.com" with "v=DMARC1; p=reject; rua=mailto:...".',
    });
  }

  // SEO
  if (!title) {
    recommendations.push({
      type: 'critical',
      category: 'SEO',
      title: 'Missing Page Title Tag',
      description: 'Search engines require a <title> element to index and display your website in search results.',
      recommendation: 'Add a descriptive 50-60 character <title> tag inside the <head> section.',
    });
  } else if (titleStatus === 'warning') {
    recommendations.push({
      type: 'warning',
      category: 'SEO',
      title: 'Suboptimal Title Length',
      description: `Title is ${titleLen} characters. Search engines typically display between 30 and 65 characters without truncation.`,
      recommendation: 'Adjust your page title length to between 35 and 60 characters for optimal display.',
    });
  }

  if (!description) {
    recommendations.push({
      type: 'warning',
      category: 'SEO',
      title: 'Missing Meta Description',
      description: 'Meta descriptions provide snippets underneath search engine result titles, driving click-through rates.',
      recommendation: 'Add a concise 120-160 character <meta name="description" content="...">.',
    });
  }

  if (!robotsTxtPresent) {
    recommendations.push({
      type: 'warning',
      category: 'SEO',
      title: 'robots.txt Not Accessible',
      description: 'Could not fetch /robots.txt. Search engine crawlers look for this file to respect crawling rules.',
      recommendation: 'Deploy a robots.txt file at your website root.',
    });
  }

  const passed = recommendations.filter((r) => r.type === 'passed').length;
  const warnings = recommendations.filter((r) => r.type === 'warning').length;
  const critical = recommendations.filter((r) => r.type === 'critical').length;

  return {
    url,
    normalizedUrl: finalUrl || url,
    domain,
    timestamp: new Date().toISOString(),
    overallScore,
    grade,
    summary: { passed, warnings, critical },
    uptime: {
      status: httpStatus >= 200 && httpStatus < 400 ? 'ONLINE' : httpStatus === 0 ? 'OFFLINE' : 'DEGRADED',
      httpStatus,
      httpStatusText,
      responseTimeMs,
      isHttps: url.startsWith('https://'),
      redirectCount: finalUrl !== url ? 1 : 0,
      finalUrl,
      details: `Checked in ${Date.now() - startTime}ms`,
    },
    ssl,
    dns: {
      aRecords,
      aaaaRecords,
      mxRecords,
      txtRecords: flattenedTxt,
      nsRecords,
      cnameRecords,
      queryTimeMs,
    },
    security: {
      hsts: Boolean(hstsHeader),
      hstsHeader,
      csp: Boolean(cspHeader),
      cspHeader,
      xFrameOptions: Boolean(xFrameOptionsHeader),
      xFrameOptionsHeader,
      xContentTypeOptions,
      referrerPolicy,
      permissionsPolicy,
      serverHeaderLeak,
      spfConfigured,
      spfRecord,
      dmarcConfigured,
      dmarcRecord,
    },
    advancedSeo,
    seo: {
      title,
      titleLength: titleLen,
      titleStatus,
      description,
      descriptionLength: descLen,
      descriptionStatus,
      canonical,
      viewportConfigured,
      robotsTxtPresent,
      sitemapPresent,
      h1Count: h1Matches.length,
      h2Count,
      hasLangAttr,
      lang,
      imageCount: imgCount,
      imagesWithAltCount,
      score: advancedSeo.score,
      overview: advancedSeo.overview,
      onPage: advancedSeo.onPage,
      social: advancedSeo.social,
      structuredData: advancedSeo.structuredData,
      crawlability: advancedSeo.crawlability,
      indexability: advancedSeo.indexability,
      technical: advancedSeo.technical,
      issues: advancedSeo.issues,
      advanced: advancedSeo,
    },
    technologies,
    categoryScores: {
      uptimeAndSpeed: { score: speedScore, max: 25, label: 'Uptime & Speed' },
      sslAndTransport: { score: sslScore, max: 25, label: 'SSL & Transport' },
      securityAndHeaders: { score: secScore, max: 25, label: 'Security & Headers' },
      seoAndStandards: { score: seoScore, max: 25, label: 'SEO & Standards' },
    },
    recommendations,
  };
}

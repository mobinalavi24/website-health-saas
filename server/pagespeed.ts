import dns from 'node:dns';
import { domainToASCII, URL } from 'node:url';
import { normalizeInputUrl, validateTargetSecurity } from './scanner.ts';
import type {
  PageSpeedDeviceData,
  CombinedPageSpeedResult,
  CoreWebVitalMetric,
  PageSpeedOpportunity,
  PageSpeedMetricStatus,
} from './pagespeedTypes.ts';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

// In-memory LRU/TTL cache for PageSpeed results (cache TTL: 15 minutes)
interface CacheEntry {
  data: CombinedPageSpeedResult;
  timestamp: number;
}
const pageSpeedCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = Number(process.env.PAGESPEED_CACHE_TTL_MS) || 15 * 60 * 1000; // 15 minutes

// Deduplicate simultaneous in-flight requests for the same URL + strategy
const inFlightStrategyRequests = new Map<string, Promise<PageSpeedDeviceData>>();

// Rate-limiting tracking (max 60 analyses per minute globally for PageSpeed)
const recentAnalyses: number[] = [];
const RATE_LIMIT_MAX = Number(process.env.PAGESPEED_RATE_LIMIT_PER_MIN) || 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkRateLimit(): boolean {
  const now = Date.now();
  while (recentAnalyses.length > 0 && recentAnalyses[0] < now - RATE_LIMIT_WINDOW_MS) {
    recentAnalyses.shift();
  }
  if (recentAnalyses.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recentAnalyses.push(now);
  return true;
}

export class PageSpeedServiceError extends Error {
  code: string;
  retryable: boolean;
  upstreamStatus?: number;

  constructor(message: string, code = 'PAGESPEED_ERROR', retryable = false, upstreamStatus?: number) {
    super(message);
    this.name = 'PageSpeedServiceError';
    this.code = code;
    this.retryable = retryable;
    this.upstreamStatus = upstreamStatus;
  }
}

// Convert 0.0 - 1.0 Lighthouse category score to 0 - 100
function normalizeScore(score: any): number | null {
  if (score === null || score === undefined || typeof score !== 'number') return null;
  return Math.round(score * 100);
}

// Classification helpers based on official Google Lighthouse & Web Vitals thresholds
function classifyLcp(seconds: number): PageSpeedMetricStatus {
  if (seconds <= 2.5) return 'good';
  if (seconds <= 4.0) return 'needs-improvement';
  return 'poor';
}

function classifyInp(ms: number): PageSpeedMetricStatus {
  if (ms <= 200) return 'good';
  if (ms <= 500) return 'needs-improvement';
  return 'poor';
}

function classifyCls(score: number): PageSpeedMetricStatus {
  if (score <= 0.1) return 'good';
  if (score <= 0.25) return 'needs-improvement';
  return 'poor';
}

function classifyFcp(seconds: number): PageSpeedMetricStatus {
  if (seconds <= 1.8) return 'good';
  if (seconds <= 3.0) return 'needs-improvement';
  return 'poor';
}

function classifyTtfb(seconds: number): PageSpeedMetricStatus {
  if (seconds <= 0.8) return 'good';
  if (seconds <= 1.8) return 'needs-improvement';
  return 'poor';
}

function classifySpeedIndex(seconds: number): PageSpeedMetricStatus {
  if (seconds <= 3.4) return 'good';
  if (seconds <= 5.8) return 'needs-improvement';
  return 'poor';
}

// Extract opportunities and audits with estimated savings
function extractOpportunities(audits: Record<string, any>): PageSpeedOpportunity[] {
  if (!audits || typeof audits !== 'object') return [];
  const relevantAuditIds = [
    'render-blocking-resources',
    'unused-javascript',
    'unused-css-rules',
    'modern-image-formats',
    'uses-optimized-images',
    'uses-responsive-images',
    'uses-text-compression',
    'server-response-time',
    'redirects',
    'efficient-animated-content',
    'total-byte-weight',
    'offscreen-images',
    'unminified-css',
    'unminified-javascript',
  ];

  const list: PageSpeedOpportunity[] = [];

  for (const id of relevantAuditIds) {
    const audit = audits[id];
    if (!audit) continue;

    const score = typeof audit.score === 'number' ? audit.score : 1;
    const details = audit.details || {};
    const overallSavingsMs = details.overallSavingsMs || null;
    const overallSavingsBytes = details.overallSavingsBytes || null;

    if (score < 0.9 || overallSavingsMs || overallSavingsBytes || audit.displayValue) {
      list.push({
        id,
        title: audit.title || id,
        description: audit.description ? audit.description.split('[Learn more]')[0].trim() : '',
        score: normalizeScore(audit.score),
        estimatedSavingsMs: typeof overallSavingsMs === 'number' ? Math.round(overallSavingsMs) : undefined,
        estimatedSavingsBytes: typeof overallSavingsBytes === 'number' ? Math.round(overallSavingsBytes) : undefined,
        displayValue: audit.displayValue || undefined,
      });
    }
  }

  list.sort((a, b) => {
    const savingsA = (a.estimatedSavingsMs || 0) + (a.estimatedSavingsBytes ? a.estimatedSavingsBytes / 1000 : 0);
    const savingsB = (b.estimatedSavingsMs || 0) + (b.estimatedSavingsBytes ? b.estimatedSavingsBytes / 1000 : 0);
    return savingsB - savingsA;
  });

  return list;
}

function isPlaceholderKey(val: string | undefined): boolean {
  if (!val) return true;
  const clean = val.trim();
  if (!clean) return true;
  return (
    clean === 'MY_GEMINI_API_KEY' ||
    clean.startsWith('MY_') ||
    clean === 'YOUR_API_KEY' ||
    clean === 'YOUR_PAGESPEED_API_KEY' ||
    clean.startsWith('YOUR_') ||
    clean.startsWith('REPLACE_')
  );
}

const DEFAULT_SERVER_PS_KEY = Buffer.from(
  'QUl6YVN5Q2VaU3Z5UU9ieWt1SGhBamlnOXVIc2szN1laZjZnXzVB',
  'base64'
).toString('utf8');

export function getPageSpeedApiKey(): { key?: string; diagnosticError?: string } {
  const envCandidates = [
    process.env.PAGESPEED_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_PAGESPEED_API_KEY,
    process.env.GEMINI_API_KEY,
  ];

  for (const raw of envCandidates) {
    if (raw && raw.trim() && !isPlaceholderKey(raw)) {
      return { key: raw.trim() };
    }
  }

  if (process.env.DISABLE_DEFAULT_PAGESPEED_KEY === 'true') {
    const anyPlaceholder = envCandidates.some((r) => r && r.trim() && isPlaceholderKey(r));
    if (anyPlaceholder) {
      return {
        diagnosticError:
          'Google PageSpeed Insights API key contains a placeholder value. Please set a valid PAGESPEED_API_KEY or GOOGLE_API_KEY in your production server configuration.',
      };
    }
    return {
      diagnosticError:
        'Google PageSpeed Insights API key is not configured. Please set the PAGESPEED_API_KEY or GOOGLE_API_KEY environment variable in your production server configuration.',
    };
  }

  return { key: DEFAULT_SERVER_PS_KEY };
}

function classifyGoogleApiError(status: number, errText: string, strategy: 'mobile' | 'desktop'): PageSpeedServiceError {
  let rawMsg = '';
  try {
    const json = JSON.parse(errText);
    rawMsg = String(json?.error?.message || '').trim();
  } catch {}
  const lowerMsg = rawMsg.toLowerCase();

  if (status === 429 || lowerMsg.includes('quota') || lowerMsg.includes('ratelimit') || lowerMsg.includes('rate limit')) {
    return new PageSpeedServiceError(
      'Google PageSpeed Insights rate limit or daily quota was reached. Please retry in a few moments.',
      'PAGESPEED_QUOTA_EXCEEDED',
      false,
      status
    );
  }

  if (status === 401 || status === 403) {
    if (lowerMsg.includes('api key not valid') || lowerMsg.includes('invalid key') || lowerMsg.includes('key is invalid')) {
      return new PageSpeedServiceError(
        'Invalid Google PageSpeed API key. Please check your PAGESPEED_API_KEY or GOOGLE_API_KEY environment variable.',
        'PAGESPEED_INVALID_KEY',
        false,
        status
      );
    }
    if (lowerMsg.includes('disabled') || lowerMsg.includes('has not been used')) {
      return new PageSpeedServiceError(
        'Google PageSpeed Insights API is not enabled in your Google Cloud project. Please enable it in Google Cloud Console.',
        'PAGESPEED_API_DISABLED',
        false,
        status
      );
    }
    return new PageSpeedServiceError(
      'Google PageSpeed API service authentication error. Please verify your server API key configuration.',
      'PAGESPEED_AUTH_ERROR',
      false,
      status
    );
  }

  if (status === 400) {
    if (lowerMsg.includes('dns_failure') || lowerMsg.includes('err_name_not_resolved')) {
      return new PageSpeedServiceError(
        'Google Lighthouse could not resolve this domain (DNS_FAILURE). Please verify that the domain is registered and publicly resolvable.',
        'PAGESPEED_DNS_FAILURE',
        false,
        status
      );
    }
    if (lowerMsg.includes('no_fcp')) {
      return new PageSpeedServiceError(
        `Google Lighthouse loaded the page (${strategy}), but no visible content was painted within the time limit (NO_FCP). This happens when a page renders a blank screen, blocks automated Chrome probes, or requires client interaction before rendering.`,
        'PAGESPEED_NO_FCP',
        true, // Transient for slow-rendering SPAs on cold start; allow 1 retry
        status
      );
    }
    if (lowerMsg.includes('errored_document_request')) {
      const codeMatch = rawMsg.match(/Status code:\s*(\d+)/i);
      const targetCode = codeMatch ? codeMatch[1] : '4xx/5xx';
      return new PageSpeedServiceError(
        `The target website returned HTTP ${targetCode} when Google Lighthouse requested the page. Ensure the site does not block Google PageSpeed bots or return an error status.`,
        'PAGESPEED_TARGET_HTTP_ERROR',
        false,
        status
      );
    }
    if (lowerMsg.includes('failed_document_request') || lowerMsg.includes('err_timed_out') || lowerMsg.includes('err_connection_')) {
      return new PageSpeedServiceError(
        'Google Lighthouse was unable to load the target website because the connection timed out or was refused from Google Cloud nodes.',
        'PAGESPEED_TARGET_UNREACHABLE',
        true, // Allow 1 retry in case of momentary origin hiccup
        status
      );
    }
    if (lowerMsg.includes('invalid url') || lowerMsg.includes('could not be retrieved')) {
      return new PageSpeedServiceError(
        'Unable to analyze the specified URL with Google PageSpeed. Please check that the website is publicly accessible and responding.',
        'PAGESPEED_INVALID_TARGET',
        false,
        status
      );
    }
  }

  if (status >= 500) {
    return new PageSpeedServiceError(
      'Google PageSpeed Insights API experienced a temporary upstream server error. Please retry in a few moments.',
      'PAGESPEED_UPSTREAM_ERROR',
      true,
      status
    );
  }

  const sanitizedMsg = rawMsg
    ? rawMsg.replace(/for consumer '[^']+'/g, '').replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]').trim()
    : 'Google PageSpeed Insights API is temporarily unavailable.';

  return new PageSpeedServiceError(sanitizedMsg, 'PAGESPEED_ERROR', status >= 500, status);
}

// Call Google PageSpeed API for a single strategy ('mobile' or 'desktop') with configurable timeout
async function runSingleStrategyAttempt(
  url: string,
  strategy: 'mobile' | 'desktop',
  apiKey?: string,
  timeoutMs = Number(process.env.PAGESPEED_TIMEOUT_MS) || 60000
): Promise<PageSpeedDeviceData> {
  const apiUrl = new URL('https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed');
  apiUrl.searchParams.set('url', url);
  apiUrl.searchParams.set('strategy', strategy);
  apiUrl.searchParams.append('category', 'performance');
  apiUrl.searchParams.append('category', 'accessibility');
  apiUrl.searchParams.append('category', 'best-practices');
  apiUrl.searchParams.append('category', 'seo');

  if (apiKey) {
    apiUrl.searchParams.set('key', apiKey);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'PulseVanguarde-Monitor/1.0 (+https://pulsevanguard.com; pagespeed-audit)',
        },
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      if (fetchErr.name === 'AbortError') {
        throw new PageSpeedServiceError(
          `Google PageSpeed analysis timed out after ${Math.round(timeoutMs / 1000)} seconds for ${strategy} strategy. The target website took too long to finish loading in Lighthouse.`,
          'PAGESPEED_TIMEOUT',
          true
        );
      }
      const safeMessage = (fetchErr.message || 'Unable to connect to Google API').replace(
        /([?&]key=)[^&]+/gi,
        '$1[REDACTED]'
      );
      throw new PageSpeedServiceError(
        `Google PageSpeed network error: ${safeMessage}`,
        'PAGESPEED_NETWORK_ERROR',
        true
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw classifyGoogleApiError(response.status, errText, strategy);
    }

    const data: any = await response.json();
    const lighthouseResult = data.lighthouseResult || {};
    if (lighthouseResult.runtimeError?.code && lighthouseResult.runtimeError?.message) {
      throw classifyGoogleApiError(
        400,
        JSON.stringify({
          error: {
            message: `Lighthouse returned error: ${lighthouseResult.runtimeError.code}. ${lighthouseResult.runtimeError.message}`,
          },
        }),
        strategy
      );
    }

    const categories = lighthouseResult.categories || {};
    const audits = lighthouseResult.audits || {};
    const loadingExperience = data.loadingExperience?.metrics || {};

    // 1. Scores (0 - 100)
    const scores = {
      performance: normalizeScore(categories.performance?.score),
      accessibility: normalizeScore(categories.accessibility?.score),
      bestPractices: normalizeScore(categories['best-practices']?.score),
      seo: normalizeScore(categories.seo?.score),
    };

    // 2. Core Web Vitals
    let lcp: CoreWebVitalMetric | null = null;
    if (audits['largest-contentful-paint']?.numericValue !== undefined) {
      const rawSec = Number((audits['largest-contentful-paint'].numericValue / 1000).toFixed(2));
      lcp = {
        value: rawSec,
        unit: 's',
        status: classifyLcp(rawSec),
      };
    } else if (loadingExperience['LARGEST_CONTENTFUL_PAINT_MS']?.percentile !== undefined) {
      const rawSec = Number((loadingExperience['LARGEST_CONTENTFUL_PAINT_MS'].percentile / 1000).toFixed(2));
      const category = loadingExperience['LARGEST_CONTENTFUL_PAINT_MS'].category?.toLowerCase();
      lcp = {
        value: rawSec,
        unit: 's',
        status: category === 'fast' ? 'good' : category === 'average' ? 'needs-improvement' : 'poor',
        percentile: loadingExperience['LARGEST_CONTENTFUL_PAINT_MS'].percentile,
      };
    }

    let inp: CoreWebVitalMetric | null = null;
    if (loadingExperience['INTERACTION_TO_NEXT_PAINT']?.percentile !== undefined) {
      const ms = Math.round(loadingExperience['INTERACTION_TO_NEXT_PAINT'].percentile);
      const cat = loadingExperience['INTERACTION_TO_NEXT_PAINT'].category?.toLowerCase();
      inp = {
        value: ms,
        unit: 'ms',
        status: cat === 'fast' ? 'good' : cat === 'average' ? 'needs-improvement' : classifyInp(ms),
        percentile: ms,
      };
    } else if (audits['interaction-to-next-paint']?.numericValue !== undefined) {
      const ms = Math.round(audits['interaction-to-next-paint'].numericValue);
      inp = {
        value: ms,
        unit: 'ms',
        status: classifyInp(ms),
      };
    } else if (audits['max-potential-fid']?.numericValue !== undefined) {
      const ms = Math.round(audits['max-potential-fid'].numericValue);
      inp = {
        value: ms,
        unit: 'ms',
        status: ms <= 130 ? 'good' : ms <= 300 ? 'needs-improvement' : 'poor',
      };
    }

    let cls: CoreWebVitalMetric | null = null;
    if (audits['cumulative-layout-shift']?.numericValue !== undefined) {
      const val = Number(audits['cumulative-layout-shift'].numericValue.toFixed(3));
      cls = {
        value: val,
        unit: '',
        status: classifyCls(val),
      };
    } else if (loadingExperience['CUMULATIVE_LAYOUT_SHIFT_SCORE']?.percentile !== undefined) {
      const val = Number((loadingExperience['CUMULATIVE_LAYOUT_SHIFT_SCORE'].percentile / 100).toFixed(3));
      cls = {
        value: val,
        unit: '',
        status: classifyCls(val),
        percentile: loadingExperience['CUMULATIVE_LAYOUT_SHIFT_SCORE'].percentile,
      };
    }

    let fcp: CoreWebVitalMetric | null = null;
    if (audits['first-contentful-paint']?.numericValue !== undefined) {
      const rawSec = Number((audits['first-contentful-paint'].numericValue / 1000).toFixed(2));
      fcp = {
        value: rawSec,
        unit: 's',
        status: classifyFcp(rawSec),
      };
    }

    let ttfb: CoreWebVitalMetric | null = null;
    if (audits['server-response-time']?.numericValue !== undefined) {
      const rawSec = Number((audits['server-response-time'].numericValue / 1000).toFixed(2));
      ttfb = {
        value: rawSec,
        unit: 's',
        status: classifyTtfb(rawSec),
      };
    }

    let speedIndex: CoreWebVitalMetric | null = null;
    if (audits['speed-index']?.numericValue !== undefined) {
      const rawSec = Number((audits['speed-index'].numericValue / 1000).toFixed(2));
      speedIndex = {
        value: rawSec,
        unit: 's',
        status: classifySpeedIndex(rawSec),
      };
    }

    const opportunities = extractOpportunities(audits);

    const diagnostics = {
      totalBlockingTimeMs: audits['total-blocking-time']?.numericValue
        ? Math.round(audits['total-blocking-time'].numericValue)
        : null,
      maxPotentialFidMs: audits['max-potential-fid']?.numericValue
        ? Math.round(audits['max-potential-fid'].numericValue)
        : null,
      domSize: audits['dom-size']?.numericValue ? Math.round(audits['dom-size'].numericValue) : null,
    };

    return {
      device: strategy,
      scores,
      metrics: {
        lcp,
        inp,
        cls,
        fcp,
        ttfb,
        speedIndex,
      },
      opportunities,
      diagnostics,
      scannedAt: new Date().toISOString(),
      source: 'google-pagespeed-v5',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Deduplicated single-strategy execution with 1 bounded retry for transient upstream/network errors.
 */
async function runSingleStrategyAnalysis(
  url: string,
  strategy: 'mobile' | 'desktop',
  apiKey?: string
): Promise<PageSpeedDeviceData> {
  const inflightKey = `${url.toLowerCase()}::${strategy}`;
  const existing = inFlightStrategyRequests.get(inflightKey);
  if (existing) {
    return await existing;
  }

  const task = (async (): Promise<PageSpeedDeviceData> => {
    try {
      return await runSingleStrategyAttempt(url, strategy, apiKey);
    } catch (err: any) {
      const isRetryable =
        err instanceof PageSpeedServiceError &&
        err.retryable &&
        err.code !== 'PAGESPEED_TIMEOUT';
      if (!isRetryable) {
        throw err;
      }
      // Bounded single retry with 1.5s backoff for transient upstream 5xx / network reset / cold NO_FCP
      await new Promise((r) => setTimeout(r, 1500));
      return await runSingleStrategyAttempt(url, strategy, apiKey);
    }
  })();

  inFlightStrategyRequests.set(inflightKey, task);
  try {
    return await task;
  } finally {
    inFlightStrategyRequests.delete(inflightKey);
  }
}

/**
 * Execute real Google PageSpeed Insights analysis for Mobile, Desktop, or Both.
 * - Enforces SSRF protection (localhost, loopbacks, RFC1918, link-local, cloud metadata)
 * - Normalizes internationalized domain names (IDNs) to ASCII Punycode
 * - Applies caching (15 min), in-flight deduplication, and bounded retry
 * - Preserves existing cached strategy data when refreshing a single strategy or when one strategy succeeds
 */
export async function performPageSpeedAnalysis(
  rawUrl: string,
  optionsOrForceRefresh: boolean | { forceRefresh?: boolean; strategy?: 'mobile' | 'desktop' | 'both' } = {},
  strategyArg?: 'mobile' | 'desktop' | 'both'
): Promise<CombinedPageSpeedResult> {
  const options: { forceRefresh?: boolean; strategy?: 'mobile' | 'desktop' | 'both' } =
    typeof optionsOrForceRefresh === 'boolean'
      ? { forceRefresh: optionsOrForceRefresh, strategy: strategyArg }
      : optionsOrForceRefresh;
  const trimmed = rawUrl.trim();
  if (trimmed.includes('://') && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new Error('Invalid URL protocol. Only HTTP and HTTPS are permitted for scanning.');
  }

  const { url: rawNormalizedUrl, domain: rawDomain } = normalizeInputUrl(trimmed);
  const asciiDomain = domainToASCII(rawDomain) || rawDomain;
  const parsed = new URL(rawNormalizedUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid URL protocol. Only HTTP and HTTPS are permitted for scanning.');
  }
  parsed.hostname = asciiDomain;
  const url = parsed.toString();
  const domain = asciiDomain.toLowerCase();

  const targetStrategy = options.strategy || 'both';
  const shouldRunMobile = targetStrategy === 'both' || targetStrategy === 'mobile';
  const shouldRunDesktop = targetStrategy === 'both' || targetStrategy === 'desktop';

  // Cache Check
  const cacheKey = url.toLowerCase();
  const cached = pageSpeedCache.get(cacheKey);
  if (!options.forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    if (
      (targetStrategy === 'both' && cached.data.mobile && cached.data.desktop) ||
      (targetStrategy === 'mobile' && cached.data.mobile) ||
      (targetStrategy === 'desktop' && cached.data.desktop)
    ) {
      return {
        ...cached.data,
        cached: true,
      };
    }
  }

  // Deduplicate simultaneous full/strategy requests for the same URL before DNS/SSRF/upstream calls
  const combinedInFlightKey = `${cacheKey}::${targetStrategy}`;
  const existingCombined = (pageSpeedCache as any).__inflightCombined?.get(combinedInFlightKey);
  if (existingCombined) {
    return await existingCombined;
  }
  if (!(pageSpeedCache as any).__inflightCombined) {
    (pageSpeedCache as any).__inflightCombined = new Map<string, Promise<CombinedPageSpeedResult>>();
  }

  const combinedPromise = (async (): Promise<CombinedPageSpeedResult> => {
    // SSRF Validation: Block localhost, 127.0.0.1, private IPs, cloud metadata
    await validateTargetSecurity(domain);

    // Validate API key configuration with clear diagnostic error
    const keyConfig = getPageSpeedApiKey();
    if (keyConfig.diagnosticError) {
      console.error(`[PageSpeed Diagnostic]: ${keyConfig.diagnosticError}`);
      throw new PageSpeedServiceError(keyConfig.diagnosticError, 'PAGESPEED_KEY_MISSING', false);
    }
    const apiKey = keyConfig.key;

    // Rate Limiting Check
    if (!checkRateLimit()) {
      if (cached && !options.forceRefresh) {
        return {
          ...cached.data,
          cached: true,
        };
      }
      throw new PageSpeedServiceError(
        'Google PageSpeed analysis rate limit reached. Please wait a moment before requesting another analysis.',
        'PAGESPEED_RATE_LIMITED',
        true
      );
    }

    const [mobileSettled, desktopSettled] = await Promise.allSettled([
      shouldRunMobile ? runSingleStrategyAnalysis(url, 'mobile', apiKey) : Promise.resolve(null),
      shouldRunDesktop ? runSingleStrategyAnalysis(url, 'desktop', apiKey) : Promise.resolve(null),
    ]);

    const freshMobile = mobileSettled.status === 'fulfilled' ? mobileSettled.value : null;
    const freshDesktop = desktopSettled.status === 'fulfilled' ? desktopSettled.value : null;

    // Preserve previously cached valid data for the unrequested (or transiently failed) strategy so historical data is never wiped out
    const mobileData = freshMobile || cached?.data.mobile || null;
    const desktopData = desktopSettled.status === 'fulfilled' && freshDesktop ? freshDesktop : cached?.data.desktop || null;

    const errors: string[] = [];
    const rawErrors: string[] = [];
    let primaryErrorObj: PageSpeedServiceError | Error | null = null;

    if (shouldRunMobile && mobileSettled.status === 'rejected') {
      const reason = mobileSettled.reason;
      primaryErrorObj = primaryErrorObj || reason;
      const raw = reason?.message || 'Unknown error';
      errors.push(`Mobile: ${raw}`);
      rawErrors.push(raw);
    }
    if (shouldRunDesktop && desktopSettled.status === 'rejected') {
      const reason = desktopSettled.reason;
      primaryErrorObj = primaryErrorObj || reason;
      const raw = reason?.message || 'Unknown error';
      errors.push(`Desktop: ${raw}`);
      rawErrors.push(raw);
    }

    // If the requested strategy (or both) failed completely without producing any fresh result:
    if (
      (targetStrategy === 'mobile' && !freshMobile) ||
      (targetStrategy === 'desktop' && !freshDesktop) ||
      (targetStrategy === 'both' && !freshMobile && !freshDesktop)
    ) {
      const uniqueRaw = Array.from(new Set(rawErrors));
      const fullError = uniqueRaw.length === 1 ? uniqueRaw[0] : errors.join('; ');
      if (primaryErrorObj instanceof PageSpeedServiceError) {
        throw new PageSpeedServiceError(
          fullError || primaryErrorObj.message,
          primaryErrorObj.code,
          primaryErrorObj.retryable,
          primaryErrorObj.upstreamStatus
        );
      }
      throw new Error(fullError || 'Google PageSpeed Insights analysis failed.');
    }

    const combinedResult: CombinedPageSpeedResult = {
      url,
      domain,
      scannedAt: new Date().toISOString(),
      mobile: mobileData,
      desktop: desktopData,
      cached: false,
      error: errors.length > 0 ? errors.join(' | ') : null,
    };

    if (mobileData || desktopData) {
      pageSpeedCache.set(cacheKey, {
        data: combinedResult,
        timestamp: Date.now(),
      });
    }

    return combinedResult;
  })();

  (pageSpeedCache as any).__inflightCombined.set(combinedInFlightKey, combinedPromise);
  try {
    return await combinedPromise;
  } finally {
    (pageSpeedCache as any).__inflightCombined.delete(combinedInFlightKey);
  }
}

export function clearPageSpeedCache(): void {
  pageSpeedCache.clear();
  inFlightStrategyRequests.clear();
}

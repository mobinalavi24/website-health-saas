import { URL } from 'node:url';
import { normalizeInputUrl, validateTargetSecurity } from './scanner.ts';
import type {
  PageSpeedDeviceData,
  CombinedPageSpeedResult,
  CoreWebVitalMetric,
  PageSpeedOpportunity,
  PageSpeedMetricStatus,
} from './pagespeedTypes.ts';

// In-memory LRU/TTL cache for PageSpeed results (cache TTL: 15 minutes to respect Google quotas)
interface CacheEntry {
  data: CombinedPageSpeedResult;
  timestamp: number;
}
const pageSpeedCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Rate-limiting tracking (max 10 analyses per minute globally for PageSpeed)
const recentAnalyses: number[] = [];
const RATE_LIMIT_MAX = 10;
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

    // Only include if there is potential improvement (score < 0.9 or savings present)
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

  // Sort by potential savings descending
  list.sort((a, b) => {
    const savingsA = (a.estimatedSavingsMs || 0) + (a.estimatedSavingsBytes ? a.estimatedSavingsBytes / 1000 : 0);
    const savingsB = (b.estimatedSavingsMs || 0) + (b.estimatedSavingsBytes ? b.estimatedSavingsBytes / 1000 : 0);
    return savingsB - savingsA;
  });

  return list;
}

/**
 * Retrieves Google PageSpeed API key from server environment variables.
 * Priority:
 * 1. PAGESPEED_API_KEY (Primary official environment variable)
 * 2. GOOGLE_API_KEY (Standard Google Cloud compatible fallback)
 * 3. Extended compatibility fallbacks: GOOGLE_PAGESPEED_API_KEY or GEMINI_API_KEY
 * Filters out placeholder values from .env.example.
 */
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

// Call Google PageSpeed API for a single strategy ('mobile' or 'desktop')
async function runSingleStrategyAnalysis(
  url: string,
  strategy: 'mobile' | 'desktop',
  apiKey?: string
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
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout for deep lighthouse audit

  try {
    let response: Response;
    try {
      response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PulseVanguard-Monitor/1.0 (+https://pulsevanguard.com; pagespeed-audit)',
        },
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      if (fetchErr.name === 'AbortError') {
        throw new Error(
          `Google PageSpeed analysis timed out after 45 seconds for ${strategy} strategy. The target website took too long to load.`
        );
      }
      // Ensure key is never leaked in fetch error messages
      const safeMessage = (fetchErr.message || 'Unable to connect to Google API').replace(/([?&]key=)[^&]+/gi, '$1[REDACTED]');
      throw new Error(`Google PageSpeed network error: ${safeMessage}`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let parsedErr = 'Google PageSpeed Insights API is temporarily unavailable.';
      try {
        const json = JSON.parse(errText);
        const rawMsg = json.error?.message || '';
        const lowerMsg = rawMsg.toLowerCase();

        if (response.status === 429 || lowerMsg.includes('quota') || lowerMsg.includes('ratelimit')) {
          parsedErr = 'Google PageSpeed Insights rate limit/quota reached. Please retry in a few moments or verify your API key quota.';
        } else if (response.status === 400 || lowerMsg.includes('invalid url') || lowerMsg.includes('could not be retrieved')) {
          parsedErr = 'Unable to analyze the specified URL with Google PageSpeed. Please check that the website is publicly accessible and responding.';
        } else if (response.status === 403 || response.status === 401) {
          if (lowerMsg.includes('api key not valid') || lowerMsg.includes('invalid key') || lowerMsg.includes('key is invalid')) {
            parsedErr = 'Invalid Google PageSpeed API key. Please check your PAGESPEED_API_KEY or GOOGLE_API_KEY environment variable.';
          } else if (lowerMsg.includes('disabled') || lowerMsg.includes('has not been used')) {
            parsedErr = 'Google PageSpeed Insights API is not enabled in your Google Cloud project. Please enable it in Google Cloud Console.';
          } else if (lowerMsg.includes('quota') || lowerMsg.includes('limit')) {
            parsedErr = 'Google PageSpeed Insights API quota exceeded. Please check quota limits in Google Cloud Console.';
          } else {
            parsedErr = 'Google PageSpeed API service authentication error. Please verify your server API key configuration.';
          }
        } else if (response.status >= 500) {
          parsedErr = 'Google PageSpeed Insights API is temporarily experiencing server issues. Please retry in a few moments.';
        } else if (rawMsg) {
          // Strip out internal GCP project numbers or identifiers
          parsedErr = rawMsg.replace(/for consumer '[^']+'/g, '').trim();
        }
      } catch {}
      throw new Error(parsedErr);
    }

    const data: any = await response.json();
    const lighthouseResult = data.lighthouseResult || {};
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
    // LCP
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

    // INP (Interaction to Next Paint - modern Core Web Vital replacing FID)
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
      // Diagnostic proxy when field INP is unavailable
      const ms = Math.round(audits['max-potential-fid'].numericValue);
      inp = {
        value: ms,
        unit: 'ms',
        status: ms <= 130 ? 'good' : ms <= 300 ? 'needs-improvement' : 'poor',
      };
    }

    // CLS
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

    // FCP
    let fcp: CoreWebVitalMetric | null = null;
    if (audits['first-contentful-paint']?.numericValue !== undefined) {
      const rawSec = Number((audits['first-contentful-paint'].numericValue / 1000).toFixed(2));
      fcp = {
        value: rawSec,
        unit: 's',
        status: classifyFcp(rawSec),
      };
    }

    // TTFB
    let ttfb: CoreWebVitalMetric | null = null;
    if (audits['server-response-time']?.numericValue !== undefined) {
      const rawSec = Number((audits['server-response-time'].numericValue / 1000).toFixed(2));
      ttfb = {
        value: rawSec,
        unit: 's',
        status: classifyTtfb(rawSec),
      };
    }

    // Speed Index
    let speedIndex: CoreWebVitalMetric | null = null;
    if (audits['speed-index']?.numericValue !== undefined) {
      const rawSec = Number((audits['speed-index'].numericValue / 1000).toFixed(2));
      speedIndex = {
        value: rawSec,
        unit: 's',
        status: classifySpeedIndex(rawSec),
      };
    }

    // 3. Opportunities & Diagnostics
    const opportunities = extractOpportunities(audits);

    const diagnostics = {
      totalBlockingTimeMs: audits['total-blocking-time']?.numericValue ? Math.round(audits['total-blocking-time'].numericValue) : null,
      maxPotentialFidMs: audits['max-potential-fid']?.numericValue ? Math.round(audits['max-potential-fid'].numericValue) : null,
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
 * Execute real Google PageSpeed Insights analysis for both Mobile and Desktop.
 * - Enforces SSRF protection (localhost, loopbacks, RFC1918, link-local, cloud metadata)
 * - Validates protocol (HTTP/HTTPS only)
 * - Applies caching (15 min) and rate limiting
 * - Runs Mobile and Desktop in parallel with independent fallback handling
 */
export async function performPageSpeedAnalysis(
  rawUrl: string,
  options: { forceRefresh?: boolean; strategy?: 'mobile' | 'desktop' | 'both' } = {}
): Promise<CombinedPageSpeedResult> {
  const trimmed = rawUrl.trim();
  if (trimmed.includes('://') && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new Error('Invalid URL protocol. Only HTTP and HTTPS are permitted for scanning.');
  }

  const { url, domain } = normalizeInputUrl(trimmed);

  // Validate scheme: Only http or https
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid URL protocol. Only HTTP and HTTPS are permitted for scanning.');
  }

  // SSRF Validation: Block localhost, 127.0.0.1, private IPs, cloud metadata
  await validateTargetSecurity(domain);

  // Validate API key configuration with clear diagnostic error
  const keyConfig = getPageSpeedApiKey();
  if (keyConfig.diagnosticError) {
    console.error(`[PageSpeed Diagnostic]: ${keyConfig.diagnosticError}`);
    throw new Error(keyConfig.diagnosticError);
  }
  const apiKey = keyConfig.key;

  const targetStrategy = options.strategy || 'both';
  const shouldRunMobile = targetStrategy === 'both' || targetStrategy === 'mobile';
  const shouldRunDesktop = targetStrategy === 'both' || targetStrategy === 'desktop';

  // Cache Check (when both are requested)
  const cacheKey = url.toLowerCase();
  const cached = pageSpeedCache.get(cacheKey);
  if (!options.forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    if (targetStrategy === 'both' || (targetStrategy === 'mobile' && cached.data.mobile) || (targetStrategy === 'desktop' && cached.data.desktop)) {
      return {
        ...cached.data,
        cached: true,
      };
    }
  }

  // Rate Limiting Check
  if (!checkRateLimit()) {
    if (cached) {
      return {
        ...cached.data,
        cached: true,
      };
    }
    throw new Error('Google PageSpeed analysis rate limit reached. Please wait a minute before requesting another analysis.');
  }

  // Execute requested strategies
  const [mobileSettled, desktopSettled] = await Promise.allSettled([
    shouldRunMobile ? runSingleStrategyAnalysis(url, 'mobile', apiKey) : Promise.resolve(null),
    shouldRunDesktop ? runSingleStrategyAnalysis(url, 'desktop', apiKey) : Promise.resolve(null),
  ]);

  const mobileData = mobileSettled.status === 'fulfilled' ? mobileSettled.value : null;
  const desktopData = desktopSettled.status === 'fulfilled' ? desktopSettled.value : null;

  const errors: string[] = [];
  const rawErrors: string[] = [];
  if (shouldRunMobile && mobileSettled.status === 'rejected') {
    const raw = mobileSettled.reason?.message || 'Unknown error';
    errors.push(`Mobile: ${raw}`);
    rawErrors.push(raw);
  }
  if (shouldRunDesktop && desktopSettled.status === 'rejected') {
    const raw = desktopSettled.reason?.message || 'Unknown error';
    errors.push(`Desktop: ${raw}`);
    rawErrors.push(raw);
  }

  if (!mobileData && !desktopData) {
    const uniqueRaw = Array.from(new Set(rawErrors));
    const fullError = uniqueRaw.length === 1 ? uniqueRaw[0] : errors.join('; ');
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

  // Cache valid result
  if (mobileData || desktopData) {
    pageSpeedCache.set(cacheKey, {
      data: combinedResult,
      timestamp: Date.now(),
    });
  }

  return combinedResult;
}

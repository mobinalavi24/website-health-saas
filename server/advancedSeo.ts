import { URL } from 'node:url';
import type {
  AdvancedSeoResult,
  SeoIssue,
  TitleAnalysis,
  MetaDescriptionAnalysis,
  CanonicalAnalysis,
  OpenGraphAnalysis,
  TwitterCardAnalysis,
  StructuredDataAnalysis,
  JsonLdItem,
  CrawlabilityAnalysis,
  IndexabilityAnalysis,
  TechnicalSeoAnalysis,
  HeadingStructureAnalysis,
  ImageSeoAnalysis,
  LinksAnalysis,
  InternationalizationAnalysis,
  HreflangTag,
  DuplicateConflictAnalysis,
  SeoScoreBreakdown,
} from './seoTypes.ts';

interface ScanContext {
  url: string;
  domain: string;
  finalUrl: string;
  httpStatus: number;
  httpStatusText: string;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseTimeMs: number;
  ssl: {
    valid: boolean;
    daysRemaining: number;
    protocol?: string;
  };
  robotsTxtBody?: string | null;
  robotsTxtStatus?: number;
  sitemapBody?: string | null;
  sitemapStatus?: number;
  sitemapUrl?: string;
}

// Helper: match all regex occurrences
function matchAll(regex: RegExp, text: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const r = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let match: RegExpExecArray | null;
  while ((match = r.exec(text)) !== null) {
    matches.push(match);
  }
  return matches;
}

// Helper: safe attribute extraction from an HTML tag string
function getAttr(tag: string, attrName: string): string | undefined {
  const regex = new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, 'i');
  const match = tag.match(regex);
  return match ? match[1].trim() : undefined;
}

// 1. Analyze Title
export function analyzeTitle(html: string): TitleAnalysis {
  const titleMatches = matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi, html);
  const issues: string[] = [];

  if (titleMatches.length === 0) {
    issues.push('Missing <title> element.');
    return {
      exists: false,
      characterCount: 0,
      severity: 'critical',
      issues,
    };
  }

  const rawTitle = titleMatches[0][1].replace(/\s+/g, ' ').trim();
  const characterCount = rawTitle.length;

  if (titleMatches.length > 1) {
    issues.push(`Multiple <title> tags detected (${titleMatches.length}). Search engines will only use one.`);
  }

  if (characterCount === 0) {
    issues.push('Title element is present but completely empty.');
    return {
      exists: true,
      value: '',
      characterCount: 0,
      severity: 'critical',
      issues,
    };
  }

  let severity: 'good' | 'warning' | 'critical' = 'good';

  if (characterCount < 25) {
    severity = 'warning';
    issues.push(`Extremely short title (${characterCount} characters). Recommended length for optimal search snippet display is 30–60 characters.`);
  } else if (characterCount > 65) {
    severity = 'warning';
    issues.push(`Title is ${characterCount} characters. Search engines typically truncate titles exceeding ~60 characters.`);
  }

  return {
    exists: true,
    value: rawTitle,
    characterCount,
    severity,
    issues,
  };
}

// 2. Analyze Meta Description
export function analyzeMetaDescription(html: string): MetaDescriptionAnalysis {
  // Support both name="description" content="..." and content="..." name="description"
  const metaTags = matchAll(/<meta[^>]*>/gi, html);
  const descMatches: string[] = [];

  for (const m of metaTags) {
    const tag = m[0];
    const name = getAttr(tag, 'name')?.toLowerCase();
    if (name === 'description') {
      const content = getAttr(tag, 'content');
      if (content !== undefined) {
        descMatches.push(content.trim());
      }
    }
  }

  const issues: string[] = [];

  if (descMatches.length === 0) {
    issues.push('Missing <meta name="description"> tag.');
    return {
      exists: false,
      characterCount: 0,
      severity: 'warning',
      issues,
    };
  }

  const desc = descMatches[0];
  const characterCount = desc.length;

  if (descMatches.length > 1) {
    issues.push(`Multiple meta description tags found (${descMatches.length}). Search engines may pick an arbitrary tag.`);
  }

  if (characterCount === 0) {
    issues.push('Meta description tag is present but empty.');
    return {
      exists: true,
      value: '',
      characterCount: 0,
      severity: 'warning',
      issues,
    };
  }

  let severity: 'good' | 'warning' | 'critical' = 'good';

  if (characterCount < 60) {
    severity = 'warning';
    issues.push(`Short meta description (${characterCount} characters). 120–160 characters provides a descriptive snippet.`);
  } else if (characterCount > 165) {
    severity = 'warning';
    issues.push(`Long meta description (${characterCount} characters). Snippets exceeding ~160 characters are usually truncated.`);
  }

  return {
    exists: true,
    value: desc,
    characterCount,
    severity,
    issues,
  };
}

// 3. Analyze Canonical
export function analyzeCanonical(html: string, pageUrl: string): CanonicalAnalysis {
  const linkTags = matchAll(/<link[^>]*>/gi, html);
  const canonicalHrefs: string[] = [];

  for (const m of linkTags) {
    const tag = m[0];
    const rel = getAttr(tag, 'rel')?.toLowerCase();
    if (rel === 'canonical') {
      const href = getAttr(tag, 'href');
      if (href) canonicalHrefs.push(href.trim());
    }
  }

  const issues: string[] = [];
  if (canonicalHrefs.length === 0) {
    issues.push('No canonical URL specified (<link rel="canonical">). Adding one helps prevent duplicate content indexing.');
    return {
      exists: false,
      isAbsolute: false,
      isHttps: false,
      isSameDomain: false,
      multipleTags: false,
      tagsCount: 0,
      crossDomain: false,
      issues,
    };
  }

  const canonicalUrl = canonicalHrefs[0];
  const multipleTags = canonicalHrefs.length > 1;
  if (multipleTags) {
    issues.push(`Multiple canonical tags detected (${canonicalHrefs.length}). Search engines may ignore conflicting canonical directives.`);
  }

  let isAbsolute = false;
  let isHttps = false;
  let isSameDomain = true;
  let crossDomain = false;

  try {
    const parsedPage = new URL(pageUrl);
    const parsedCanonical = new URL(canonicalUrl, pageUrl);

    isAbsolute = canonicalUrl.startsWith('http://') || canonicalUrl.startsWith('https://');
    if (!isAbsolute) {
      issues.push('Canonical tag uses a relative path. Search engines recommend absolute URLs for canonical directives.');
    }

    isHttps = parsedCanonical.protocol === 'https:';
    if (parsedPage.protocol === 'https:' && parsedCanonical.protocol === 'http:') {
      issues.push('HTTP canonical specified on an HTTPS page. This can cause indexation confusion.');
    }

    isSameDomain = parsedCanonical.hostname.toLowerCase() === parsedPage.hostname.toLowerCase();
    crossDomain = !isSameDomain;

    if (crossDomain) {
      issues.push(`Cross-domain canonical detected to "${parsedCanonical.hostname}". Ensure this is intentional for syndicated content.`);
    }
  } catch {
    issues.push(`Invalid canonical URL format: "${canonicalUrl}".`);
  }

  return {
    exists: true,
    url: canonicalUrl,
    isAbsolute,
    isHttps,
    isSameDomain,
    multipleTags,
    tagsCount: canonicalHrefs.length,
    crossDomain,
    issues,
  };
}

// 4. Analyze Open Graph
export function analyzeOpenGraph(html: string): OpenGraphAnalysis {
  const metaTags = matchAll(/<meta[^>]*>/gi, html);
  const ogMap = new Map<string, string[]>();

  for (const m of metaTags) {
    const tag = m[0];
    const property = (getAttr(tag, 'property') || getAttr(tag, 'name') || '').toLowerCase();
    if (property.startsWith('og:')) {
      const content = getAttr(tag, 'content');
      if (content !== undefined) {
        const list = ogMap.get(property) || [];
        list.push(content.trim());
        ogMap.set(property, list);
      }
    }
  }

  const duplicateTags: string[] = [];
  ogMap.forEach((values, key) => {
    if (values.length > 1) duplicateTags.push(key);
  });

  const getOg = (key: string): { present: boolean; value?: string } => {
    const val = ogMap.get(key)?.[0];
    return { present: Boolean(val), value: val };
  };

  const title = getOg('og:title');
  const description = getOg('og:description');
  const rawImage = getOg('og:image');
  const url = getOg('og:url');
  const type = getOg('og:type');
  const siteName = getOg('og:site_name');

  let imageValidUrl = false;
  if (rawImage.value) {
    try {
      new URL(rawImage.value);
      imageValidUrl = true;
    } catch {
      imageValidUrl = false;
    }
  }

  const image = {
    present: rawImage.present,
    value: rawImage.value,
    isValidUrl: imageValidUrl,
  };

  const issues: string[] = [];
  const present = ogMap.size > 0;

  if (!present) {
    issues.push('No Open Graph meta tags detected. Social sharing cards on Facebook, LinkedIn, Slack, and Discord will display unoptimized previews.');
  } else {
    if (!title.present) issues.push('Missing "og:title" for social sharing preview.');
    if (!description.present) issues.push('Missing "og:description" for social sharing preview.');
    if (!image.present) issues.push('Missing "og:image" tag. Shared links will lack a preview thumbnail on social platforms.');
    else if (!image.isValidUrl) issues.push(`The "og:image" URL "${image.value}" is not a valid absolute URL.`);
    if (!url.present) issues.push('Missing "og:url" canonical social URL.');
    if (duplicateTags.length > 0) {
      issues.push(`Duplicate Open Graph tags detected for: ${duplicateTags.join(', ')}.`);
    }
  }

  return {
    present,
    title,
    description,
    image,
    url,
    type,
    siteName,
    duplicateTags,
    issues,
  };
}

// 5. Analyze Twitter Cards
export function analyzeTwitterCard(html: string): TwitterCardAnalysis {
  const metaTags = matchAll(/<meta[^>]*>/gi, html);
  const twitterMap = new Map<string, string[]>();

  for (const m of metaTags) {
    const tag = m[0];
    const name = (getAttr(tag, 'name') || getAttr(tag, 'property') || '').toLowerCase();
    if (name.startsWith('twitter:')) {
      const content = getAttr(tag, 'content');
      if (content !== undefined) {
        const list = twitterMap.get(name) || [];
        list.push(content.trim());
        twitterMap.set(name, list);
      }
    }
  }

  const duplicateTags: string[] = [];
  twitterMap.forEach((values, key) => {
    if (values.length > 1) duplicateTags.push(key);
  });

  const getTw = (key: string): { present: boolean; value?: string } => {
    const val = twitterMap.get(key)?.[0];
    return { present: Boolean(val), value: val };
  };

  const card = getTw('twitter:card');
  const title = getTw('twitter:title');
  const description = getTw('twitter:description');
  const rawImage = getTw('twitter:image');
  const site = getTw('twitter:site');
  const creator = getTw('twitter:creator');

  let imageValidUrl = false;
  if (rawImage.value) {
    try {
      new URL(rawImage.value);
      imageValidUrl = true;
    } catch {
      imageValidUrl = false;
    }
  }

  const image = {
    present: rawImage.present,
    value: rawImage.value,
    isValidUrl: imageValidUrl,
  };

  const issues: string[] = [];
  const present = twitterMap.size > 0;

  if (!present) {
    issues.push('No Twitter Card meta tags found. Links shared on X/Twitter will display basic unexpanded text.');
  } else {
    if (!card.present) issues.push('Missing "twitter:card" tag (e.g. summary or summary_large_image).');
    if (!title.present) issues.push('Missing "twitter:title".');
    if (!description.present) issues.push('Missing "twitter:description".');
    if (!image.present) issues.push('Missing "twitter:image" preview thumbnail.');
    if (duplicateTags.length > 0) {
      issues.push(`Duplicate Twitter meta tags found for: ${duplicateTags.join(', ')}.`);
    }
  }

  return {
    present,
    card,
    title,
    description,
    image,
    site,
    creator,
    duplicateTags,
    issues,
  };
}

// 6. Analyze Structured Data / JSON-LD
export function analyzeStructuredData(html: string): StructuredDataAnalysis {
  const scriptMatches = matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, html);
  const items: JsonLdItem[] = [];
  const schemaTypesSet = new Set<string>();
  let hasValid = false;
  let hasInvalid = false;

  const extractTypes = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(extractTypes);
      return;
    }
    if (obj['@type']) {
      if (Array.isArray(obj['@type'])) {
        obj['@type'].forEach((t: any) => typeof t === 'string' && schemaTypesSet.add(t));
      } else if (typeof obj['@type'] === 'string') {
        schemaTypesSet.add(obj['@type']);
      }
    }
    if (Array.isArray(obj['@graph'])) {
      obj['@graph'].forEach(extractTypes);
    }
  };

  for (const m of scriptMatches) {
    const rawContent = m[1].trim();
    const preview = rawContent.length > 120 ? rawContent.substring(0, 120) + '...' : rawContent;

    try {
      const parsed = JSON.parse(rawContent);
      hasValid = true;
      const isGraph = Boolean(parsed && typeof parsed === 'object' && Array.isArray(parsed['@graph']));
      const context = parsed['@context'] || (isGraph && parsed['@graph']?.[0]?.['@context']) || undefined;
      const type = parsed['@type'] || (isGraph ? 'Graph' : undefined);

      extractTypes(parsed);

      const validationErrors: string[] = [];
      if (!context) {
        validationErrors.push('Missing @context declaration (expected schema.org).');
      }
      if (!type && !isGraph) {
        validationErrors.push('Missing @type declaration in structured data.');
      }

      items.push({
        context: typeof context === 'string' ? context : undefined,
        type: typeof type === 'string' || Array.isArray(type) ? type : undefined,
        rawPreview: preview,
        validJson: true,
        validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
        isGraph,
      });
    } catch (parseErr: any) {
      hasInvalid = true;
      items.push({
        rawPreview: preview,
        validJson: false,
        validationErrors: [`Syntax error parsing JSON-LD: ${parseErr.message}`],
      });
    }
  }

  let validationStatus: 'valid' | 'invalid' | 'none' = 'none';
  if (items.length > 0) {
    validationStatus = hasInvalid ? 'invalid' : hasValid ? 'valid' : 'invalid';
  }

  const schemasFound = Array.from(schemaTypesSet);
  let validationSummary = '';
  if (items.length === 0) {
    validationSummary = 'No JSON-LD structured data detected.';
  } else if (validationStatus === 'valid') {
    validationSummary = `Found ${items.length} valid JSON-LD block(s) with ${schemasFound.length} Schema.org type(s): ${schemasFound.join(', ') || 'General'}.`;
  } else {
    validationSummary = `Detected ${items.length} JSON-LD block(s), but one or more contains syntax or schema errors.`;
  }

  const disclaimer =
    'Note: This analysis performs basic JSON syntax and Schema.org structural validation. It is not an evaluation of Google Rich Results eligibility or search feature inclusion.';

  return {
    present: items.length > 0,
    blocksCount: items.length,
    schemasFound,
    items,
    validationStatus,
    validationSummary,
    disclaimer,
  };
}

// 7. Analyze Crawlability & Indexability
export function analyzeCrawlability(
  html: string,
  headers: Record<string, string>,
  ctx: ScanContext
): { crawlability: CrawlabilityAnalysis; indexability: IndexabilityAnalysis } {
  // 1. Robots Meta
  const metaTags = matchAll(/<meta[^>]*>/gi, html);
  const robotsDirectives: string[] = [];
  const googlebotDirectives: string[] = [];
  let robotsTagCount = 0;

  for (const m of metaTags) {
    const tag = m[0];
    const name = (getAttr(tag, 'name') || '').toLowerCase();
    const content = getAttr(tag, 'content') || '';

    if (name === 'robots') {
      robotsTagCount++;
      content.split(',').forEach((d) => {
        const cleaned = d.trim().toLowerCase();
        if (cleaned) robotsDirectives.push(cleaned);
      });
    } else if (name === 'googlebot') {
      content.split(',').forEach((d) => {
        const cleaned = d.trim().toLowerCase();
        if (cleaned) googlebotDirectives.push(cleaned);
      });
    }
  }

  // 2. X-Robots-Tag HTTP header
  const xRobotsHeader = headers['x-robots-tag'];
  const xRobotsDirectives: string[] = [];
  if (xRobotsHeader) {
    xRobotsHeader.split(',').forEach((d) => {
      const cleaned = d.trim().toLowerCase();
      if (cleaned) xRobotsDirectives.push(cleaned);
    });
  }

  // Directive conflicts check
  const directiveConflicts: string[] = [];
  const htmlHasNoindex = robotsDirectives.includes('noindex') || googlebotDirectives.includes('noindex');
  const httpHasNoindex = xRobotsDirectives.includes('noindex');

  if (htmlHasNoindex && (robotsDirectives.includes('index') || googlebotDirectives.includes('index'))) {
    directiveConflicts.push('Conflicting directives in HTML robots tag: both "index" and "noindex" declared.');
  }

  if (httpHasNoindex && (robotsDirectives.includes('index') || (!htmlHasNoindex && robotsDirectives.length > 0))) {
    directiveConflicts.push('Conflict: HTML robots tag permits indexing, but HTTP X-Robots-Tag specifies "noindex". The HTTP noindex directive takes precedence.');
  }

  // 3. Robots.txt analysis
  const robotsTxtRaw = ctx.robotsTxtBody || '';
  const robotsTxtLines = robotsTxtRaw.split('\n');
  const sitemapsDeclared: string[] = [];
  let userAgentGroupsCount = 0;
  let disallowRulesCount = 0;
  let allowRulesCount = 0;
  let hasDisallowAll = false;

  if (ctx.robotsTxtStatus === 200 && robotsTxtRaw.trim().length > 0) {
    for (const rawLine of robotsTxtLines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const lower = line.toLowerCase();
      if (lower.startsWith('user-agent:')) {
        userAgentGroupsCount++;
      } else if (lower.startsWith('disallow:')) {
        disallowRulesCount++;
        const path = line.split(':')[1]?.trim();
        if (path === '/') {
          hasDisallowAll = true;
        }
      } else if (lower.startsWith('allow:')) {
        allowRulesCount++;
      } else if (lower.startsWith('sitemap:')) {
        const sitemapUrl = line.substring(line.indexOf(':') + 1).trim();
        if (sitemapUrl) sitemapsDeclared.push(sitemapUrl);
      }
    }
  }

  // 4. Sitemap analysis
  const sitemapRaw = ctx.sitemapBody || '';
  let validXml = false;
  let isSitemapIndex = false;
  let urlCount: number | undefined;
  let lastModifiedDatesCount: number | undefined;

  if (ctx.sitemapStatus === 200 && sitemapRaw.trim().length > 0) {
    if (sitemapRaw.includes('<?xml') || sitemapRaw.includes('<urlset') || sitemapRaw.includes('<sitemapindex')) {
      validXml = true;
      if (sitemapRaw.includes('<sitemapindex')) {
        isSitemapIndex = true;
        const sitemapMatches = sitemapRaw.match(/<sitemap>/gi);
        urlCount = sitemapMatches ? sitemapMatches.length : undefined;
      } else {
        const locMatches = sitemapRaw.match(/<loc>/gi);
        urlCount = locMatches ? locMatches.length : undefined;
      }
      const lastModMatches = sitemapRaw.match(/<lastmod>/gi);
      lastModifiedDatesCount = lastModMatches ? lastModMatches.length : 0;
    }
  }

  const crawlability: CrawlabilityAnalysis = {
    robotsMeta: {
      exists: robotsTagCount > 0,
      tagCount: robotsTagCount,
      directives: robotsDirectives,
    },
    googlebotMeta: {
      exists: googlebotDirectives.length > 0,
      directives: googlebotDirectives,
    },
    xRobotsTag: {
      exists: Boolean(xRobotsHeader),
      directives: xRobotsDirectives,
    },
    directiveConflicts,
    robotsTxt: {
      exists: ctx.robotsTxtStatus === 200,
      accessible: ctx.robotsTxtStatus === 200,
      httpStatus: ctx.robotsTxtStatus,
      sitemapsDeclared,
      userAgentGroupsCount,
      hasDisallowAll,
      disallowRulesCount,
      allowRulesCount,
    },
    sitemap: {
      exists: ctx.sitemapStatus === 200,
      accessible: ctx.sitemapStatus === 200,
      url: ctx.sitemapUrl,
      httpStatus: ctx.sitemapStatus,
      contentType: headers['content-type'],
      validXml,
      isSitemapIndex,
      urlCount,
      lastModifiedDatesCount,
    },
  };

  // 5. Unified Indexability Analysis
  let status: IndexabilityAnalysis['status'] = 'indexable';
  const reasons: string[] = [];

  if (ctx.httpStatus >= 400) {
    status = 'blocked';
    reasons.push(`Target returned HTTP error status ${ctx.httpStatus} (${ctx.httpStatusText}). Non-200 pages cannot be indexed.`);
  } else if (ctx.httpStatus >= 300 && ctx.httpStatus < 400) {
    status = 'redirected';
    reasons.push(`Page returned redirect status ${ctx.httpStatus}. Search engines will index the target destination rather than this URL.`);
  } else if (ctx.finalUrl !== ctx.url && new URL(ctx.finalUrl).pathname !== new URL(ctx.url).pathname) {
    status = 'redirected';
    reasons.push(`Request redirected to "${ctx.finalUrl}". Search engines evaluate the destination canonical URL.`);
  }

  if (htmlHasNoindex) {
    status = 'blocked';
    reasons.push('HTML <meta name="robots" content="noindex"> directive prevents search engine indexation.');
  }

  if (httpHasNoindex) {
    status = 'blocked';
    reasons.push('HTTP response header "X-Robots-Tag: noindex" blocks search engine indexing at transport level.');
  }

  if (hasDisallowAll && status !== 'blocked') {
    reasons.push('Robots.txt contains "Disallow: /" rule which instructs bots not to crawl this endpoint.');
  }

  if (reasons.length === 0) {
    reasons.push('No technical indexing blockers detected. Page returns HTTP 200, permits crawling, and does not declare noindex.');
  }

  const technicalExplanation =
    'Indexability indicates whether search engine crawlers are technically permitted to crawl, render, and index this specific page based on HTTP status, robots tags, X-Robots-Tag headers, and robots.txt directives.';

  const indexability: IndexabilityAnalysis = {
    status,
    reasons,
    technicalExplanation,
  };

  return { crawlability, indexability };
}

// 8. Analyze Headings Structure
export function analyzeHeadings(html: string): HeadingStructureAnalysis {
  const h1Matches = matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, html);
  const h2Matches = matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, html);
  const h3Matches = matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, html);

  const cleanText = (raw: string) => raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  const h1Texts = h1Matches.map((m) => cleanText(m[1])).filter(Boolean);

  const headingsHierarchy: { tag: 'h1' | 'h2' | 'h3'; text: string }[] = [];
  const allHeadings = matchAll(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi, html);
  for (const h of allHeadings) {
    const tag = h[1].toLowerCase() as 'h1' | 'h2' | 'h3';
    const text = cleanText(h[2]);
    if (text) {
      headingsHierarchy.push({ tag, text: text.length > 70 ? text.substring(0, 70) + '...' : text });
    }
  }

  const issues: string[] = [];
  const hierarchyGaps: string[] = [];

  if (h1Matches.length === 0) {
    issues.push('Missing <h1> heading tag. An H1 provides primary topic context for users and search crawlers.');
  } else if (h1Matches.length > 1) {
    issues.push(`Multiple <h1> tags detected (${h1Matches.length}). While HTML5 allows multiple H1s, maintaining a single clear H1 per page is a recommended heading hierarchy practice.`);
  }

  // Hierarchy sequence check
  let seenH1 = false;
  let seenH2 = false;
  for (const h of headingsHierarchy) {
    if (h.tag === 'h1') seenH1 = true;
    if (h.tag === 'h2') seenH2 = true;
    if (h.tag === 'h3' && !seenH2 && seenH1) {
      hierarchyGaps.push('Detected <h3> heading without an intervening <h2> parent section.');
      break;
    }
  }

  return {
    h1Count: h1Matches.length,
    h2Count: h2Matches.length,
    h3Count: h3Matches.length,
    h1Texts,
    headingsHierarchy: headingsHierarchy.slice(0, 15),
    hierarchyGaps,
    issues,
  };
}

// 9. Analyze Images
export function analyzeImages(html: string): ImageSeoAnalysis {
  const imgTags = matchAll(/<img[^>]*>/gi, html);
  let imagesWithAlt = 0;
  let decorativeImages = 0;
  let missingAlt = 0;
  let imagesWithDimensions = 0;
  let lazyLoadedImages = 0;

  for (const m of imgTags) {
    const tag = m[0];
    const alt = getAttr(tag, 'alt');
    const width = getAttr(tag, 'width');
    const height = getAttr(tag, 'height');
    const loading = getAttr(tag, 'loading')?.toLowerCase();

    if (alt === undefined) {
      missingAlt++;
    } else if (alt.trim() === '') {
      decorativeImages++; // Intentionally empty alt="" is valid for decorative images
    } else {
      imagesWithAlt++;
    }

    if (width && height) {
      imagesWithDimensions++;
    }

    if (loading === 'lazy') {
      lazyLoadedImages++;
    }
  }

  const totalImages = imgTags.length;
  const altCoveragePercent = totalImages === 0 ? 100 : Math.round(((imagesWithAlt + decorativeImages) / totalImages) * 100);

  return {
    totalImages,
    imagesWithAlt,
    decorativeImages,
    missingAlt,
    imagesWithDimensions,
    lazyLoadedImages,
    altCoveragePercent,
  };
}

// 10. Analyze Links
export function analyzeLinks(html: string, pageUrl: string): LinksAnalysis {
  const aTags = matchAll(/<a[^>]*>/gi, html);
  let internalLinks = 0;
  let externalLinks = 0;
  let emptyHrefCount = 0;
  let fragmentOnlyCount = 0;
  const issues: string[] = [];

  let pageHostname = '';
  try {
    pageHostname = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    // fallback
  }

  for (const m of aTags) {
    const tag = m[0];
    const href = getAttr(tag, 'href');

    if (href === undefined || href.trim() === '') {
      emptyHrefCount++;
      continue;
    }

    const trimmed = href.trim();
    if (trimmed.startsWith('#')) {
      fragmentOnlyCount++;
      continue;
    }

    if (trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
      continue;
    }

    try {
      const parsed = new URL(trimmed, pageUrl);
      if (parsed.hostname.toLowerCase() === pageHostname) {
        internalLinks++;
      } else {
        externalLinks++;
      }
    } catch {
      // Unparseable URL
    }
  }

  if (emptyHrefCount > 0) {
    issues.push(`Found ${emptyHrefCount} link(s) with empty href attributes.`);
  }

  return {
    totalLinks: aTags.length,
    internalLinks,
    externalLinks,
    emptyHrefCount,
    fragmentOnlyCount,
    issues,
  };
}

// 11. Analyze Internationalization
export function analyzeInternationalization(html: string): InternationalizationAnalysis {
  const htmlTagMatch = html.match(/<html[^>]*>/i);
  const htmlTag = htmlTagMatch ? htmlTagMatch[0] : '';
  const langAttr = getAttr(htmlTag, 'lang');

  let isValidCode = false;
  if (langAttr) {
    // Valid RFC 5646 / BCP 47 code check: e.g. en, en-US, pt-BR, zh-Hant
    isValidCode = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(langAttr.trim());
  }

  const linkTags = matchAll(/<link[^>]*>/gi, html);
  const hreflangTags: HreflangTag[] = [];
  const langSet = new Set<string>();
  const duplicateDeclarations: string[] = [];

  for (const m of linkTags) {
    const tag = m[0];
    const rel = getAttr(tag, 'rel')?.toLowerCase();
    const hreflang = getAttr(tag, 'hreflang');
    const href = getAttr(tag, 'href');

    if (rel === 'alternate' && hreflang && href) {
      const cleanLang = hreflang.toLowerCase().trim();
      let isValidUrl = false;
      try {
        new URL(href);
        isValidUrl = true;
      } catch {
        isValidUrl = false;
      }

      if (langSet.has(cleanLang)) {
        duplicateDeclarations.push(cleanLang);
      }
      langSet.add(cleanLang);

      hreflangTags.push({
        lang: cleanLang,
        href,
        isValidUrl,
      });
    }
  }

  return {
    htmlLang: {
      exists: Boolean(langAttr),
      value: langAttr,
      isValidCode,
    },
    hreflangCount: hreflangTags.length,
    languages: Array.from(langSet),
    hreflangTags,
    duplicateDeclarations,
  };
}

// 12. Analyze Technical SEO
export function analyzeTechnicalSeo(
  html: string,
  headers: Record<string, string>,
  ctx: ScanContext,
  canonical: CanonicalAnalysis
): TechnicalSeoAnalysis {
  const hasHttps = ctx.url.startsWith('https://');
  const validCert = Boolean(ctx.ssl && ctx.ssl.valid);

  const viewportTag = html.match(/<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const viewportVal = viewportTag ? viewportTag[1] : undefined;
  const isStandard = Boolean(viewportVal && viewportVal.includes('width=device-width'));

  const langMatch = html.match(/<html[^>]*lang=["']([^"']*)["'][^>]*>/i);
  const langVal = langMatch ? langMatch[1] : undefined;

  let consistent = true;
  let details = 'Canonical URL matches page target domain and protocol.';
  if (canonical.exists && canonical.url) {
    try {
      const p = new URL(ctx.url);
      const c = new URL(canonical.url, ctx.url);
      if (p.protocol !== c.protocol) {
        consistent = false;
        details = `Protocol mismatch: Page is ${p.protocol} while canonical is ${c.protocol}.`;
      } else if (p.hostname.toLowerCase() !== c.hostname.toLowerCase()) {
        consistent = false;
        details = `Domain mismatch: Canonical points to external domain "${c.hostname}".`;
      }
    } catch {
      consistent = false;
      details = 'Canonical URL could not be parsed.';
    }
  }

  const contentEncoding = headers['content-encoding'];
  const cacheControl = headers['cache-control'];
  const etag = headers['etag'];
  const expires = headers['expires'];

  return {
    https: {
      enabled: hasHttps,
      validCert,
      protocol: ctx.ssl.protocol,
    },
    canonicalConsistency: {
      consistent,
      details,
    },
    redirects: {
      hasRedirect: ctx.finalUrl !== ctx.url,
      initialUrl: ctx.url,
      finalUrl: ctx.finalUrl,
      status: ctx.httpStatus,
    },
    htmlLanguage: {
      exists: Boolean(langVal),
      value: langVal,
      isValidCode: Boolean(langVal && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(langVal)),
    },
    mobileViewport: {
      configured: Boolean(viewportVal),
      value: viewportVal,
      isStandard,
    },
    httpStatus: ctx.httpStatus,
    httpStatusText: ctx.httpStatusText,
    contentType: headers['content-type'] || 'text/html',
    compression: {
      enabled: Boolean(contentEncoding),
      encoding: contentEncoding,
    },
    caching: {
      cacheControl,
      etag,
      expires,
      hasCacheHeaders: Boolean(cacheControl || etag || expires),
    },
  };
}

// 13. Detect Conflicts
export function detectConflicts(
  title: TitleAnalysis,
  desc: MetaDescriptionAnalysis,
  canonical: CanonicalAnalysis,
  og: OpenGraphAnalysis,
  tw: TwitterCardAnalysis,
  crawl: CrawlabilityAnalysis,
  indexability: IndexabilityAnalysis
): DuplicateConflictAnalysis {
  const conflicts: DuplicateConflictAnalysis['conflicts'] = [];

  if (title.issues.some((i) => i.includes('Multiple <title>'))) {
    conflicts.push({
      type: 'multiple_titles',
      severity: 'critical',
      message: 'Multiple <title> tags detected in HTML head.',
    });
  }

  if (desc.issues.some((i) => i.includes('Multiple meta description'))) {
    conflicts.push({
      type: 'multiple_descriptions',
      severity: 'warning',
      message: 'Multiple <meta name="description"> tags found.',
    });
  }

  if (canonical.multipleTags) {
    conflicts.push({
      type: 'multiple_canonicals',
      severity: 'critical',
      message: 'Multiple <link rel="canonical"> tags declared.',
    });
    conflicts.push({
      type: 'conflicting_canonical_urls',
      severity: 'critical',
      message: 'Multiple conflicting canonical URL directives detected in HTML head.',
    });
  }

  if (canonical.issues.some((i) => i.includes('HTTP canonical specified on an HTTPS page'))) {
    conflicts.push({
      type: 'http_canonical_on_https_page',
      severity: 'warning',
      message: 'HTTP canonical specified on an HTTPS page, creating conflicting protocol signals.',
    });
  }

  if (og.duplicateTags.includes('og:title')) {
    conflicts.push({
      type: 'multiple_og_title',
      severity: 'warning',
      message: 'Multiple og:title tags declared. Social crawlers may pick an unpredictable title.',
    });
  }

  if (og.duplicateTags.includes('og:description')) {
    conflicts.push({
      type: 'multiple_og_description',
      severity: 'warning',
      message: 'Multiple og:description tags declared.',
    });
  }

  if (tw.duplicateTags.includes('twitter:title')) {
    conflicts.push({
      type: 'multiple_twitter_title',
      severity: 'warning',
      message: 'Multiple twitter:title tags declared.',
    });
  }

  if (og.duplicateTags.length > 0) {
    conflicts.push({
      type: 'duplicate_og_tags',
      severity: 'warning',
      message: `Duplicate Open Graph tags declared: ${og.duplicateTags.join(', ')}.`,
    });
  }

  if (tw.duplicateTags.length > 0) {
    conflicts.push({
      type: 'duplicate_twitter_tags',
      severity: 'warning',
      message: `Duplicate Twitter meta tags declared: ${tw.duplicateTags.join(', ')}.`,
    });
  }

  // Conflict: noindex + canonical
  if (indexability.status === 'blocked' && canonical.exists) {
    conflicts.push({
      type: 'noindex_with_canonical',
      severity: 'warning',
      message: 'Page has a noindex directive alongside a canonical link. Search engines may not process canonical directives on noindex pages.',
    });
  }

  // Crawlability directive conflicts
  for (const c of crawl.directiveConflicts) {
    conflicts.push({
      type: 'robots_directive_conflict',
      severity: 'critical',
      message: c,
    });
  }

  return { conflicts };
}

// 14. Scoring Engine and Issue Compilation
export function calculateSeoScoreAndIssues(
  title: TitleAnalysis,
  desc: MetaDescriptionAnalysis,
  canonical: CanonicalAnalysis,
  headings: HeadingStructureAnalysis,
  images: ImageSeoAnalysis,
  links: LinksAnalysis,
  i18n: InternationalizationAnalysis,
  og: OpenGraphAnalysis,
  tw: TwitterCardAnalysis,
  sd: StructuredDataAnalysis,
  crawl: CrawlabilityAnalysis,
  indexability: IndexabilityAnalysis,
  tech: TechnicalSeoAnalysis,
  conflicts: DuplicateConflictAnalysis
): { score: number; scoreBreakdown: SeoScoreBreakdown; issues: SeoIssue[] } {
  const issues: SeoIssue[] = [];

  // --- 1. Technical SEO (Max 20 pts) ---
  let techScore = 0;
  if (tech.https.enabled && tech.https.validCert) {
    techScore += 7;
    issues.push({
      id: 'tech-https-valid',
      category: 'technical',
      severity: 'passed',
      passed: true,
      message: 'HTTPS is properly configured with a valid SSL/TLS certificate.',
      recommendation: 'Ensure automated SSL certificate renewal remains active.',
    });
  } else {
    issues.push({
      id: 'tech-https-invalid',
      category: 'technical',
      severity: 'critical',
      passed: false,
      message: 'Page is served over insecure HTTP or has an invalid SSL certificate.',
      recommendation: 'Configure an SSL certificate (e.g. Let\'s Encrypt) and redirect all HTTP traffic to HTTPS.',
    });
  }

  if (tech.mobileViewport.configured && tech.mobileViewport.isStandard) {
    techScore += 5;
    issues.push({
      id: 'tech-viewport-standard',
      category: 'technical',
      severity: 'passed',
      passed: true,
      message: 'Responsive viewport meta tag is configured.',
      recommendation: 'Good mobile responsiveness foundation.',
    });
  } else {
    issues.push({
      id: 'tech-viewport-missing',
      category: 'technical',
      severity: 'warning',
      passed: false,
      message: 'Mobile viewport meta tag is missing or non-standard.',
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    });
  }

  if (tech.compression.enabled) {
    techScore += 4;
    issues.push({
      id: 'tech-compression',
      category: 'technical',
      severity: 'passed',
      passed: true,
      message: `HTTP response compression is active (${tech.compression.encoding}).`,
      recommendation: 'Maintain modern compression (Gzip or Brotli).',
    });
  } else {
    issues.push({
      id: 'tech-compression-missing',
      category: 'technical',
      severity: 'warning',
      passed: false,
      message: 'HTTP response compression is not enabled.',
      recommendation: 'Enable Brotli or Gzip compression on your web server or CDN to reduce payload sizes.',
    });
  }

  if (tech.caching.hasCacheHeaders) {
    techScore += 4;
    issues.push({
      id: 'tech-caching',
      category: 'technical',
      severity: 'passed',
      passed: true,
      message: 'Cache-Control headers detected.',
      recommendation: 'Leverage browser caching for static assets.',
    });
  } else {
    issues.push({
      id: 'tech-caching-missing',
      category: 'technical',
      severity: 'info',
      passed: false,
      message: 'No Cache-Control or ETag headers found in response.',
      recommendation: 'Configure Cache-Control headers to optimize repeat visitor asset loading.',
    });
  }

  // --- 2. On-Page SEO (Max 30 pts) ---
  let onPageScore = 0;

  // Title (8 pts)
  if (title.exists && title.severity === 'good') {
    onPageScore += 8;
    issues.push({
      id: 'onpage-title-optimal',
      category: 'onPage',
      severity: 'passed',
      passed: true,
      message: `Optimal <title> length (${title.characterCount} characters): "${title.value}".`,
      recommendation: 'Title provides concise topic clarity for search results.',
    });
  } else if (title.exists && title.severity === 'warning') {
    onPageScore += 5;
    issues.push({
      id: 'onpage-title-warning',
      category: 'onPage',
      severity: 'warning',
      passed: false,
      message: title.issues[0] || 'Title length could be optimized.',
      recommendation: 'Target 30–60 characters to prevent snippet truncation while providing thorough context.',
    });
  } else {
    issues.push({
      id: 'onpage-title-missing',
      category: 'onPage',
      severity: 'critical',
      passed: false,
      message: 'Page is missing a <title> element.',
      recommendation: 'Add a descriptive, unique <title> tag inside the <head> section.',
    });
  }

  // Description (7 pts)
  if (desc.exists && desc.severity === 'good') {
    onPageScore += 7;
    issues.push({
      id: 'onpage-desc-optimal',
      category: 'onPage',
      severity: 'passed',
      passed: true,
      message: `Meta description is well-sized (${desc.characterCount} characters).`,
      recommendation: 'Description provides a clean summary for snippet generation.',
    });
  } else if (desc.exists && desc.severity === 'warning') {
    onPageScore += 4;
    issues.push({
      id: 'onpage-desc-warning',
      category: 'onPage',
      severity: 'warning',
      passed: false,
      message: desc.issues[0] || 'Meta description length could be adjusted.',
      recommendation: 'Recommended meta description length is 120–160 characters.',
    });
  } else {
    issues.push({
      id: 'onpage-desc-missing',
      category: 'onPage',
      severity: 'warning',
      passed: false,
      message: 'Missing <meta name="description"> tag.',
      recommendation: 'Provide a concise summary (120–160 characters) outlining the page\'s value.',
    });
  }

  // Canonical (5 pts)
  if (canonical.exists && !canonical.multipleTags && !canonical.crossDomain) {
    onPageScore += 5;
    issues.push({
      id: 'onpage-canonical-valid',
      category: 'onPage',
      severity: 'passed',
      passed: true,
      message: `Valid canonical link declared (${canonical.url}).`,
      recommendation: 'Canonical tag is well-formed.',
    });
  } else if (canonical.multipleTags) {
    issues.push({
      id: 'onpage-canonical-multiple',
      category: 'onPage',
      severity: 'critical',
      passed: false,
      message: 'Multiple canonical tags detected.',
      recommendation: 'Remove duplicate canonical tags so search engines have an unambiguous signal.',
    });
  } else if (!canonical.exists) {
    issues.push({
      id: 'onpage-canonical-missing',
      category: 'onPage',
      severity: 'warning',
      passed: false,
      message: 'No canonical URL tag found.',
      recommendation: 'Add <link rel="canonical" href="..."> to prevent duplicate content risks.',
    });
  }

  // Headings (5 pts)
  if (headings.h1Count === 1) {
    onPageScore += 5;
    issues.push({
      id: 'onpage-h1-single',
      category: 'onPage',
      severity: 'passed',
      passed: true,
      message: `Single <h1> heading detected: "${headings.h1Texts[0] || ''}".`,
      recommendation: 'Heading hierarchy is clean.',
    });
  } else if (headings.h1Count > 1) {
    onPageScore += 3;
    issues.push({
      id: 'onpage-h1-multiple',
      category: 'onPage',
      severity: 'warning',
      passed: false,
      message: `Multiple <h1> headings found (${headings.h1Count}).`,
      recommendation: 'While multiple H1s are supported by HTML5, having one primary H1 is a best-practice recommendation.',
    });
  } else {
    issues.push({
      id: 'onpage-h1-missing',
      category: 'onPage',
      severity: 'warning',
      passed: false,
      message: 'No <h1> heading found on the page.',
      recommendation: 'Add an <h1> heading summarizing the main subject of the page.',
    });
  }

  // Images Alt (5 pts)
  if (images.totalImages === 0 || images.missingAlt === 0) {
    onPageScore += 5;
    issues.push({
      id: 'onpage-images-alt',
      category: 'onPage',
      severity: 'passed',
      passed: true,
      message: 'All images have alt attributes (or decorative alt="").',
      recommendation: 'Great image accessibility and SEO practice.',
    });
  } else {
    onPageScore += Math.max(1, Math.round((images.altCoveragePercent / 100) * 5));
    issues.push({
      id: 'onpage-images-alt-missing',
      category: 'onPage',
      severity: 'warning',
      passed: false,
      message: `${images.missingAlt} image(s) missing alt attributes.`,
      recommendation: 'Add meaningful alt descriptions for content images, or empty alt="" for decorative elements.',
    });
  }

  // --- 3. Social SEO (Max 15 pts) ---
  let socialScore = 0;
  if (og.present && og.title.present && og.image.present) {
    socialScore += 8;
    issues.push({
      id: 'social-og-complete',
      category: 'social',
      severity: 'passed',
      passed: true,
      message: 'Open Graph title, description, and image are configured.',
      recommendation: 'Provides rich previews on Facebook, LinkedIn, Slack, and Discord.',
    });
  } else if (og.present) {
    socialScore += 4;
    issues.push({
      id: 'social-og-partial',
      category: 'social',
      severity: 'warning',
      passed: false,
      message: 'Open Graph tags are present but missing key elements (title, description, or image).',
      recommendation: 'Ensure og:title, og:description, and og:image are fully defined.',
    });
  } else {
    issues.push({
      id: 'social-og-missing',
      category: 'social',
      severity: 'warning',
      passed: false,
      message: 'No Open Graph tags detected.',
      recommendation: 'Add Open Graph meta tags to enhance link presentation on social platforms.',
    });
  }

  if (tw.present && tw.card.present && tw.title.present) {
    socialScore += 7;
    issues.push({
      id: 'social-twitter-complete',
      category: 'social',
      severity: 'passed',
      passed: true,
      message: `Twitter Card (${tw.card.value || 'summary'}) is configured.`,
      recommendation: 'Optimizes previews when links are shared on X / Twitter.',
    });
  } else if (tw.present) {
    socialScore += 3;
    issues.push({
      id: 'social-twitter-partial',
      category: 'social',
      severity: 'info',
      passed: false,
      message: 'Twitter Card tags are present but missing card type or title.',
      recommendation: 'Define twitter:card and twitter:title for enhanced cards.',
    });
  } else {
    issues.push({
      id: 'social-twitter-missing',
      category: 'social',
      severity: 'info',
      passed: false,
      message: 'No Twitter Card meta tags found.',
      recommendation: 'Add twitter:card, twitter:title, and twitter:image tags.',
    });
  }

  // --- 4. Structured Data (Max 15 pts) ---
  let structuredDataScore = 0;
  if (sd.present && sd.validationStatus === 'valid') {
    structuredDataScore += 15;
    issues.push({
      id: 'sd-jsonld-valid',
      category: 'structuredData',
      severity: 'passed',
      passed: true,
      message: `Valid Schema.org structured data found: ${sd.schemasFound.join(', ') || 'General'}.`,
      recommendation: 'Provides explicit semantic entities to search engine indexers.',
    });
  } else if (sd.present && sd.validationStatus === 'invalid') {
    structuredDataScore += 6;
    issues.push({
      id: 'sd-jsonld-invalid',
      category: 'structuredData',
      severity: 'warning',
      passed: false,
      message: 'JSON-LD structured data was detected but contains syntax or schema errors.',
      recommendation: 'Validate your JSON-LD syntax and ensure @context and @type are properly set.',
    });
  } else {
    issues.push({
      id: 'sd-jsonld-missing',
      category: 'structuredData',
      severity: 'info',
      passed: false,
      message: 'No JSON-LD structured data detected on this page.',
      recommendation: 'Embed Schema.org structured data (e.g. Organization, WebSite, Article) to provide rich semantic context.',
    });
  }

  // --- 5. Indexability & Crawlability (Max 20 pts) ---
  let indexabilityScore = 0;
  if (indexability.status === 'indexable') {
    indexabilityScore += 10;
    issues.push({
      id: 'indexability-indexable',
      category: 'indexability',
      severity: 'passed',
      passed: true,
      message: 'Page is technically indexable (HTTP 200, no blocking directives).',
      recommendation: 'No crawling blockers detected.',
    });
  } else if (indexability.status === 'redirected') {
    indexabilityScore += 5;
    issues.push({
      id: 'indexability-redirected',
      category: 'indexability',
      severity: 'info',
      passed: false,
      message: indexability.reasons[0] || 'Page redirects to another destination.',
      recommendation: 'Ensure internal links point directly to the destination URL.',
    });
  } else {
    issues.push({
      id: 'indexability-blocked',
      category: 'indexability',
      severity: 'critical',
      passed: false,
      message: indexability.reasons[0] || 'Indexation is blocked by technical directives.',
      recommendation: 'Remove noindex directives if this page is intended to be indexed by search engines.',
    });
  }

  // Robots.txt & Sitemap (10 pts)
  if (crawl.robotsTxt.accessible) {
    indexabilityScore += 5;
    issues.push({
      id: 'crawl-robots-txt-found',
      category: 'crawlability',
      severity: 'passed',
      passed: true,
      message: 'robots.txt is accessible.',
      recommendation: 'Robots crawling guidelines are published.',
    });
  } else {
    issues.push({
      id: 'crawl-robots-txt-missing',
      category: 'crawlability',
      severity: 'warning',
      passed: false,
      message: 'robots.txt was not found or returned non-200 status.',
      recommendation: 'Add a /robots.txt file at your domain root to guide crawler access.',
    });
  }

  if (crawl.sitemap.accessible) {
    indexabilityScore += 5;
    issues.push({
      id: 'crawl-sitemap-found',
      category: 'crawlability',
      severity: 'passed',
      passed: true,
      message: `XML Sitemap is accessible (${crawl.sitemap.urlCount || 'valid'} URLs).`,
      recommendation: 'Sitemap helps search engines discover your pages efficiently.',
    });
  } else {
    issues.push({
      id: 'crawl-sitemap-missing',
      category: 'crawlability',
      severity: 'info',
      passed: false,
      message: 'No XML Sitemap detected at /sitemap.xml or declared in robots.txt.',
      recommendation: 'Publish a sitemap.xml to facilitate comprehensive page discovery.',
    });
  }

  // Conflict issues
  for (const c of conflicts.conflicts) {
    issues.push({
      id: `conflict-${c.type}`,
      category: 'onPage',
      severity: c.severity,
      passed: false,
      message: c.message,
      recommendation: 'Resolve conflicting directives to provide search crawlers with clear signals.',
    });
  }

  const overall = Math.min(
    100,
    Math.max(0, techScore + onPageScore + socialScore + structuredDataScore + indexabilityScore)
  );

  const scoreBreakdown: SeoScoreBreakdown = {
    overall,
    technical: { score: techScore, max: 20 },
    onPage: { score: onPageScore, max: 30 },
    social: { score: socialScore, max: 15 },
    structuredData: { score: structuredDataScore, max: 15 },
    indexability: { score: indexabilityScore, max: 20 },
  };

  return {
    score: overall,
    scoreBreakdown,
    issues,
  };
}

// Main Advanced SEO Entrypoint
export function runAdvancedSeoAnalysis(ctx: ScanContext): AdvancedSeoResult {
  const html = ctx.responseBody || '';

  const title = analyzeTitle(html);
  const description = analyzeMetaDescription(html);
  const canonical = analyzeCanonical(html, ctx.url);
  const headings = analyzeHeadings(html);
  const images = analyzeImages(html);
  const links = analyzeLinks(html, ctx.url);
  const internationalization = analyzeInternationalization(html);

  const openGraph = analyzeOpenGraph(html);
  const twitter = analyzeTwitterCard(html);
  const structuredData = analyzeStructuredData(html);

  const { crawlability, indexability } = analyzeCrawlability(html, ctx.responseHeaders, ctx);
  const technical = analyzeTechnicalSeo(html, ctx.responseHeaders, ctx, canonical);

  const conflicts = detectConflicts(
    title,
    description,
    canonical,
    openGraph,
    twitter,
    crawlability,
    indexability
  );

  const { score, scoreBreakdown, issues } = calculateSeoScoreAndIssues(
    title,
    description,
    canonical,
    headings,
    images,
    links,
    internationalization,
    openGraph,
    twitter,
    structuredData,
    crawlability,
    indexability,
    technical,
    conflicts
  );

  const criticalCount = issues.filter((i) => i.severity === 'critical' && !i.passed).length;
  const warningCount = issues.filter((i) => i.severity === 'warning' && !i.passed).length;
  const passedCount = issues.filter((i) => i.passed).length;

  return {
    score,
    overview: {
      score,
      indexabilityStatus: indexability.status,
      criticalCount,
      warningCount,
      passedCount,
      scoreBreakdown,
    },
    onPage: {
      title,
      description,
      canonical,
      headings,
      images,
      links,
      internationalization,
    },
    social: {
      openGraph,
      twitter,
    },
    structuredData,
    crawlability,
    indexability,
    technical,
    conflicts,
    issues,
  };
}

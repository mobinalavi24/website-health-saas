// Complete TypeScript Contracts for Advanced SEO Analysis

export type SeoSeverity = 'critical' | 'warning' | 'info' | 'passed';

export type SeoCategory =
  | 'technical'
  | 'onPage'
  | 'social'
  | 'structuredData'
  | 'crawlability'
  | 'indexability';

export interface SeoIssue {
  id: string;
  category: SeoCategory;
  severity: SeoSeverity;
  passed: boolean;
  message: string;
  recommendation: string;
}

export interface TitleAnalysis {
  exists: boolean;
  value?: string;
  characterCount: number;
  severity: 'good' | 'warning' | 'critical';
  issues: string[];
}

export interface MetaDescriptionAnalysis {
  exists: boolean;
  value?: string;
  characterCount: number;
  severity: 'good' | 'warning' | 'critical';
  issues: string[];
}

export interface CanonicalAnalysis {
  exists: boolean;
  url?: string;
  isAbsolute: boolean;
  isHttps: boolean;
  isSameDomain: boolean;
  multipleTags: boolean;
  tagsCount: number;
  crossDomain: boolean;
  issues: string[];
}

export interface OpenGraphAnalysis {
  present: boolean;
  title: { present: boolean; value?: string };
  description: { present: boolean; value?: string };
  image: { present: boolean; value?: string; isValidUrl: boolean };
  url: { present: boolean; value?: string };
  type: { present: boolean; value?: string };
  siteName: { present: boolean; value?: string };
  duplicateTags: string[];
  issues: string[];
}

export interface TwitterCardAnalysis {
  present: boolean;
  card: { present: boolean; value?: string };
  title: { present: boolean; value?: string };
  description: { present: boolean; value?: string };
  image: { present: boolean; value?: string; isValidUrl: boolean };
  site: { present: boolean; value?: string };
  creator: { present: boolean; value?: string };
  duplicateTags: string[];
  issues: string[];
}

export interface JsonLdItem {
  context?: string;
  type?: string | string[];
  rawPreview?: string;
  validJson: boolean;
  validationErrors?: string[];
  isGraph?: boolean;
}

export interface StructuredDataAnalysis {
  present: boolean;
  blocksCount: number;
  schemasFound: string[];
  items: JsonLdItem[];
  validationStatus: 'valid' | 'invalid' | 'none';
  validationSummary: string;
  disclaimer: string;
}

export interface CrawlabilityAnalysis {
  robotsMeta: {
    exists: boolean;
    tagCount: number;
    directives: string[];
  };
  googlebotMeta: {
    exists: boolean;
    directives: string[];
  };
  xRobotsTag: {
    exists: boolean;
    directives: string[];
  };
  directiveConflicts: string[];
  robotsTxt: {
    exists: boolean;
    accessible: boolean;
    httpStatus?: number;
    sitemapsDeclared: string[];
    userAgentGroupsCount: number;
    hasDisallowAll: boolean;
    disallowRulesCount: number;
    allowRulesCount: number;
  };
  sitemap: {
    exists: boolean;
    accessible: boolean;
    url?: string;
    httpStatus?: number;
    contentType?: string;
    validXml: boolean;
    isSitemapIndex: boolean;
    urlCount?: number;
    lastModifiedDatesCount?: number;
  };
}

export type IndexabilityStatus = 'indexable' | 'blocked' | 'redirected' | 'uncertain';

export interface IndexabilityAnalysis {
  status: IndexabilityStatus;
  reasons: string[];
  technicalExplanation: string;
}

export interface TechnicalSeoAnalysis {
  https: { enabled: boolean; validCert: boolean; protocol?: string };
  canonicalConsistency: { consistent: boolean; details: string };
  redirects: { hasRedirect: boolean; initialUrl: string; finalUrl: string; status: number };
  htmlLanguage: { exists: boolean; value?: string; isValidCode: boolean };
  mobileViewport: { configured: boolean; value?: string; isStandard: boolean };
  httpStatus: number;
  httpStatusText: string;
  contentType: string;
  compression: { enabled: boolean; encoding?: string };
  caching: {
    cacheControl?: string;
    etag?: string;
    expires?: string;
    hasCacheHeaders: boolean;
  };
}

export interface HeadingStructureAnalysis {
  h1Count: number;
  h2Count: number;
  h3Count: number;
  h1Texts: string[];
  headingsHierarchy: { tag: 'h1' | 'h2' | 'h3'; text: string }[];
  hierarchyGaps: string[];
  issues: string[];
}

export interface ImageSeoAnalysis {
  totalImages: number;
  imagesWithAlt: number;
  decorativeImages: number;
  missingAlt: number;
  imagesWithDimensions: number;
  lazyLoadedImages: number;
  altCoveragePercent: number;
}

export interface LinksAnalysis {
  totalLinks: number;
  internalLinks: number;
  externalLinks: number;
  emptyHrefCount: number;
  fragmentOnlyCount: number;
  issues: string[];
}

export interface HreflangTag {
  lang: string;
  href: string;
  isValidUrl: boolean;
}

export interface InternationalizationAnalysis {
  htmlLang: { exists: boolean; value?: string; isValidCode: boolean };
  hreflangCount: number;
  languages: string[];
  hreflangTags: HreflangTag[];
  duplicateDeclarations: string[];
}

export interface DuplicateConflictItem {
  type: string;
  severity: SeoSeverity;
  message: string;
}

export interface DuplicateConflictAnalysis {
  conflicts: DuplicateConflictItem[];
}

export interface SeoScoreBreakdown {
  overall: number;
  technical: { score: number; max: number };
  onPage: { score: number; max: number };
  social: { score: number; max: number };
  structuredData: { score: number; max: number };
  indexability: { score: number; max: number };
}

export interface AdvancedSeoOverview {
  score: number;
  indexabilityStatus: IndexabilityStatus;
  criticalCount: number;
  warningCount: number;
  passedCount: number;
  scoreBreakdown: SeoScoreBreakdown;
}

export interface AdvancedSeoOnPage {
  title: TitleAnalysis;
  description: MetaDescriptionAnalysis;
  canonical: CanonicalAnalysis;
  headings: HeadingStructureAnalysis;
  images: ImageSeoAnalysis;
  links: LinksAnalysis;
  internationalization: InternationalizationAnalysis;
}

export interface AdvancedSeoSocial {
  openGraph: OpenGraphAnalysis;
  twitter: TwitterCardAnalysis;
}

export interface AdvancedSeoResult {
  score: number;
  overview: AdvancedSeoOverview;
  onPage: AdvancedSeoOnPage;
  social: AdvancedSeoSocial;
  structuredData: StructuredDataAnalysis;
  crawlability: CrawlabilityAnalysis;
  indexability: IndexabilityAnalysis;
  technical: TechnicalSeoAnalysis;
  conflicts: DuplicateConflictAnalysis;
  issues: SeoIssue[];
}

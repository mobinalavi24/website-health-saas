// Google PageSpeed Insights & Lighthouse Integration Types

export type PageSpeedMetricStatus = 'good' | 'needs-improvement' | 'poor';

export interface CoreWebVitalMetric {
  value: number;
  unit: string;
  status: PageSpeedMetricStatus;
  percentile?: number;
}

export interface PageSpeedOpportunity {
  id: string;
  title: string;
  description: string;
  score?: number | null;
  estimatedSavingsMs?: number;
  estimatedSavingsBytes?: number;
  displayValue?: string;
}

export interface PageSpeedDeviceData {
  device: 'mobile' | 'desktop';
  scores: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  metrics: {
    lcp: CoreWebVitalMetric | null;
    inp: CoreWebVitalMetric | null;
    cls: CoreWebVitalMetric | null;
    fcp: CoreWebVitalMetric | null;
    ttfb: CoreWebVitalMetric | null;
    speedIndex: CoreWebVitalMetric | null;
  };
  opportunities: PageSpeedOpportunity[];
  diagnostics?: {
    totalBlockingTimeMs?: number | null;
    maxPotentialFidMs?: number | null;
    domSize?: number | null;
  };
  scannedAt: string;
  source: 'google-pagespeed-v5';
}

export interface CombinedPageSpeedResult {
  url: string;
  domain: string;
  scannedAt: string;
  mobile: PageSpeedDeviceData | null;
  desktop: PageSpeedDeviceData | null;
  cached?: boolean;
  error?: string | null;
}

export interface StoredPageSpeedRecord {
  id: string;
  url: string;
  domain: string;
  websiteId?: string;
  scanId?: string;
  device: 'mobile' | 'desktop';
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcp: CoreWebVitalMetric | null;
  inp: CoreWebVitalMetric | null;
  cls: CoreWebVitalMetric | null;
  fcp: CoreWebVitalMetric | null;
  ttfb: CoreWebVitalMetric | null;
  speedIndex: CoreWebVitalMetric | null;
  opportunities: PageSpeedOpportunity[];
  scannedAt: string;
}

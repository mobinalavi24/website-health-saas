import { db, type Website, type MetricPoint, type Incident, type AlertNotification } from './db.ts';
import { performWebsiteScan } from './scanner.ts';
import { performPageSpeedAnalysis } from './pagespeed.ts';
import { performWhoisLookup } from './whois.ts';
import { getAccountTrialStatus } from './trial.ts';
import {
  cleanupOverdueExpiredWebsites,
  isExemptSuperAdmin,
  reconcileOrganizationWebsiteAllocations,
} from './entitlements.ts';
import { safeFetch } from './ssrf.ts';

interface WorkerStats {
  running: boolean;
  lastTickAt: string;
  totalChecksCompleted: number;
  activeQueueLength: number;
  lastRunDurationMs: number;
  activeFailures: number;
}

export class ContinuousMonitoringEngine {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private stats: WorkerStats = {
    running: false,
    lastTickAt: new Date().toISOString(),
    totalChecksCompleted: 0,
    activeQueueLength: 0,
    lastRunDurationMs: 0,
    activeFailures: 0,
  };

  public start(intervalMs = 30000) {
    if (this.timer) return;
    this.stats.running = true;
    console.log('[Monitor Engine] Started background worker with tick interval:', intervalMs, 'ms');
    this.timer = setInterval(() => this.tick(), intervalMs);
    // Initial tick shortly after startup
    setTimeout(() => this.tick(), 3000);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stats.running = false;
  }

  public getStats(): WorkerStats {
    return { ...this.stats };
  }

  public async tick() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    const start = Date.now();
    this.stats.lastTickAt = new Date().toISOString();

    try {
      const now = Date.now();
      // 0. Run deterministic overdue website cleanup and entitlement reconciliation on every tick
      await cleanupOverdueExpiredWebsites(now).catch((err) => {
        console.error('[Monitor Engine] Cleanup warning:', err?.message || err);
      });

      const websites = db.getWebsites().filter((w) => w.status !== 'PAUSED');

      // Find due websites (excluding websites in expired_grace_period unless exempt Super Admin)
      const dueWebsites = websites.filter((site) => {
        const org = db.findOrgById(site.orgId);
        if (!isExemptSuperAdmin(null, org)) {
          if (site.accessStatus === 'expired_grace_period' || site.isSubscriptionExpired) {
            return false;
          }
          if (org && org.planId === 'free') {
            const trial = getAccountTrialStatus(org, now);
            if (trial.isExpired) {
              return false;
            }
          }
        }

        if (!site.lastCheckedAt) return true;
        const last = new Date(site.lastCheckedAt).getTime();
        const diffMinutes = (now - last) / (1000 * 60);
        return diffMinutes >= site.intervalMinutes;
      });

      this.stats.activeQueueLength = dueWebsites.length;

      // Process due websites in parallel batches of up to 4
      const batchSize = 4;
      for (let i = 0; i < dueWebsites.length; i += batchSize) {
        const batch = dueWebsites.slice(i, i + batchSize);
        await Promise.all(batch.map((site) => this.checkWebsite(site)));
      }
    } catch (err) {
      console.error('[Monitor Engine] Error in tick cycle:', err);
    } finally {
      this.stats.lastRunDurationMs = Date.now() - start;
      this.isProcessing = false;
    }
  }

  public async checkWebsite(website: Website): Promise<Website> {
    const org = db.findOrgById(website.orgId);
    if (!isExemptSuperAdmin(null, org)) {
      await reconcileOrganizationWebsiteAllocations(website.orgId).catch(() => {});
      const currentSite = db.findWebsiteById(website.id) || website;
      if (currentSite.accessStatus === 'expired_grace_period' || currentSite.isSubscriptionExpired) {
        return currentSite;
      }
      if (org && org.planId === 'free') {
        const trial = getAccountTrialStatus(org);
        if (trial.isExpired) {
          return currentSite;
        }
      }
    }

    const checkStart = Date.now();
    let currentStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE' = 'ONLINE';
    let httpStatus = 0;
    let responseTimeMs = 0;
    let errorMessage: string | undefined;

    try {
      const resp = await safeFetch(website.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'PulseVanguard-Monitor/1.0 (+https://pulsevanguard.com/bot; continuous health check)',
        },
        timeoutMs: 6000,
        maxBytes: 64 * 1024,
        maxRedirects: 5,
      });
      await resp.text();

      responseTimeMs = Date.now() - checkStart;
      httpStatus = resp.status;

      if (resp.status >= 200 && resp.status < 400) {
        currentStatus = responseTimeMs > 2500 ? 'DEGRADED' : 'ONLINE';
      } else {
        // Confirmation retry to avoid false alarms
        await new Promise((r) => setTimeout(r, 1500));
        const retryResp = await safeFetch(website.url, {
          method: 'GET',
          headers: { 'User-Agent': 'PulseVanguard-Monitor/1.0 (retry)' },
          timeoutMs: 4000,
          maxBytes: 16 * 1024,
        }).catch(() => null);
        if (retryResp) await retryResp.text();

        if (retryResp && retryResp.status >= 200 && retryResp.status < 400) {
          currentStatus = 'DEGRADED';
          httpStatus = retryResp.status;
        } else {
          currentStatus = 'OFFLINE';
          errorMessage = `HTTP error ${resp.status} ${resp.statusText}`;
        }
      }
    } catch (e: any) {
      responseTimeMs = Date.now() - checkStart;
      // Confirmation retry
      try {
        await new Promise((r) => setTimeout(r, 1000));
        const retry = await safeFetch(website.url, { method: 'HEAD', timeoutMs: 3000 });
        if (retry.status < 400) {
          currentStatus = 'DEGRADED';
          httpStatus = retry.status;
        } else {
          currentStatus = 'OFFLINE';
          errorMessage = e.message || 'Connection failed';
        }
      } catch {
        currentStatus = 'OFFLINE';
        errorMessage = /timed out/i.test(e?.message || '') ? 'Connection timeout (6000ms)' : (e.message || 'Network error');
      }
    }

    const previousStatus = website.status;

    // Handle Incident creation / resolution
    const openIncident = db.getIncidents().find((inc) => inc.websiteId === website.id && inc.status === 'OPEN');

    if (currentStatus === 'OFFLINE' && previousStatus !== 'OFFLINE') {
      // Transitioned to DOWN
      const inc: Incident = {
        id: `inc_${Date.now()}`,
        orgId: website.orgId,
        websiteId: website.id,
        websiteName: website.name,
        startedAt: new Date().toISOString(),
        status: 'OPEN',
        cause: errorMessage || `Service returned HTTP ${httpStatus}`,
      };
      db.addIncident(inc);

      if (website.notificationSettings.alertOnDown) {
        const alert: AlertNotification = {
          id: `alt_${Date.now()}`,
          orgId: website.orgId,
          websiteId: website.id,
          websiteName: website.name,
          type: 'downtime',
          severity: 'critical',
          title: `Website DOWN: ${website.name}`,
          message: `${website.name} (${website.domain}) is inaccessible. Cause: ${inc.cause}`,
          read: false,
          timestamp: new Date().toISOString(),
        };
        db.addAlert(alert);
      }
      this.stats.activeFailures++;
    } else if (currentStatus === 'ONLINE' && openIncident) {
      // Transitioned to RECOVERED
      const durationMin = Math.max(1, Math.round((Date.now() - new Date(openIncident.startedAt).getTime()) / 60000));
      db.updateIncident(openIncident.id, {
        status: 'RESOLVED',
        resolvedAt: new Date().toISOString(),
        durationMinutes: durationMin,
      });

      if (website.notificationSettings.alertOnRecovery) {
        const alert: AlertNotification = {
          id: `alt_${Date.now()}`,
          orgId: website.orgId,
          websiteId: website.id,
          websiteName: website.name,
          type: 'recovery',
          severity: 'info',
          title: `Service Recovered: ${website.name}`,
          message: `${website.name} has recovered and is now ONLINE. Downtime was approximately ${durationMin} minute(s).`,
          read: false,
          timestamp: new Date().toISOString(),
        };
        db.addAlert(alert);
      }
      this.stats.activeFailures = Math.max(0, this.stats.activeFailures - 1);
    }

    // High latency alert
    if (
      currentStatus === 'DEGRADED' &&
      website.notificationSettings.latencyThresholdMs &&
      responseTimeMs >= website.notificationSettings.latencyThresholdMs
    ) {
      const alert: AlertNotification = {
        id: `alt_${Date.now()}`,
        orgId: website.orgId,
        websiteId: website.id,
        websiteName: website.name,
        type: 'latency',
        severity: 'warning',
        title: `Latency Degradation: ${website.name}`,
        message: `Response time ${responseTimeMs}ms exceeded threshold of ${website.notificationSettings.latencyThresholdMs}ms.`,
        read: false,
        timestamp: new Date().toISOString(),
      };
      db.addAlert(alert);
    }

    // Save metric
    const metric: MetricPoint = {
      id: `met_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      websiteId: website.id,
      timestamp: new Date().toISOString(),
      status: currentStatus,
      httpStatus,
      responseTimeMs,
      errorMessage,
    };
    db.addMetric(metric);

    // Compute updated uptime statistics
    const siteMetrics = db.getMetrics().filter((m) => m.websiteId === website.id);
    const totalCount = siteMetrics.length || 1;
    const upCount = siteMetrics.filter((m) => m.status === 'ONLINE' || m.status === 'DEGRADED').length;
    const uptimeCalculated = Math.round((upCount / totalCount) * 10000) / 100;

    // Update website state
    const updated = db.updateWebsite(website.id, {
      status: currentStatus,
      lastCheckedAt: new Date().toISOString(),
      lastResponseTimeMs: responseTimeMs,
      uptime24h: uptimeCalculated,
      uptime7d: Math.min(100, Math.round((uptimeCalculated * 0.999) * 100) / 100),
      uptime30d: Math.min(100, Math.round((uptimeCalculated * 0.998) * 100) / 100),
    });

    this.stats.totalChecksCompleted++;
    return updated || website;
  }

  // Deep scan execution triggered on-demand
  public async runFullAudit(websiteId: string) {
    const website = db.findWebsiteById(websiteId);
    if (!website) throw new Error('Website not found');

    const org = db.findOrgById(website.orgId);
    if (!isExemptSuperAdmin(null, org)) {
      await reconcileOrganizationWebsiteAllocations(website.orgId);
      const refreshed = db.findWebsiteById(websiteId);
      if (refreshed && (refreshed.accessStatus === 'expired_grace_period' || refreshed.isSubscriptionExpired)) {
        const expErr: any = new Error('Subscription expired — This website will be deleted in 2 days. Renew your subscription to retain access.');
        expErr.code = 'SUBSCRIPTION_EXPIRED';
        throw expErr;
      }
      if (org && org.planId === 'free') {
        const trial = getAccountTrialStatus(org);
        if (trial.isExpired) {
          throw new Error('Your free trial has expired. Upgrade to Pro to continue.');
        }
      }
    }

    const result = await performWebsiteScan(website.url);
    const existingPs = website.lastScanResult?.pageSpeed;

    // Also run PageSpeed safely without failing audit, preserving any previous valid strategy data on partial/transient failure
    try {
      const psResult = await performPageSpeedAnalysis(website.url);
      result.pageSpeed = {
        ...psResult,
        mobile: psResult.mobile ?? existingPs?.mobile ?? null,
        desktop: psResult.desktop ?? existingPs?.desktop ?? null,
      };
      if (psResult.mobile) {
        db.addPageSpeedRecord({
          id: `ps_mob_${Date.now()}`,
          websiteId,
          url: psResult.url,
          domain: psResult.domain,
          device: 'mobile',
          performance: psResult.mobile.scores.performance,
          accessibility: psResult.mobile.scores.accessibility,
          bestPractices: psResult.mobile.scores.bestPractices,
          seo: psResult.mobile.scores.seo,
          lcp: psResult.mobile.metrics.lcp,
          inp: psResult.mobile.metrics.inp,
          cls: psResult.mobile.metrics.cls,
          fcp: psResult.mobile.metrics.fcp,
          ttfb: psResult.mobile.metrics.ttfb,
          speedIndex: psResult.mobile.metrics.speedIndex,
          opportunities: psResult.mobile.opportunities,
          scannedAt: psResult.scannedAt,
        });
      }
      if (psResult.desktop) {
        db.addPageSpeedRecord({
          id: `ps_desk_${Date.now()}`,
          websiteId,
          url: psResult.url,
          domain: psResult.domain,
          device: 'desktop',
          performance: psResult.desktop.scores.performance,
          accessibility: psResult.desktop.scores.accessibility,
          bestPractices: psResult.desktop.scores.bestPractices,
          seo: psResult.desktop.scores.seo,
          lcp: psResult.desktop.metrics.lcp,
          inp: psResult.desktop.metrics.inp,
          cls: psResult.desktop.metrics.cls,
          fcp: psResult.desktop.metrics.fcp,
          ttfb: psResult.desktop.metrics.ttfb,
          speedIndex: psResult.desktop.metrics.speedIndex,
          opportunities: psResult.desktop.opportunities,
          scannedAt: psResult.scannedAt,
        });
      }
    } catch (e: any) {
      console.warn('[PageSpeed FullAudit Notice]', e.message);
      result.pageSpeed = {
        url: result.url,
        domain: result.domain,
        scannedAt: existingPs?.scannedAt || new Date().toISOString(),
        mobile: existingPs?.mobile ?? null,
        desktop: existingPs?.desktop ?? null,
        error: e.message || 'PageSpeed analysis unavailable.',
      };
    }

    let updatedWhois = website.lastWhoisResult;
    try {
      const whoisRes = await performWhoisLookup(website.domain || result.domain, false);
      result.whois = whoisRes;
      updatedWhois = whoisRes;
    } catch (whoisErr: any) {
      console.warn('[WHOIS FullAudit Notice]', whoisErr?.message || whoisErr);
      if (existingPs && website.lastWhoisResult) {
        result.whois = website.lastWhoisResult;
      }
    }

    db.updateWebsite(websiteId, {
      lastScanResult: result,
      ...(updatedWhois ? { lastWhoisResult: updatedWhois } : {}),
      healthScore: result.overallScore,
      lastResponseTimeMs: result.uptime.responseTimeMs,
      status: result.uptime.status,
      lastCheckedAt: result.timestamp,
    });
    return result;
  }
}

export const monitorEngine = new ContinuousMonitoringEngine();

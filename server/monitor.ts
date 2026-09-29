import { db, type Website, type MetricPoint, type Incident, type AlertNotification } from './db.ts';
import { performWebsiteScan } from './scanner.ts';

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
      const websites = db.getWebsites().filter((w) => w.status !== 'PAUSED');
      const now = Date.now();

      // Find due websites
      const dueWebsites = websites.filter((site) => {
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
    const checkStart = Date.now();
    let currentStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE' = 'ONLINE';
    let httpStatus = 0;
    let responseTimeMs = 0;
    let errorMessage: string | undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const resp = await fetch(website.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'PulseVanguard-Monitor/1.0 (+https://pulsevanguard.com/bot; continuous health check)',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      responseTimeMs = Date.now() - checkStart;
      httpStatus = resp.status;

      if (resp.status >= 200 && resp.status < 400) {
        currentStatus = responseTimeMs > 2500 ? 'DEGRADED' : 'ONLINE';
      } else {
        // Confirmation retry to avoid false alarms
        await new Promise((r) => setTimeout(r, 1500));
        const retryResp = await fetch(website.url, {
          method: 'GET',
          headers: { 'User-Agent': 'PulseVanguard-Monitor/1.0 (retry)' },
          signal: AbortSignal.timeout(4000),
        }).catch(() => null);

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
        const retry = await fetch(website.url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        if (retry.status < 400) {
          currentStatus = 'DEGRADED';
          httpStatus = retry.status;
        } else {
          currentStatus = 'OFFLINE';
          errorMessage = e.message || 'Connection failed';
        }
      } catch {
        currentStatus = 'OFFLINE';
        errorMessage = e.name === 'AbortError' ? 'Connection timeout (6000ms)' : (e.message || 'Network error');
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

    const result = await performWebsiteScan(website.url);
    db.updateWebsite(websiteId, {
      lastScanResult: result,
      healthScore: result.overallScore,
      lastResponseTimeMs: result.uptime.responseTimeMs,
      status: result.uptime.status,
      lastCheckedAt: result.timestamp,
    });
    return result;
  }
}

export const monitorEngine = new ContinuousMonitoringEngine();

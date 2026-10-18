import type { Plugin } from 'vite';
import { handleApiRoute } from './api.ts';
import { monitorEngine } from './monitor.ts';
import { runMigration } from './db/migrate.ts';
import { db } from './db.ts';

export function pulseVanguardApiPlugin(): Plugin {
  let initPromise: Promise<void> | null = null;

  const ensureInitialized = async () => {
    if (!initPromise) {
      initPromise = (async () => {
        try {
          await runMigration();
          await db.initFromPostgres();
          console.log('[Vite API Plugin] PostgreSQL migration and hydration completed successfully.');
          const { getPageSpeedApiKey } = await import('./pagespeed.ts');
          const psStatus = getPageSpeedApiKey();
          if (psStatus.key) {
            console.log('[Vite API Plugin] Google PageSpeed Insights API key detected.');
          } else {
            console.warn(`[Vite API Plugin] PageSpeed Notice: ${psStatus.diagnosticError}`);
          }
        } catch (err: any) {
          console.warn('[Vite API Plugin] Migration initialization notice:', err.message);
        }
      })();
    }
    return initPromise;
  };

  const setupMiddleware = (server: any) => {
    monitorEngine.start(25000);
    ensureInitialized().catch(() => {});

    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url && req.url.startsWith('/api/')) {
        try {
          await ensureInitialized();
          const handled = await handleApiRoute(req, res);
          if (!handled) next();
        } catch (err) {
          console.error('[Vite API Middleware Error]', err);
          next(err);
        }
      } else {
        next();
      }
    });
  };

  return {
    name: 'pulsevanguard-api-plugin',
    configureServer(server) {
      setupMiddleware(server);
    },
    configurePreviewServer(server) {
      setupMiddleware(server);
    },
  };
}

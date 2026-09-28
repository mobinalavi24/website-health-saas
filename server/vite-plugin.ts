import type { Plugin } from 'vite';
import { handleApiRoute } from './api.js';
import { monitorEngine } from './monitor.js';

export function pulseVanguardApiPlugin(): Plugin {
  const setupMiddleware = (server: any) => {
    monitorEngine.start(25000);

    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url && req.url.startsWith('/api/')) {
        try {
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

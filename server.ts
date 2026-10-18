import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRoute } from './server/api.ts';
import { monitorEngine } from './server/monitor.ts';
import { runMigration } from './server/db/migrate.ts';
import { db } from './server/db.ts';
import {
  validateProductionEnvironment,
  applyPageSecurityHeaders,
  pruneSecurityData,
} from './server/security.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // 0. Validate production environment and secrets before starting listeners
  validateProductionEnvironment();

  const app = express();
  app.disable('x-powered-by');
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // 1. Initialize PostgreSQL schema and apply database migrations
  try {
    const migrationResult = await runMigration();
    console.log('[PulseVanguard] PostgreSQL migration ready:', migrationResult.details.join('; ') || 'Up to date');
    await db.initFromPostgres();
    console.log('[PulseVanguard] PostgreSQL repositories synchronized.');
  } catch (dbErr: any) {
    console.error('[PulseVanguard] PostgreSQL startup warning:', dbErr.message);
    if (isProd) {
      throw dbErr;
    }
  }

  // Start background monitoring worker and periodic security table pruning
  monitorEngine.start(25000);
  const pruneTimer = setInterval(() => {
    pruneSecurityData().catch(() => {});
  }, 60 * 60 * 1000);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();

  // Apply baseline security headers and block sensitive dotfile / backup paths
  app.use((req, res, next) => {
    const reqPath = (req.path || req.url || '').toLowerCase();
    if (
      reqPath.startsWith('/.') ||
      reqPath.includes('/.env') ||
      reqPath.includes('/.git') ||
      reqPath.endsWith('.sql') ||
      reqPath.endsWith('.dump') ||
      reqPath.endsWith('.bak') ||
      reqPath.startsWith('/data/') ||
      reqPath.startsWith('/server/')
    ) {
      res.status(404).end('Not found');
      return;
    }
    if (!reqPath.startsWith('/api/')) {
      applyPageSecurityHeaders(req, res);
    }
    next();
  });

  // Health checks for Cloud Run container lifecycle
  app.get(['/healthz', '/api/healthz'], (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Mount API route handler
  app.use(async (req, res, next) => {
    if (req.url && req.url.startsWith('/api/')) {
      try {
        const handled = await handleApiRoute(req, res);
        if (!handled) next();
      } catch (err) {
        console.error('[API Server Error]');
        if (!res.headersSent) {
          res.status(500).json({ error: 'An unexpected error occurred.' });
        }
      }
    } else {
      next();
    }
  });

  if (!isProd) {
    // In development mode, mount Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production mode, serve built static assets from dist with dotfiles denied
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath, { dotfiles: 'deny', index: false }));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[PulseVanguard] Server running on http://0.0.0.0:${PORT} (mode: ${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[PulseVanguard] Failed to start server:', err?.message || err);
  process.exit(1);
});

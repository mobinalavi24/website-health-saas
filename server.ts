import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRoute } from './server/api.ts';
import { monitorEngine } from './server/monitor.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // Start background monitoring worker
  monitorEngine.start(25000);

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
        console.error('[API Server Error]', err);
        next(err);
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
    // In production mode, serve built static assets from dist
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[PulseVanguard] Server running on http://0.0.0.0:${PORT} (mode: ${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[PulseVanguard] Failed to start server:', err);
  process.exit(1);
});

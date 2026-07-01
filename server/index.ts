import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { runSafeMigrations, runSchemaCheck } from "./db";
import { startRoutingCacheSync } from "./routing-cache";
import { setupNocWebSocket } from "./noc-ws";
import { setupLiveTrafficWebSocket } from "./live-traffic-ws";
import { createServer } from "http";

// ── Global crash guards ───────────────────────────────────────────────────────
// Prevent background timer errors from killing the production process.
process.on('unhandledRejection', (reason: any) => {
  console.error('[process] Unhandled rejection (non-fatal):', reason?.message ?? reason);
});
process.on('uncaughtException', (err: Error) => {

process.on("exit", (code) => { console.error("[EXIT] code=", code); });
process.on("SIGTERM", () => { console.error("[SIGTERM] received"); });
process.on("SIGINT",  () => { console.error("[SIGINT] received"); });

const _bootStart = Date.now();
function boot(msg: string) {
  console.log(`[BOOT +${Date.now() - _bootStart}ms] ${msg}`);
}
boot(`1 process started · Node ${process.version} · PID=${process.pid} · PORT=${process.env.PORT} · NODE_ENV=${process.env.NODE_ENV}`);
  console.error('[process] Uncaught exception (non-fatal):', err.message);
});

const app = express();
const httpServer = createServer(app);
boot("2 express app + httpServer created");
// Probe logger — first middleware; reveals exactly what Cloud Run health check hits
app.use((req, _res, next) => {
  if (req.originalUrl === '/' || req.originalUrl === '/healthz' || req.originalUrl.startsWith('/api/health')) {
    console.log(`[probe] ${req.method} ${req.originalUrl} accept="${req.headers['accept'] ?? ''}"`);
  }
  next();
});

  // ── Unauthenticated health probe (Cloud Run / Replit Autoscale) ──────────
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), ts: Date.now() });
  });


declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ── Trust proxy (Replit reverse-proxy) ────────────────────────────────────────
// Required so express-rate-limit sees the real client IP via X-Forwarded-For
app.set('trust proxy', 1);

// ── Security headers (helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Vite HMR needs these
      styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc:         ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com"],
      connectSrc:     ["'self'", "ws:", "wss:"],  // WebSocket for Vite HMR
      fontSrc:        ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc:      ["'none'"],
      frameSrc:       ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ── Rate limiters ─────────────────────────────────────────────────────────────
// General API: 300 requests / 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
  skip: (req) => !req.path.startsWith('/api'), // only limit API routes
});

// Auth endpoints: 20 requests / 15 minutes per IP (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' },
});

app.use(generalLimiter);
app.use('/api/login', authLimiter);
app.use('/api/logout', authLimiter);
app.use('/api/auth', authLimiter);

// ── Per-route body size overrides (before global limit) ───────────────────────
// CDR recon upload sends a base64-encoded xlsx; needs larger limit
app.use('/api/cdr-recon/upload', express.json({ limit: '25mb' }));

// ── Body size limit (prevent large payload attacks) ───────────────────────────
app.use(express.json({
  limit: '25mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ── Suspicious activity tracker ───────────────────────────────────────────────
// Log repeated 401s from the same IP — helps detect scanning/credential stuffing
const suspiciousIps = new Map<string, { count: number; firstSeen: number }>();
const SUSPICIOUS_THRESHOLD = 15;
const SUSPICIOUS_WINDOW_MS = 5 * 60 * 1000;

function trackSuspiciousActivity(ip: string, statusCode: number): void {
  if (statusCode !== 401 && statusCode !== 403) return;
  const now = Date.now();
  let entry = suspiciousIps.get(ip);
  if (!entry || now - entry.firstSeen > SUSPICIOUS_WINDOW_MS) {
    entry = { count: 0, firstSeen: now };
  }
  entry.count++;
  suspiciousIps.set(ip, entry);
  if (entry.count === SUSPICIOUS_THRESHOLD) {
    console.warn(`[security] ⚠️ Suspicious activity: IP ${ip} triggered ${entry.count} auth failures in ${Math.round((now - entry.firstSeen) / 1000)}s`);
  }
}

// Clean up the suspicious IPs map every hour
setInterval(() => {
  const cutoff = Date.now() - SUSPICIOUS_WINDOW_MS * 2;
  for (const [ip, entry] of suspiciousIps) {
    if (entry.firstSeen < cutoff) suspiciousIps.delete(ip);
  }
}, 60 * 60 * 1000);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    // Track suspicious 401/403 responses
    trackSuspiciousActivity(ip, res.statusCode);

    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // ── 1. Open port IMMEDIATELY ────────────────────────────────────────────────
  // Replit autoscale wakes a fresh container on the very first request.
  // On a cold start the OIDC /api/callback redirect arrives ~5-10 s after boot.
  // If the port is not open in time, Replit's proxy returns "upstream request
  // timeout". Calling listen() first keeps the TCP connection alive while DB
  // migrations and route registration run in the background.
  const port = parseInt(process.env.PORT || "5000", 10);
  boot(`3 calling httpServer.listen on PORT=${process.env.PORT || 5000}`);
  httpServer.listen(
    { port, host: "0.0.0.0", reusePort: true },
    () => { boot(`4 httpServer listening on ${port}`); log(`serving on port ${port}`); },
  );

  // ── 2. Startup gate ─────────────────────────────────────────────────────────
  // Intercepts all requests while DB migrations + route registration are in
  // progress. Once _serverReady flips to true, every request passes through.
  let _serverReady = false;
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (_serverReady) return next();
    // OAuth callback during cold-start: redirect to home so the user can
    // click "Login" again once the server finishes initialising (~10-30 s).
    if (req.path === '/api/callback') return res.redirect('/');
    // API calls: return 503 so JS clients know to retry.
    // Exception: /api/callback must never get 503 (already redirected above).
    if (req.path.startsWith('/api/')) {
      res.set('Retry-After', '5');
      return res.status(503).json({ message: 'Server is starting up. Please retry in a few seconds.' });
    }
    // Browser page requests (including the Cloud Run health-check probe GET /):
    // Return 200 so the startup probe passes immediately — the container IS alive,
    // it is just still initialising. Users see an auto-refresh loading screen.
    return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="4"><title>Starting up…</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f172a;color:#94a3b8;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:12px}h2{color:#f8fafc;font-size:1.25rem}p{font-size:.875rem}</style></head><body><h2>Bitsauto is starting up…</h2><p>This page will refresh automatically in 4 seconds.</p></body></html>`);
  });

  // ── 3. DB migrations (required before routes so all tables exist) ───────────
  boot("5 runSafeMigrations() starting");
  await runSafeMigrations();
  boot("6 runSafeMigrations() done");
  // Schema check is diagnostic-only — run async so it doesn't delay routes
  runSchemaCheck().catch(() => {});

  // Guard: ensures serveStatic is registered exactly once (called from either
  // the safety timeout OR the finally block, whichever fires first).
  let _staticRegistered = false;
  const _registerStatic = () => {
    if (_staticRegistered) return;
    _staticRegistered = true;
    // NODE_ENV is baked as "production" by esbuild define at build time.
    if (process.env.NODE_ENV === "production") {
      boot("7 serveStatic() registering");
      serveStatic(app);
      boot("8 serveStatic() done");
    }
  };

  // Safety net: if routes haven't finished loading within 60 s (e.g. OIDC or
  // Sippy network hangs in Cloud Run), register static serving and open the gate
  // so GET / returns 200 and the Cloud Run startup probe stays healthy.
  const _startupSafetyTimer = setTimeout(() => {
    if (!_serverReady) {
      console.warn('[startup] 60 s safety timeout — opening gate before routes finish loading');
      _registerStatic();  // ensure static is served even if routes haven't completed
      _serverReady = true;
    }
  }, 60_000);

  try {
    boot("9 registerRoutes() starting");
    await registerRoutes(httpServer, app);
    boot("10 registerRoutes() done");
  } catch (e: any) {
    console.error('[startup] registerRoutes error (non-fatal):', e?.message);
  } finally {
    clearTimeout(_startupSafetyTimer);
    // Register static THEN open the gate — no event-loop yield between them,
    // so health probes immediately get index.html (not 404) after _serverReady flips.
    _registerStatic();
    _serverReady = true; // ← always flip, even if routes threw or timed-out
    boot("11 _serverReady=true · startup complete");
  }

  // Pre-generate the PPTX at startup and write to the static downloads folder.
  // Vite / the static server serves it directly — bypasses Express routing entirely.
  import('./pptx-generator').then(async ({ generatePlatformPresentationPptx }) => {
    const { writeFile } = await import('fs/promises');
    const { resolve }   = await import('path');
    const buf  = await generatePlatformPresentationPptx();
    // Use process.cwd() so this works in both CJS (production) and ESM (dev).
    // In production the built static folder is dist/public/; in dev it's client/public/.
    const downloadsDir = process.env.NODE_ENV === 'production'
      ? resolve(process.cwd(), 'dist', 'public', 'downloads')
      : resolve(process.cwd(), 'client', 'public', 'downloads');
    const dest = resolve(downloadsDir, 'Bitsauto_Top11_Features.pptx');
    await writeFile(dest, buf);
    console.log(`[pptx] Pre-generated PPTX → ${dest} (${buf.length} bytes)`);
  }).catch((e: any) => {
    console.error('[pptx] Pre-generation failed (non-fatal):', e?.message);
  });

  // Pre-generate the Platform Status & Roadmap Report DOCX at startup.
  // Runs the Python generation script so the file is always fresh on every deployment.
  (async () => {
    try {
      const { execFile } = await import('child_process');
      const { resolve }  = await import('path');
      const scriptPath   = resolve(process.cwd(), 'scripts', 'generate_report.py');
      const { existsSync } = await import('fs');
      if (!existsSync(scriptPath)) { console.warn('[report] generate_report.py not found — skipping'); return; }
      await new Promise<void>((ok, fail) => {
        execFile('python3', [scriptPath], { timeout: 60_000 }, (err, stdout, stderr) => {
          if (err) { fail(err); return; }
          console.log('[report] Platform status report generated:', stdout.trim());
          ok();
        });
      });
    } catch (e: any) {
      console.error('[report] Report generation failed (non-fatal):', e?.message);
    }
  })();

  // NOC WebSocket — real-time live-call count push to all dashboard tabs
  setupNocWebSocket(httpServer);
  // Live Traffic Intelligence WebSocket — rolling ASR/ACD window snapshots
  setupLiveTrafficWebSocket(httpServer);

  // SBC background poller — real TCP/HTTP/SNMP probing every 5 min
  const { startSbcPoller } = await import('./sbc-poller');
  const { db: sbcDb } = await import('./db');
  const { sbcHosts: sbcHostsTable } = await import('../shared/schema');
  const { eq: sbcEq, asc: sbcAsc } = await import('drizzle-orm');
  startSbcPoller(
    async () => sbcDb.select().from(sbcHostsTable).orderBy(sbcAsc(sbcHostsTable.name)),
    async (id: number, status: string) => {
      await sbcDb.update(sbcHostsTable)
        .set({ lastStatus: status, lastCheckedAt: new Date() })
        .where(sbcEq(sbcHostsTable.id, id));
    }
  );

  // Start routing cache background sync (15-min intervals, first sync after 10s)
  startRoutingCacheSync();

  // GDPR data retention — hourly purge job
  const { initGdprRetention } = await import('./gdpr-retention');
  const { storage: gdprStorage } = await import('./storage');
  initGdprRetention(gdprStorage);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // Dev-only: start Vite HMR dev-server (production uses serveStatic registered above).
  if (process.env.NODE_ENV !== "production") {
    // Vite dev-server may take time to initialize (plugin warmup, dep optimisation,
    // or Replit-specific plugin network calls). Fire-and-forget so the port stays open.
    (async () => {
      try {
        const { setupVite } = await import("./vite");
        await setupVite(httpServer, app);
        log("Vite dev server ready");
      } catch (err: any) {
        console.error('[vite] setupVite failed (non-fatal):', err?.message ?? err);
      }
    })();
  }
})();

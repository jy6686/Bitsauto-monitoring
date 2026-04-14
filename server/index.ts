import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

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
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", "data:", "blob:"],
      connectSrc:     ["'self'", "ws:", "wss:"],  // WebSocket for Vite HMR
      fontSrc:        ["'self'", "data:"],
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

// ── Body size limit (prevent large payload attacks) ───────────────────────────
app.use(express.json({
  limit: '1mb',
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
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

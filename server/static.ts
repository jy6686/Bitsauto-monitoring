import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html for SPA client-side routes.
  // IMPORTANT: /api/* must call next() so API handlers are reached
  // even if this catch-all was registered before registerRoutes()
  // finished (e.g. via the 60-second startup-safety timeout race).
  // Uses originalUrl (not path) so this is safe under any mount prefix.
  app.use("/{*path}", (req, res, next) => {
    if (req.originalUrl.startsWith("/api/")) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

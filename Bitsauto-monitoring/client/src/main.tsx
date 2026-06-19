import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Platform-wide UTC display enforcement ──────────────────────────────────────
// All Date.prototype.toLocale* calls across every page, report, graph, and alert
// will render in UTC (GMT+00) unless they explicitly set { timeZone: '...' }.
// This is a single zero-touch fix for all 60+ files in the codebase.
(function enforceUTCDisplay() {
  const _str  = Date.prototype.toLocaleString;
  const _time = Date.prototype.toLocaleTimeString;
  const _date = Date.prototype.toLocaleDateString;

  Date.prototype.toLocaleString = function(
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ): string {
    if (options?.timeZone) return _str.call(this, locales, options);
    return _str.call(this, locales ?? 'en-GB', { timeZone: 'UTC', ...options });
  };

  Date.prototype.toLocaleTimeString = function(
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ): string {
    if (options?.timeZone) return _time.call(this, locales, options);
    return _time.call(this, locales ?? 'en-GB', { timeZone: 'UTC', ...options });
  };

  Date.prototype.toLocaleDateString = function(
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ): string {
    if (options?.timeZone) return _date.call(this, locales, options);
    return _date.call(this, locales ?? 'en-GB', { timeZone: 'UTC', ...options });
  };
})();

createRoot(document.getElementById("root")!).render(<App />);

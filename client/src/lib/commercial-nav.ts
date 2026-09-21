/**
 * Where the Rate Manager lives, depending on who is asking.
 *
 * The Commercial Portal has its own Rate Manager surface at `/commercial/rate-manager`,
 * restricted to three tabs — Rate Analysis, Push Rate (the `jobs` tab) and Send Rate — with the
 * push-job drawer's Re-send and Download suppressed. That restriction is certified in
 * production.
 *
 * It was also trivially avoidable. The Commercial Workspace linked to `/rate-manager` in three
 * places, and that route carries all eight tabs and both controls, so a Commercial user reached
 * the unrestricted page in one click from inside the portal. The filter was never wrong; there
 * was simply a way around it. This module is the one place that decides which path to use, so
 * a future link cannot reintroduce the bypass by hardcoding the platform route again.
 *
 * The platform Rate Manager is deliberately unchanged: outside the Commercial Portal this
 * returns `/rate-manager`, because a helper that always pointed at the Commercial surface would
 * quietly drop NOC and Finance users into a three-tab page.
 */

/** The Commercial Portal's own, tab-restricted Rate Manager. */
export const COMMERCIAL_RATE_MANAGER_PATH = '/commercial/rate-manager';

/** The platform-wide Rate Manager, with all eight tabs. */
export const PLATFORM_RATE_MANAGER_PATH = '/rate-manager';

/**
 * The Rate Manager path appropriate to the portal the user is currently in. Only the Commercial
 * Portal has a scoped surface today; every other context keeps the platform route.
 */
export function rateManagerPathFor(activePortal: string | null): string {
  return activePortal === 'commercial' ? COMMERCIAL_RATE_MANAGER_PATH : PLATFORM_RATE_MANAGER_PATH;
}

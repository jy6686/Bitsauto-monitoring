/**
 * portals/configs/index.ts — Static portal configuration registry.
 *
 * Maps portal slugs to their static PortalConfig objects.
 * Add an entry here when a new portal config file is created.
 *
 * This is the single point of truth that PortalNavBar and DashboardTemplate
 * use to resolve the static navigation/workflow/widget configuration for a
 * given portal slug. It is NEVER driven by the backend — portal_sections and
 * portal_module_assignments (Model A) are a separate runtime concern.
 */

import { nocPortalConfig } from './noc.config';
import type { PortalConfig } from '../types/portal-config.types';

/**
 * REGISTRY: portal slug → static PortalConfig.
 * Add an entry here when a portal config file is created.
 * Portals not yet configured (commercial, finance, admin) are omitted
 * until their config files exist.
 */
const REGISTRY: Record<string, PortalConfig> = {
  noc: nocPortalConfig,
};

/**
 * Returns the static PortalConfig for a given portal slug,
 * or null if no config has been defined for that portal yet.
 */
export function getStaticPortalConfig(slug: string): PortalConfig | null {
  return REGISTRY[slug] ?? null;
}

export { nocPortalConfig };

/**
 * portal-validation.ts — Sprint #367 server-side portal assignment validation.
 *
 * Centralises all business rules for user portal assignments so every consumer
 * (PATCH /api/users/:id/portal-assignment in Sprint #366, seed endpoints, etc.)
 * gets the same enforcement automatically.
 *
 * Rules:
 *   FULL_PLATFORM  → assignedPortals + defaultPortal are cleared; no portal needed
 *   PORTAL_ONLY    → must have exactly one defaultPortal; defaultPortal must be in assignedPortals
 *   HYBRID         → must have ≥1 assignedPortal; defaultPortal (if set) must be in assignedPortals
 *   DISABLED       → short-circuits everything — blocked at login, no validation needed
 *   All portal slugs in assignedPortals must be in VALID_PORTAL_KEYS
 */
import { VALID_PORTAL_KEYS, isValidPortalKey } from "@shared/lib/portal-constants";

export interface PortalAssignmentParams {
  /** 'full_platform' | 'portal_only' | 'hybrid' */
  accessScope:      string;
  defaultPortal:    string | null | undefined;
  assignedPortals:  string[];
  /** Optional — 'active' | 'disabled'. When 'disabled', short-circuit silently. */
  status?:          string | null;
}

export interface ValidationResult {
  valid:   boolean;
  error?:  string;
  /**
   * When valid, the normalised values to persist:
   *   - assignedPortals may be emptied (FULL_PLATFORM)
   *   - defaultPortal may be nulled out
   */
  normalised?: {
    assignedPortals: string[];
    defaultPortal:   string | null;
  };
}

/**
 * Validates a portal assignment request and returns normalised values to persist.
 * Call this before any PATCH/PUT that writes `platform_access_type`,
 * `default_portal`, or `user_portal_assignments`.
 */
export function validatePortalAssignment(
  params: PortalAssignmentParams
): ValidationResult {
  const { accessScope, defaultPortal, assignedPortals, status } = params;

  // ── Disabled user — short-circuit ────────────────────────────────────────────
  if (status === "disabled") {
    // Disabled accounts are blocked at login; no portal validation applies.
    return {
      valid: true,
      normalised: { assignedPortals: [], defaultPortal: null },
    };
  }

  // ── Validate portal slugs ─────────────────────────────────────────────────────
  const invalidSlugs = assignedPortals.filter((s) => !isValidPortalKey(s));
  if (invalidSlugs.length > 0) {
    return {
      valid: false,
      error: `Invalid portal slug(s): ${invalidSlugs.join(", ")}. Valid portals are: ${VALID_PORTAL_KEYS.join(", ")}.`,
    };
  }

  // ── Deduplicate ───────────────────────────────────────────────────────────────
  const portals = [...new Set(assignedPortals)];

  switch (accessScope) {
    // ── FULL_PLATFORM ─────────────────────────────────────────────────────────
    case "full_platform": {
      // Full-platform users need no portal assignments — clear them on save.
      return {
        valid:       true,
        normalised:  { assignedPortals: [], defaultPortal: null },
      };
    }

    // ── PORTAL_ONLY ───────────────────────────────────────────────────────────
    case "portal_only": {
      if (portals.length === 0) {
        return {
          valid: false,
          error: "Portal-only users must have at least one assigned portal.",
        };
      }
      if (!defaultPortal) {
        return {
          valid: false,
          error: "Portal-only users must have a default portal set.",
        };
      }
      if (!isValidPortalKey(defaultPortal)) {
        return {
          valid: false,
          error: `Default portal "${defaultPortal}" is not a valid portal key. Valid portals: ${VALID_PORTAL_KEYS.join(", ")}.`,
        };
      }
      if (!portals.includes(defaultPortal)) {
        return {
          valid: false,
          error: `Default portal "${defaultPortal}" must be in the user's assigned portals list.`,
        };
      }
      return {
        valid:      true,
        normalised: { assignedPortals: portals, defaultPortal },
      };
    }

    // ── HYBRID (MULTI_PORTAL) ─────────────────────────────────────────────────
    case "hybrid": {
      if (portals.length === 0) {
        return {
          valid: false,
          error: "Multi-portal (hybrid) users must have at least one assigned portal.",
        };
      }
      // defaultPortal is optional for hybrid — but if set it must be valid + assigned
      if (defaultPortal) {
        if (!isValidPortalKey(defaultPortal)) {
          return {
            valid: false,
            error: `Default portal "${defaultPortal}" is not a valid portal key.`,
          };
        }
        if (!portals.includes(defaultPortal)) {
          return {
            valid: false,
            error: `Default portal "${defaultPortal}" must be in the user's assigned portals list.`,
          };
        }
      }
      return {
        valid:      true,
        normalised: { assignedPortals: portals, defaultPortal: defaultPortal ?? null },
      };
    }

    default:
      return {
        valid: false,
        error: `Unknown access scope "${accessScope}". Must be one of: full_platform, portal_only, hybrid.`,
      };
  }
}

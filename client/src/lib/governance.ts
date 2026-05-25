// ── Platform Governance Utilities ─────────────────────────────────────────────
// Authoritative source for role capability rules, portal exclusions, and
// feature flag definitions. All permission checks should derive from here.
// Derived from: .local/platform-architecture.md (the platform constitution)

import type { Role } from "@shared/schema";

// ── Role Capability Definitions ────────────────────────────────────────────────

export const ROLE_CAPABILITIES: Record<Role, {
  label: string;
  canApproveFailover: boolean;
  canExecuteRouting: boolean;
  canViewIntelligenceEvidence: boolean;
  canViewFullExplainability: boolean;
  canModifyPolicyThresholds: boolean;
  canModifyVendorWhitelist: boolean;
  canAcknowledgeAlerts: boolean;
  canBypassApproval: boolean;
  portalScope: 'full' | 'operational' | 'monitoring' | 'none';
}> = {
  super_admin: {
    label: 'Super Admin',
    canApproveFailover: true,
    canExecuteRouting: true,
    canViewIntelligenceEvidence: true,
    canViewFullExplainability: true,
    canModifyPolicyThresholds: true,
    canModifyVendorWhitelist: true,
    canAcknowledgeAlerts: true,
    canBypassApproval: true,
    portalScope: 'full',
  },
  admin: {
    label: 'Admin',
    canApproveFailover: true,
    canExecuteRouting: true,
    canViewIntelligenceEvidence: true,
    canViewFullExplainability: true,
    canModifyPolicyThresholds: true,
    canModifyVendorWhitelist: true,
    canAcknowledgeAlerts: true,
    canBypassApproval: false,
    portalScope: 'full',
  },
  destination_manager: {
    label: 'Destination Manager',
    canApproveFailover: true,        // PRIMARY AUTHORITY: routing decision
    canExecuteRouting: false,         // HARD RULE: approver ≠ executor
    canViewIntelligenceEvidence: true,
    canViewFullExplainability: true,  // full evidence stack
    canModifyPolicyThresholds: true,
    canModifyVendorWhitelist: true,
    canAcknowledgeAlerts: true,
    canBypassApproval: false,
    portalScope: 'full',
  },
  routing_admin: {
    label: 'Routing Admin',
    canApproveFailover: false,        // HARD RULE: executor cannot approve
    canExecuteRouting: true,          // PRIMARY AUTHORITY: routing execution
    canViewIntelligenceEvidence: false,
    canViewFullExplainability: false, // sees execution impact only
    canModifyPolicyThresholds: false,
    canModifyVendorWhitelist: false,
    canAcknowledgeAlerts: true,
    canBypassApproval: false,         // emergency bypass is restricted + audited
    portalScope: 'operational',
  },
  noc_operator: {
    label: 'NOC Operator',
    canApproveFailover: false,
    canExecuteRouting: false,
    canViewIntelligenceEvidence: false,
    canViewFullExplainability: false, // executive summary only
    canModifyPolicyThresholds: false,
    canModifyVendorWhitelist: false,
    canAcknowledgeAlerts: true,
    canBypassApproval: false,
    portalScope: 'monitoring',
  },
  team_lead: {
    label: 'Team Lead',
    canApproveFailover: false,
    canExecuteRouting: false,
    canViewIntelligenceEvidence: false,
    canViewFullExplainability: false,
    canModifyPolicyThresholds: false,
    canModifyVendorWhitelist: false,
    canAcknowledgeAlerts: true,
    canBypassApproval: false,
    portalScope: 'monitoring',
  },
  management: {
    label: 'Management',
    canApproveFailover: false,
    canExecuteRouting: false,
    canViewIntelligenceEvidence: true,
    canViewFullExplainability: true,
    canModifyPolicyThresholds: false,
    canModifyVendorWhitelist: false,
    canAcknowledgeAlerts: true,
    canBypassApproval: false,
    portalScope: 'full',
  },
  viewer: {
    label: 'Viewer',
    canApproveFailover: false,
    canExecuteRouting: false,
    canViewIntelligenceEvidence: false,
    canViewFullExplainability: false,
    canModifyPolicyThresholds: false,
    canModifyVendorWhitelist: false,
    canAcknowledgeAlerts: false,
    canBypassApproval: false,
    portalScope: 'none',
  },
};

// ── Explainability Depth by Role ───────────────────────────────────────────────
// Used by the Explainability Drawer to determine what evidence to surface.
// Depth is determined ONLY by role — never by user-configurable settings.
export type ExplainabilityDepth = 'executive_summary' | 'full_evidence' | 'execution_impact' | 'audit_only' | 'none';

export function getExplainabilityDepth(role: Role): ExplainabilityDepth {
  switch (role) {
    case 'super_admin':
    case 'admin':
    case 'destination_manager':
    case 'management':
      return 'full_evidence';
    case 'routing_admin':
      return 'execution_impact';
    case 'noc_operator':
    case 'team_lead':
      return 'executive_summary';
    case 'viewer':
    default:
      return 'none';
  }
}

// ── Portal Exclusion Policy ────────────────────────────────────────────────────
// Paths that external-facing portal contexts (viewer, client portal, reseller)
// must NEVER access. This is an EXPLICIT deny-list — not implicit role hiding.
export const INTELLIGENCE_EXCLUDED_FROM_PORTAL: string[] = [
  '/route-optimisation',
  '/simulation-sandbox',
  '/traffic-steering',
  '/vendor-rca',
  '/vendor-prefix-intelligence',
  '/routing-intelligence',
  '/intelligence',
  '/intelligence-validation',
  '/ai-ops',
  '/cost-optimisation',
  '/carrier-intelligence',
  '/number-intelligence',
];

// Roles that represent external portal access contexts.
// These roles must never see Intelligence-domain evidence internals.
export const PORTAL_CONTEXT_ROLES: Role[] = ['viewer'];

// ── Governance Rule: Approver ≠ Executor ──────────────────────────────────────
// The same user must never approve AND execute the same routing change.
// Use this to validate before any approval/execution action.
export function canApproveFailover(role: Role): boolean {
  return ROLE_CAPABILITIES[role]?.canApproveFailover ?? false;
}

export function canExecuteRouting(role: Role): boolean {
  return ROLE_CAPABILITIES[role]?.canExecuteRouting ?? false;
}

// Returns true if a proposed approval+execution by the same role violates governance.
export function violatesApproverExecutorSeparation(role: Role): boolean {
  return canApproveFailover(role) && canExecuteRouting(role);
}

// ── Feature Flag Definitions ───────────────────────────────────────────────────
// Feature flags control progressive activation of automation layers.
// Each flag has a defined owner role — only that role can toggle it.
// Every toggle must produce an audit log entry.

export interface FeatureFlagDefinition {
  key: string;
  label: string;
  description: string;
  ownerRole: Role;
  automationLevel: 'L1' | 'L2' | 'L3' | 'L4';
  defaultEnabled: boolean;
}

export const PLATFORM_FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    key: 'governance_v2',
    label: 'Governance V2',
    description: 'Enables role-based permission boundaries, Destination Manager authority, and Routing Admin execution separation.',
    ownerRole: 'admin',
    automationLevel: 'L1',
    defaultEnabled: true,
  },
  {
    key: 'explainability_v2',
    label: 'Governance-Aware Explainability',
    description: 'Enables role-scoped explainability depth in the recommendation drawer — executive summary for NOC, full evidence for Destination Manager.',
    ownerRole: 'admin',
    automationLevel: 'L1',
    defaultEnabled: true,
  },
  {
    key: 'simulation_validation',
    label: 'Simulation Validation Requirement',
    description: 'Requires simulationValidatedAt to be set before a failover policy can be enabled. Surfaces inline "Simulate Now" action in policy flow.',
    ownerRole: 'destination_manager',
    automationLevel: 'L2',
    defaultEnabled: false,
  },
  {
    key: 'intelligent_failover',
    label: 'Policy-Governed Intelligent Failover',
    description: 'Enables L2 conditional auto-failover under strict policy constraints: whitelisted vendors only, bounded traffic shift, simulation pre-validated, rollback-protected.',
    ownerRole: 'admin',
    automationLevel: 'L2',
    defaultEnabled: false,
  },
];

// ── Intelligence Access Roles ──────────────────────────────────────────────────
// Roles that may access Intelligence domain pages and data.
export const INTELLIGENCE_ACCESS_ROLES: Role[] = [
  'super_admin',
  'admin',
  'destination_manager',
  'management',
];

// Roles with access to Intelligence advisory tools (broader — includes NOC for summaries)
export const INTELLIGENCE_ADVISORY_ROLES: Role[] = [
  'super_admin',
  'admin',
  'destination_manager',
  'management',
  'noc_operator',
  'team_lead',
];

// ── Routing Execution Roles ────────────────────────────────────────────────────
export const ROUTING_EXECUTION_ROLES: Role[] = [
  'super_admin',
  'admin',
  'routing_admin',
];

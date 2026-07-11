# Portal Rationalization (governance model)

Part of the [Platform Feature Review](../README.md). **Analysis only** — no feature
is moved, hidden, deactivated, renamed, or removed; no menu changes. Everything stays
**Active** and every assignment stays **Pending** until owner-approved (PFR §6.1).

## Core rule — One System of Record, Multiple Portal Views
The same capability may appear in several portals with **different permissions and
context** — instead of duplicate implementations. Every feature declares:
- **Primary Owner** — the one portal that manages it (system of record).
- **Visible In** — other portals that may access it.
- **Permission** per portal — No Access · View · Read-Only · Create · Edit · Delete · Approve · Full.

Example: Vendor Rates → Primary **Commercial** (Full); Visible in **NOC** (View),
**KAM** (Send-to-assigned). Balance → Primary **Finance** (Full); **KAM** (Read-only).

## The five portals (proposed — for owner review)
| Portal | Role | Primary of (examples) |
|--------|------|-----------------------|
| **NOC** | Real-time operations command centre | Live monitoring, routing ops, diagnostics, alerts, BitsEye 2, telemetry |
| **Finance** | All monetary workflows | Billing, invoices, credit, payments, reconciliation, balances |
| **KAM** | Customer-centric (hierarchy-scoped) | My customers, tickets, SLA, deals, customer-scoped views |
| **Commercial** | Commercial/routing config (system of record) | Vendor rates, product registry, mapping, destination catalog, routing policy, approvals |
| **Platform / Admin** | Governance & administration | Users, roles, hierarchy, nav manager, settings, API keys, audit |

## Discovery phase (current)
Per-portal, in this order — **inventory & classify first, move nothing**:
1. [NOC](NOC-discovery.md) ← current
2. Finance · 3. Commercial · 4. KAM · 5. Platform/Admin

Each feature: Current location → Operational capability → **Proposed Owner** →
Cross-portal visibility/permission → **Decision: Pending**.

## Future capability (SPEC ONLY — not built)
**Portal Assignment Manager** — make portal membership *configurable* (assign/remove
features per portal, set primary + secondary + permission, drag-drop menu builder,
portal profiles, visibility rules) instead of hardcoded menus. Proposed data model:

```
portals(id, name, code, status, display_order)
features(id, feature_code, feature_name, route, component, status)
portal_feature_assignments(portal_id, feature_id, is_primary, permission,
                           menu_order, parent_menu, is_visible, default_page)
portal_feature_permissions(portal_feature_assignment_id, role_id, permission)
```
Safe-change workflow: **Draft → Review → Approve → Publish → Audit Log** (no change
goes live immediately). **This is a future build (code) — frozen until the portal
inventories are complete and the owner approves.** Documented here as intent only.

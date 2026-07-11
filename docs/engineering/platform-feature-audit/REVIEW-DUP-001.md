# Structured Review — DUP-001: AI Ops Center ↔ Decision Overlay

**Confidence:** High · **Class:** A (navigation alias, not a functional duplicate) · **Decision: Pending**

## Features under review

| | AI Ops Center | Decision Overlay |
|---|---|---|
| Path | `/ai-ops` | `/ai-ops?tab=decision-overlay` |
| Page component | `client/src/pages/ai-ops.tsx` (2,551 LOC) | **same file** |
| Registry group | Intelligence | Intelligence |
| Roles | admin, management, super_admin, noc_operator, team_lead | identical |

## Evidence

1. **Same page.** Both nav entries render `AiOpsPage`. "Decision Overlay" is a feed tab inside AI Ops Center (`ai-ops.tsx:812`, tab key `'overlay'`), fed by `/api/ai-ops/decision-overlay` (`ai-ops.tsx:369`).
2. **The deep link is dead.** The tab state initializes unconditionally — `const [feedTab, setFeedTab] = useState<FeedTab>('all')` (`ai-ops.tsx:202`) — and the page never reads the `?tab=` query parameter. Clicking "Decision Overlay" in navigation opens AI Ops Center on the **default "all" tab**, not the overlay.
3. **Inventory effect.** The registry double-counts one page as two features, and one of the two entries doesn't do what its label promises.

## Review fields

- **Business purpose:** AI Ops Center is the AI decisioning surface (incidents, anomalies, recommendations, actions, NLQ). Decision Overlay is one view within it showing per-connection AI verdicts.
- **User personas:** identical role list for both entries.
- **Primary workflows:** all workflows live in the single page; the overlay tab is read-mostly within it.
- **Data ownership:** `ai-ops.tsx` is the candidate canonical owner of `/api/aiops`, `/api/anomalies`, `/api/incidents`, `/api/recommendations`, `/api/routing-suggestions` (see DEPENDENCY-MATRIX.md).
- **Shared APIs:** 100% (same file). **Shared workflow:** yes (same page).
- **UI overlap:** total — one is a tab of the other.

## Recommendation (for approval — no action taken)

This is a **navigation rationalization**, not a feature merge. Options, in order of preference:

1. **Fix the deep link + keep both entries** — make `ai-ops.tsx` read `?tab=` and select the overlay tab. Zero features lost; the nav entry finally works as labelled.
2. **Remove the Decision Overlay nav entry** — keep the tab inside AI Ops Center. Reduces the registry by one alias.
3. Keep as-is (not recommended — the current link is misleading).

Whichever option is chosen, no backend, page, or data changes are involved.

**Decision:** Pending

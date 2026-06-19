# Fix History Documentation
Bitsauto Monitoring Platform — Global Fix Button System

---

## Overview

The Fix History system records every fix attempt made through the Global Fix Button, whether triggered manually by a user or automatically by the background auto-recovery job. This creates a full audit trail and enables the system to suggest previously successful fixes for recurring issues.

---

## Database Schema

Table: `fix_history`

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Auto-increment row ID |
| `page` | text | Page/module where the fix was triggered (e.g. "CDR Viewer", "Analytics") |
| `issueType` | text | Issue classification code (e.g. "API_FAILURE", "NO_DATA", "AUTH_ERROR") |
| `component` | text | Affected system component (e.g. "Sippy API", "CDR Cache", "Database") |
| `fixAction` | text | Action applied (e.g. "retry_sippy", "warm_cdr_cache", "check_db") |
| `outcome` | text | Result: `success`, `failure`, `skipped`, `auto` |
| `outcomeMessage` | text | Human-readable result message |
| `triggeredBy` | text | `manual` (user click) or `auto` (background job) |
| `performedBy` | text | User email/ID for manual fixes; `"system"` for auto fixes |
| `createdAt` | timestamp | When the fix was attempted |

---

## Issue Type Codes

| Code | Meaning | Typical Fix |
|------|---------|-------------|
| `API_FAILURE` | Sippy XML-RPC call failed | retry_sippy |
| `AUTH_ERROR` | Sippy rejected credentials | Re-enter credentials in Settings |
| `TIMEOUT` | API call timed out | retry_sippy, check network |
| `NO_DATA` | Cache or DB table is empty | warm_cdr_cache, refresh_accounts |
| `DATA_MISMATCH` | Data is stale or inconsistent | warm_cdr_cache |
| `BACKEND_ERROR` | Database/server error | check_db |
| `UI_ERROR` | Frontend JavaScript errors | Check browser DevTools |
| `UNKNOWN` | Unclassified | Manual investigation |

---

## Fix Actions

| Action | Description | Success Condition |
|--------|-------------|------------------|
| `retry_sippy` | Calls `listActiveCalls` to re-test Sippy API | Returns without exception |
| `warm_cdr_cache` | Reports current CDR cache size | Cache is non-empty |
| `check_db` | Runs a test query against PostgreSQL | Query succeeds |
| `refresh_accounts` | Calls `listSippyAccounts` to sync account list | Returns account array |
| `refresh_vendors` | Calls `listSippyVendors` to sync vendor list | Returns vendor array |

---

## Auto-Recovery Rules

### Rule 1: sippy_retry
- **Trigger**: 3 or more consecutive Sippy API failures detected by the `/api/fix/diagnose` endpoint
- **Cooldown**: 5 minutes between auto-retry attempts
- **Action**: Calls `getSippyActiveCalls` to test the connection
- **History Entry**: `triggeredBy=auto, performedBy=system, fixAction=retry_sippy`
- **Consecutive counter**: Reset to 0 on any successful API call; incremented on each failure

### Rule 2: cdr_stale_log
- **Trigger**: CDR cache has not been refreshed in 15+ minutes (and cache is non-empty — i.e. CDRs exist but aren't updating)
- **Action**: Logs an alert event (does not attempt a fix)
- **History Entry**: `triggeredBy=auto, outcome=auto, fixAction=warm_cdr_cache`

---

## Past Fix Lookup

When the `/api/fix/diagnose` endpoint detects an issue, it calls `storage.findSimilarFix(issueType, component)` to find the most recent successful fix for that same issue type. This is shown to the user as a "Previously resolved" badge with:
- The fix action that worked
- Who performed it
- When it was resolved

This allows NOC engineers to immediately see what worked last time.

---

## API Endpoints

### GET /api/fix/history
Returns the last 50 fix history entries, ordered by most recent first.

**Query params**: `?limit=N` (max 200)

**Response**:
```json
{
  "history": [
    {
      "id": 42,
      "page": "CDR Viewer",
      "issueType": "NO_DATA",
      "component": "CDR Cache",
      "fixAction": "warm_cdr_cache",
      "outcome": "success",
      "outcomeMessage": "CDR cache holds 15234 records.",
      "triggeredBy": "manual",
      "performedBy": "admin@company.com",
      "createdAt": "2026-04-18T11:00:00.000Z"
    }
  ],
  "total": 1
}
```

### GET /api/fix/auto-rules
Returns the current state of auto-recovery rules.

**Response**:
```json
{
  "rules": [
    {
      "id": "sippy_retry",
      "name": "Auto Retry Sippy API",
      "trigger": "sippy_fail_3x",
      "enabled": true,
      "description": "Triggers after 3 consecutive Sippy API failures."
    }
  ],
  "consecutiveSippyFailures": 0,
  "lastAutoFixAt": null,
  "totalAutoFixes": 0,
  "lastEvent": null
}
```

---

## Frontend Display

The Fix History tab in the Fix Button modal shows:
- Outcome icon (✓ success / ✗ failure / CPU auto)
- Issue type badge (colour-coded)
- Fix action applied (human-readable label)
- Outcome status
- Outcome message (truncated to 2 lines)
- Page/context, triggeredBy indicator, performer, timestamp

Access: Admin and Management roles only.

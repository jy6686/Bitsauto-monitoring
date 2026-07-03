---
name: Sippy timeout and credential session loss
description: Why live calls drop to 0 after server restart and the timeout chain causing re-auth failure
---

## The Problem

After a server restart, `smartSippyConnect` fails to re-authenticate with Sippy, leaving `activeSession = null`. All snapshot polls then hit `noNewLogin=true` guard and return empty. Dashboard shows 0.

## Root Causes

**1. Session is in-memory only** — `activeSession` in `sippy.ts` is a module-level variable. Lost on every restart. No DB persistence. The session that was "working" before was established at the original server start and stayed alive across HMR hot reloads, but NOT across process restarts.

**2. Portal auth timeout was too short** — `rawRequest()` (used by `portalLogin`) had `timeout: 15000`. Sippy's HTTPS portal at `191.101.30.107` responds in ~16 seconds. Off by 1 second, causing every portal login attempt to fail with "Request timed out".

**3. XML-RPC timeout was too short** — `rawPost()` had `timeout: 12000`, `sippyPost()` default was `12000`. Sippy's XML-RPC `/xmlapi/xmlapi` also takes ~15s to return a 401.

## Timeout Fixes Applied

| Function | Old | New |
|----------|-----|-----|
| `rawPost()` socket timeout | 12000ms | 35000ms |
| `rawGet()` socket timeout | 12000ms | 35000ms |
| `sippyPost()` default | 12000ms | 35000ms |
| `rawRequest()` socket timeout | 15000ms | 45000ms |

## Snapshot Polling Fixes

| Constant | Old | New |
|----------|-----|-----|
| `SNAPSHOT_INTERVAL_MS` default | 45000ms | 10000ms |
| `ZERO_CONFIRM_COUNT` | 2 | 8 |
| `LIVE_CALLS_CACHE_MAX` | 65000ms | 30000ms |
| `LIVE_CALLS_STALE_MS` | 45000ms | 20000ms |

10s polling catches 7-second WaitRoute OTP calls. 8× zero-confirm means 80s of protection before cache clears.

## Credential Note

After disk crisis + Sippy restart, stored credentials (`!chiaan1` for XML-RPC, `HumJeet@y2019` for portal) may be stale. User must log into Sippy directly, verify ssp-root API password (My Preferences → Allow API Calls), then update in platform Settings and click Save & Connect.

**Why:** Sippy restarts can reset the API password field on reseller accounts if the config was stored on the disk that had issues.

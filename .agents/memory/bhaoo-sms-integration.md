---
name: BhaooSMS Integration
description: REVE SMS V5.3.0 integration — service layer, routes, DB tables, SMS Monitor dashboard. Credentials via BHAOO_API_KEY + BHAOO_SECRET_KEY env vars.
---

# BhaooSMS / REVE SMS V5 Integration

**Platform:** BhaooSMS V5 at `http://149.20.185.6/BhaooSMSV5`
**API Version:** 5.3.0
**Auth:** API Key + Secret Key (server-side only via env vars)

## Architecture
- Service layer: `server/services/bhaoo/` (types, client, sms, dlr, balance, index)
- Routes: `server/routes-bhaoo.ts` → registered by `registerBhaooRoutes(app)` at bottom of `server/routes.ts`
- DB tables (created via direct SQL): `sms_messages`, `sms_dlr_events`, `bhaoo_balance_log`, `sms_vendor_stats`
- Schema types: added to end of `shared/schema.ts`
- Frontend: `client/src/pages/sms-monitor.tsx` (live data, replaces mock)
- Nav: "Messaging" group added to Operations domain in `app-nav-shell.tsx`

## API Endpoints
- `GET /api/bhaoo/status` — connection + balance check
- `GET /api/bhaoo/balance` — balance (logs to bhaoo_balance_log)
- `GET /api/bhaoo/balance/history` — balance history
- `POST /api/sms/send` — single SMS send
- `POST /api/sms/send-bulk` — bulk SMS (max 100)
- `POST /api/bhaoo/dlr` — DLR webhook receiver (no auth — BhaooSMS calls this)
- `GET /api/bhaoo/dlr/:messageId` — query delivery status
- `GET /api/bhaoo/messages` — message log
- `GET /api/bhaoo/stats` — delivery analytics (last 24h)
- `POST /api/bhaoo/recharge` — account recharge

## DLR Webhook
Configure in BhaooSMS HTTP profile: `POST https://<yourdomain>/api/bhaoo/dlr`
This endpoint has no auth guard (public) so BhaooSMS can push delivery reports.

## Environment Variables
- `BHAOO_API_KEY` — BhaooSMS API key
- `BHAOO_SECRET_KEY` — BhaooSMS secret key
- `BHAOO_BASE_URL` — optional override (default: http://149.20.185.6/BhaooSMSV5)

**Why:** API path pattern is `/api/` for send, `/api/balance/` for balance, `/api/dlr/` for DLR query — REVE V5 standard paths.

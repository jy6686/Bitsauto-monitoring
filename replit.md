# Bitsauto Monitoring Platform
A full-stack VoIP monitoring dashboard offering real-time metrics, alerting, team management, and live softswitch integration for enhanced telecom operations.

## Run & Operate
- **Run `client` and `server`**: `npm run dev`
- **Build**: `npm run build`
- **Typecheck**: `npm run typecheck`
- **Codegen**: `npm run codegen`
- **DB Push**: `npm run db:push`
- **Required Env Vars**: `DATABASE_URL`, `SIPP_URL`, `SIPP_ADMIN_USERNAME`, `SIPP_ADMIN_PASSWORD`, `PORTAL_USERNAME`, `PORTAL_PASSWORD`, `ADMIN_WEB_PASSWORD`, `AUTH_SECRET`, `REPLIT_AUTH_ENABLED`

## Stack
- **Frontend**: React, Vite, TailwindCSS
- **Backend**: Express, TypeScript
- **Database**: PostgreSQL (via Drizzle ORM)
- **Authentication**: Replit Auth (OpenID Connect)
- **Deployment**: Replit
- **Build Tool**: Vite

## Where things live
- **Frontend Source**: `client/src/`
- **Backend Source**: `server/`
- **Shared Schemas (DB, types)**: `shared/`
- **DB Schema**: `shared/schema.ts`
- **API Contracts**: Defined implicitly by `server/routes.ts` and `client/src/api/`
- **Theme Files**: `client/src/index.css` (TailwindCSS theme variables)
- **Sippy Integration Logic**: `server/sippy.ts`
- **User Manual Generator**: `server/manual-generator.ts`

## Architecture decisions
- **Sippy Load Reduction**: Implemented push-based NOC WebSocket, cache-first API endpoints (`/api/sippy/live-calls`), mutex guards for polling functions, and staggered/reduced interval background jobs to decrease Sippy XML-RPC calls by ~65-70%.
- **Read-Only by Default**: The platform is designed for safe 24/7 operation against production Sippy instances, with all background processes being read-only and write operations requiring explicit user action.
- **Credential Swap Resilience**: `sippyXmlCredsPairs()` and API routes (`/api/sippy/accounts`, `/api/sippy/vendors`) retry with fallback credentials on HTTP 401/403 errors, providing immunity to credential misconfiguration.
- **Product/Trunk Class Schema**: Uses a leading-digit prefix encoding for product classification and destination identification, impacting rate cards, analytics, and routing.
- **Global Fix Button System**: An intelligent, module-aware diagnostic and self-healing system covering every page, featuring issue detection, one-click fixes, and auto-recovery rules.

## Product
- **Real-time Monitoring**: Live call data, network performance (Jitter, Latency, Packet Loss, MOS), and telecom KPIs (ASR, ACD, PDD).
- **Advanced Analytics**: BitsEye drill-down analytics, Revenue & Margin analysis, Cost Optimization Engine, LCR Analyser.
- **Operations & Management**: Multi-Switch consolidated view, Routing Manager (groups, destination sets, connections, QBR, policy simulator), Test Call Launcher, Call Flow Simulator, Vendor Connection Module.
- **Security & Fraud**: FAS/IRSF detection, Auto-Blacklist, SIP OPTIONS Monitor, configurable approval engine for Sippy operations.
- **User Experience**: Dark/Light mode, Command Palette, customizable dashboard widgets, mobile-responsive NOC view, internal team chat.
- **Team & Access Management**: Role-based access control, KAM management with organizational hierarchy, dedicated Role Assignment tab.

## User preferences
- _Populate as you build_

## Gotchas
- **Sippy Credential Mapping**: Be cautious with `apiAdminUsername`, `apiAdminPassword`, `portalUsername`, `portalPassword`, and `adminWebPassword`. A common mistake is swapping them, which the system attempts to detect and warn about. The primary switch (SB-1) uses specific portal session and XML-RPC credentials.
- **XML-RPC vs. Portal Scraping**: Some Sippy versions or configurations may require portal scraping instead of XML-RPC for certain data (e.g., CDRs if XML-RPC returns 401). The system includes fallbacks but be aware of the underlying method.
- **Sippy API Nuances**: Specific XML-RPC calls have unique requirements (e.g., `createAccount` requires `welcome_call_ivr` and `on_payment_action` as integer `0`, not null). Always refer to Sippy documentation for exact parameters.
- **Rate Card Updates**: On certain Sippy versions, rates must be added via the Sippy web UI, as no XML-RPC rate API is available.
- **Simulation Mode**: The platform's simulation mode is disabled by default (`simulationEnabled = false`). Ensure proper connection to a live Sippy instance for real data.

## Pointers
- **Replit Docs**: [https://docs.replit.com/](https://docs.replit.com/)
- **Drizzle ORM Docs**: [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **TailwindCSS Docs**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **Sippy API Articles**: 106909 (API intro), 107448 (make2WayCallback), 107462 (makeCall/listActiveCalls), 107525 (Simple API)
- **RFC 2617 (Digest Auth)**: For understanding Sippy's HTTP Digest Authentication.
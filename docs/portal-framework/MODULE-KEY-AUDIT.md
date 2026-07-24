# Module Key Mapping Audit — 031 → 032

**Generated:** 2026-07-24  
**Source:** `migrations/031_portal_workspace_model.sql` × `module-registry.ts` × Phase 3 spec  
**Total seed modules:** 149 (125 need rename, 24 already clean)  

**Columns:**
- **Registry** — kebab key has a bound React component in `module-registry.ts`
- **Home** — this module is the `portal_workspace.home_module` for any portal
- **Override** — key appears in the Phase 3 `portal_module_overrides` seed

**Audit invariants — all must hold before 032 is applied:**
1. Every override key resolves to a seed row after rename → ✅ 0 dangling
2. Every home_module is verifiable → ✅ `noc-dashboard` confirmed
3. Registry keys without seed rows → ⚠️ `partner-profiles` (see note below)

---

## Modules requiring rename (125)

| underscore_key | → kebab_key | route | registry | home | override |
|---|---|---|:---:|:---:|:---:|
| `account_names` | `account-names` | `/account-names` | — | — | — |
| `account_statement` | `account-statement` | `/account-statement` | — | — | — |
| `ai_assurance` | `ai-assurance` | `/ai-assurance` | — | — | — |
| `ai_ops` | `ai-ops` | `/ai-ops` | — | — | — |
| `api_keys` | `api-keys` | `/api-keys` | — | — | — |
| `approval_settings` | `approval-settings` | `/approval-settings` | — | — | ✓ |
| `asr_acd` | `asr-acd` | `/asr-acd` | — | — | — |
| `audit_log` | `audit-log` | `/audit-log` | — | — | ✓ |
| `auth_studio` | `auth-studio` | `/auth-studio` | — | — | ✓ |
| `balance_monitor` | `balance-monitor` | `/balance` | — | — | — |
| `bank_accounts` | `bank-accounts` | `/finance/bank-accounts` | — | — | — |
| `bank_reconciliation` | `bank-reconciliation` | `/finance/bank-reconciliation` | — | — | — |
| `billing_disputes` | `billing-disputes` | `/billing-disputes` | — | — | — |
| `bitseye_classic` | `bitseye-classic` | `/bitseye` | — | — | — |
| `business_partners` | `business-partners` | `/finance/business-partners` | — | — | — |
| `call_governance` | `call-governance` | `/call-governance` | — | — | ✓ |
| `call_recordings` | `call-recordings` | `/call-recordings` | — | — | ✓ |
| `carrier_intelligence` | `carrier-intelligence` | `/carrier-intelligence` | — | — | — |
| `carrier_reconciliation` | `carrier-reconciliation` | `/carrier-reconciliation` | — | — | — |
| `carrier_scoring` | `carrier-scoring` | `/carrier-scoring` | — | — | — |
| `cash_position` | `cash-position` | `/finance/cash-position` | — | — | — |
| `cdr_reconciliation` | `cdr-reconciliation` | `/cdr-reconciliation` | — | — | — |
| `cdr_rerate` | `cdr-rerate` | `/cdr-rerate` | — | — | ✓ |
| `client_identity` | `client-identity` | `/client-identity` | — | — | — |
| `client_portal` | `client-portal` | `/client-portal` | — | — | — |
| `client_rate_report` | `client-rate-report` | `/client-rate-report` | — | — | — |
| `client_reconciliation` | `client-reconciliation` | `/client-reconciliation` | — | — | — |
| `client_wizard` | `client-wizard` | `/client/wizard` | — | — | — |
| `codec_analytics` | `codec-analytics` | `/codec-analytics` | — | — | ✓ |
| `comm_policies` | `comm-policies` | `/communication-policies` | — | — | ✓ |
| `commercial_notifications` | `commercial-notifications` | `/commercial-notifications` | ✓ | — | ✓ |
| `company_list` | `company-list` | `/company/list` | — | — | — |
| `company_onboarding` | `company-onboarding` | `/company/onboarding` | — | — | — |
| `company_profile` | `company-profile` | `/company-profile` | — | — | — |
| `configuration_values` | `configuration-values` | `/configuration-values` | — | — | — |
| `cost_optimisation` | `cost-optimisation` | `/cost-optimisation` | — | — | ✓ |
| `credit_control` | `credit-control` | `/credit-control` | — | — | — |
| `credit_notes` | `credit-notes` | `/credit-notes` | — | — | — |
| `currency_settings` | `currency-settings` | `/currency-settings` | — | — | — |
| `destination_catalog` | `destination-catalog` | `/destination-catalog` | ✓ | — | — |
| `dispute_cases` | `dispute-cases` | `/dispute-cases` | — | — | — |
| `dispute_defense` | `dispute-defense` | `/dispute-defense` | — | — | — |
| `email_centre` | `email-centre` | `/email-centre` | — | — | — |
| `executive_reports` | `executive-reports` | `/executive-reports` | — | — | ✓ |
| `finance_cockpit` | `finance-cockpit` | `/finance-cockpit` | — | — | — |
| `governance_review` | `governance-review` | `/governance-review` | — | — | — |
| `intelligence_hub` | `intelligence-hub` | `/intelligence` | — | — | — |
| `intelligence_validation` | `intelligence-validation` | `/intelligence-validation` | — | — | ✓ |
| `invoice_jobs` | `invoice-jobs` | `/invoice-jobs` | — | — | — |
| `invoice_schedules` | `invoice-schedules` | `/invoice-schedules` | — | — | — |
| `invoice_templates` | `invoice-templates` | `/invoice-templates` | — | — | — |
| `kam_dashboard` | `kam-dashboard` | `/kam-dashboard` | ✓ | — | — |
| `lcr_analyser` | `lcr-analyser` | `/lcr-analyser` | — | — | — |
| `live_calls` | `live-calls` | `/calls` | ✓ | — | — |
| `live_traffic` | `live-traffic` | `/live-traffic` | ✓ | — | — |
| `live_traffic_map` | `live-traffic-map` | `/live-traffic-map` | — | — | — |
| `margin_intelligence` | `margin-intelligence` | `/margin-intelligence` | ✓ | — | — |
| `mfa_setup` | `mfa-setup` | `/mfa-setup` | — | — | ✓ |
| `multi_switch` | `multi-switch` | `/multi-switch` | — | — | — |
| `navigation_governance` | `navigation-governance` | `/navigation-governance` | — | — | — |
| `navigation_manager` | `navigation-manager` | `/navigation-manager` | — | — | — |
| `network_topology` | `network-topology` | `/network-topology` | — | — | — |
| `noc_command` | `noc-command` | `/noc-command` | ✓ | — | — |
| `noc_dashboard` | `noc-dashboard` | `/noc-dashboard` | ✓ | ✓ | — |
| `noc_incidents` | `noc-incidents` | `/noc-incidents` | — | — | — |
| `notification_centre` | `notification-centre` | `/notification-centre` | — | — | — |
| `number_intelligence` | `number-intelligence` | `/number-intelligence` | — | — | ✓ |
| `numbering_prefixes` | `numbering-prefixes` | `/numbering-prefixes` | — | — | — |
| `ops_console` | `ops-console` | `/ops-console` | ✓ | — | — |
| `payment_reminders` | `payment-reminders` | `/payment-reminders` | — | — | — |
| `payment_runs` | `payment-runs` | `/finance/payment-runs` | — | — | — |
| `payment_terms` | `payment-terms` | `/payment-terms` | — | — | — |
| `platform_console` | `platform-console` | `/console` | — | — | — |
| `prefix_intelligence` | `prefix-intelligence` | `/vendor-prefix-intelligence` | — | — | — |
| `product_registry` | `product-registry` | `/product-registry` | ✓ | — | — |
| `qos_heatmap` | `qos-heatmap` | `/qos-heatmap` | — | — | — |
| `rate_editor` | `rate-editor` | `/rate-editor` | — | — | — |
| `rate_manager` | `rate-manager` | `/rate-manager` | ✓ | — | — |
| `recon_lab` | `recon-lab` | `/recon-lab` | — | — | — |
| `reminder_rules` | `reminder-rules` | `/reminder-rules` | — | — | — |
| `replay_engine` | `replay-engine` | `/replay` | — | — | — |
| `revenue_heatmap` | `revenue-heatmap` | `/revenue-heatmap` | — | — | ✓ |
| `route_intelligence` | `route-intelligence` | `/route-intelligence` | — | — | — |
| `route_optimisation` | `route-optimisation` | `/route-optimisation` | — | — | ✓ |
| `route_simulator` | `route-simulator` | `/call-flow-simulator` | — | — | — |
| `route_tester` | `route-tester` | `/test-call` | — | — | — |
| `route_testing` | `route-testing` | `/route-testing` | — | — | — |
| `routing_intelligence` | `routing-intelligence` | `/routing-intelligence` | — | — | — |
| `routing_manager` | `routing-manager` | `/routing-manager` | — | — | ✓ |
| `rtp_analytics` | `rtp-analytics` | `/rtp-analytics` | — | — | — |
| `sbc_monitor` | `sbc-monitor` | `/sbc-monitor` | — | — | — |
| `security_ops` | `security-ops` | `/security-ops` | — | — | — |
| `self_heal` | `self-heal` | `/self-heal` | — | — | — |
| `sender_profiles` | `sender-profiles` | `/sender-profiles` | — | — | ✓ |
| `server_monitoring` | `server-monitoring` | `/server-monitoring` | — | — | — |
| `simulation_sandbox` | `simulation-sandbox` | `/simulation-sandbox` | — | — | ✓ |
| `sip_trace` | `sip-trace` | `/sip-trace` | — | — | — |
| `sla_breaches` | `sla-breaches` | `/sla-breaches` | — | — | — |
| `sla_scorecard` | `sla-scorecard` | `/vendor-sla-scorecard` | — | — | — |
| `sms_monitor` | `sms-monitor` | `/sms-monitor` | — | — | — |
| `stir_shaken` | `stir-shaken` | `/stir-shaken` | — | — | ✓ |
| `tariff_profiles` | `tariff-profiles` | `/tariff-profiles` | — | — | — |
| `tariff_versions` | `tariff-versions` | `/tariff-versions` | — | — | — |
| `tax_vat` | `tax-vat` | `/tax-vat` | — | — | — |
| `team_chat` | `team-chat` | `/chat` | — | — | — |
| `termination_chains` | `termination-chains` | `/termination-chains` | — | — | — |
| `test_campaigns` | `test-campaigns` | `/test-campaigns` | — | — | — |
| `traffic_forecast` | `traffic-forecast` | `/traffic-forecast` | — | — | — |
| `traffic_map` | `traffic-map` | `/traffic-map` | ✓ | — | — |
| `traffic_steering` | `traffic-steering` | `/traffic-steering` | — | — | — |
| `unbilled_usage` | `unbilled-usage` | `/unbilled-usage` | — | — | — |
| `validation_rules` | `validation-rules` | `/validation-rules` | — | — | — |
| `vendor_adjustments` | `vendor-adjustments` | `/finance/vendor-adjustments` | — | — | — |
| `vendor_approval` | `vendor-approval` | `/finance/vendor-approval` | — | — | — |
| `vendor_bills` | `vendor-bills` | `/finance/vendor-bills` | — | — | — |
| `vendor_health` | `vendor-health` | `/vendor-health` | — | — | — |
| `vendor_payments` | `vendor-payments` | `/finance/vendor-payments` | — | — | — |
| `vendor_rca` | `vendor-rca` | `/vendor-rca` | — | — | — |
| `vendor_stability_timeline` | `vendor-stability-timeline` | `/vendor-stability-timeline` | — | — | — |
| `vendor_statement` | `vendor-statement` | `/finance/vendor-statement` | — | — | — |
| `vendor_verification` | `vendor-verification` | `/finance/vendor-verification` | — | — | — |
| `voice_otp` | `voice-otp` | `/voice-otp` | — | — | — |
| `vpn_config` | `vpn-config` | `/vpn-config` | — | — | — |
| `whatsapp_alerts` | `whatsapp-alerts` | `/whatsapp-alerts` | — | — | — |
| `workspace_settings` | `workspace-settings` | `/workspace-settings` | — | — | — |

## Already canonical — no rename (24)

| module_key | route | registry | override |
|---|---|:---:|:---:|
| `alerts` | `/alerts` | — | — |
| `analytics` | `/analytics` | — | — |
| `approvals` | `/approvals` | — | ✓ |
| `billing` | `/billing` | — | — |
| `bitseye` | `/bitseye2` | — | — |
| `cdrs` | `/cdrs` | — | — |
| `clients` | `/clients` | ✓ | — |
| `compliance` | `/compliance` | — | ✓ |
| `deals` | `/deals` | ✓ | — |
| `dids` | `/dids` | — | — |
| `dmr` | `/dmr` | — | — |
| `firewall` | `/firewall` | — | — |
| `fraud` | `/fraud` | — | — |
| `governance` | `/governance` | — | — |
| `graphs` | `/graphs` | — | — |
| `invoices` | `/invoices` | ✓ | — |
| `rbac` | `/rbac` | — | ✓ |
| `reports` | `/reports` | — | — |
| `reseller` | `/reseller` | — | — |
| `settings` | `/settings` | — | — |
| `team` | `/team` | — | — |
| `tools` | `/tools` | — | — |
| `vendors` | `/vendors` | — | — |
| `wallets` | `/finance/wallets` | — | — |

---

## Finding: `partner-profiles` unregistered in seed

`module-registry.ts` has a binding for `partner-profiles` but `navigation_modules`
has no row with that key. This means the module is registered (component exists)
but unreachable via the workspace nav. It is not a blocker for 032 — `partner-profiles`
is not in any portal assignment and is not in any override row. Decision required:
add a seed row in a future migration, or remove the registry binding until the
module is ready to surface in a portal.

---

## 032 safety summary

| Check | Result |
|---|---|
| Override keys with no seed row | ✅ 0 |
| Home module resolves post-rename | ✅ `noc-dashboard` |
| FK tables unaffected by rename | ✅ `portal_module_assignments.module_id` is integer |
| Text tables updated in same migration | ✅ `portal_workspace.home_module`, `user_favorites.module_key` |
| Migration idempotent (re-run safe) | ✅ replace('a','_','-') on no-underscore key is no-op |
| Registry orphan | ⚠️ `partner-profiles` registered, not seeded — not blocking |

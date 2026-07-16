CREATE TABLE "account_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" varchar(64) NOT NULL,
	"account_name" varchar(255),
	"recommendation_ref" json,
	"action_type" varchar(50) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"execution_mode" varchar(20) DEFAULT 'dry_run' NOT NULL,
	"primary_action" text,
	"sippy_params" json,
	"sippy_result" json,
	"requested_by" varchar(255),
	"requested_by_name" varchar(255),
	"approved_by" varchar(255),
	"approved_by_name" varchar(255),
	"rejected_by" varchar(255),
	"rejection_reason" text,
	"snoozed_until" timestamp,
	"notes" text,
	"audit_trail" json,
	"idempotency_key" varchar(128),
	"verification_state" varchar(30) DEFAULT 'not_applicable' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account_caps" (
	"account_id" varchar(32) PRIMARY KEY NOT NULL,
	"account_name" varchar(128),
	"session_limit" integer,
	"cps_limit" integer,
	"warning_threshold" integer DEFAULT 90,
	"critical_threshold" integer DEFAULT 100,
	"synced_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account_configs" (
	"i_account" integer PRIMARY KEY NOT NULL,
	"config_json" text DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" varchar(64) NOT NULL,
	"account_name" varchar(255),
	"health_score" integer DEFAULT 100 NOT NULL,
	"fraud_risk" integer DEFAULT 0 NOT NULL,
	"anomaly_score" integer DEFAULT 0 NOT NULL,
	"quality_score" integer DEFAULT 100 NOT NULL,
	"balance_trend" varchar(20) DEFAULT 'stable' NOT NULL,
	"active_incident_count" integer DEFAULT 0 NOT NULL,
	"state" varchar(20) DEFAULT 'healthy' NOT NULL,
	"reasons" json DEFAULT '[]'::json,
	"last_incident_at" timestamp,
	"previous_health_score" integer,
	"previous_state" varchar(20),
	"trend_direction" varchar(20) DEFAULT 'stable' NOT NULL,
	"score_delta_24h" integer DEFAULT 0 NOT NULL,
	"auth_exposure_score" integer DEFAULT 0 NOT NULL,
	"exposure_risk_level" varchar(20) DEFAULT 'low' NOT NULL,
	"auth_exposure_signals" json,
	"recommendation" json,
	"risk_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_state_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "account_state_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" varchar(64) NOT NULL,
	"account_name" varchar(255),
	"health_score" integer NOT NULL,
	"fraud_risk" integer NOT NULL,
	"anomaly_score" integer NOT NULL,
	"quality_score" integer NOT NULL,
	"state" varchar(20) NOT NULL,
	"reasons" json DEFAULT '[]'::json,
	"snapshot_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"ledger_id" varchar(64) NOT NULL,
	"scope" varchar(20) NOT NULL,
	"source_system" varchar(20) NOT NULL,
	"action_type" varchar(64) NOT NULL,
	"entity_id" varchar(128),
	"entity_name" varchar(255),
	"payload" json,
	"idempotency_key" varchar(128),
	"risk_index_snapshot" integer,
	"approval_state" varchar(30) DEFAULT 'pending' NOT NULL,
	"execution_state" varchar(30) DEFAULT 'not_executed' NOT NULL,
	"verification_state" varchar(30) DEFAULT 'not_applicable' NOT NULL,
	"source_record_id" varchar(64),
	"event_type" varchar(30) NOT NULL,
	"requested_by" varchar(255),
	"requested_by_name" varchar(255),
	"actor_id" varchar(255),
	"actor_name" varchar(255),
	"note" text,
	"intent_id" varchar(64),
	"intent_label" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adjustment_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_name" varchar(256) NOT NULL,
	"reference_type" varchar(32) NOT NULL,
	"reference_id" varchar(64) NOT NULL,
	"debit_usd" real,
	"credit_usd" real,
	"balance_after_usd" real,
	"description" text,
	"actor_name" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_ops_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" varchar(16) NOT NULL,
	"message" text NOT NULL,
	"entity" text,
	"value" text,
	"linked_exec_id" text,
	"source" text DEFAULT 'execution' NOT NULL,
	"confidence" real,
	"signal_source" varchar(32),
	"dedupe_key" varchar(128),
	"classification" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_ops_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"entity" text,
	"severity" varchar(16) NOT NULL,
	"start_time" timestamp NOT NULL,
	"last_seen" timestamp NOT NULL,
	"signals_count" integer DEFAULT 0 NOT NULL,
	"anomalies_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"narrative" text,
	"timeline_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_revenue_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" varchar(64) NOT NULL,
	"severity" varchar(16) DEFAULT 'medium' NOT NULL,
	"anomaly_score" integer DEFAULT 0 NOT NULL,
	"client_name" varchar(256),
	"vendor_name" varchar(256),
	"billing_period" varchar(7),
	"baseline_value" real,
	"current_value" real,
	"deviation_pct" real,
	"evidence" jsonb,
	"recommended_action" text,
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"reviewed_by" varchar(128),
	"reviewed_at" timestamp,
	"resolved_at" timestamp,
	"dismissed_reason" text,
	"detected_on" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_scan_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"triggered_by" varchar(128),
	"alerts_created" integer DEFAULT 0 NOT NULL,
	"detectors_ran" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric" varchar(64) NOT NULL,
	"label" varchar(128),
	"threshold" real NOT NULL,
	"comparison" varchar(10) DEFAULT 'lt' NOT NULL,
	"carrier" varchar(128),
	"enabled" boolean DEFAULT true,
	"email_enabled" boolean DEFAULT false,
	"webhook_enabled" boolean DEFAULT false,
	"webhook_url" varchar(512),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"message" text NOT NULL,
	"vendor" varchar(128),
	"connection" varchar(128),
	"resolved" boolean DEFAULT false,
	"acknowledged_at" timestamp,
	"acknowledged_by" varchar(128),
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "anomaly_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" varchar(128),
	"metric" varchar(32) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"root_cause" text NOT NULL,
	"recommendation" text NOT NULL,
	"affected_entities" text[] NOT NULL,
	"current_value" real NOT NULL,
	"baseline_mean" real NOT NULL,
	"baseline_stddev" real NOT NULL,
	"deviation_sigma" real NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"name" varchar(128) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "approval_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"action" varchar(32) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"actor_name" varchar(128),
	"actor_role" varchar(32),
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_type" varchar(64) NOT NULL,
	"action" varchar(20) NOT NULL,
	"entity_id" varchar(64),
	"entity_name" varchar(255),
	"payload_before" json,
	"payload_after" json,
	"requested_by" varchar(255) NOT NULL,
	"requested_by_name" varchar(128),
	"team_id" varchar(64),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reviewed_by" varchar(255),
	"reviewed_by_name" varchar(128),
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"self_approval" boolean DEFAULT false,
	"requested_at" timestamp DEFAULT now(),
	"source" varchar(32) DEFAULT 'manual',
	"rule_id" integer,
	"rollback_of" integer,
	"exec_result" json
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"category" varchar(32) NOT NULL,
	"action" varchar(64) NOT NULL,
	"actor" varchar(255) DEFAULT 'system' NOT NULL,
	"actor_type" varchar(16) DEFAULT 'system' NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(128),
	"target_name" varchar(255),
	"severity" varchar(16) DEFAULT 'info' NOT NULL,
	"metadata" json,
	"ip" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "balance_alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" varchar(32) NOT NULL,
	"account_name" varchar(128),
	"threshold_usd" real NOT NULL,
	"severity" varchar(16) NOT NULL,
	"current_balance" real NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"notification_sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "balance_alert_notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_list" text,
	"webhook_url" varchar(512),
	"notify_on_warning" boolean DEFAULT true NOT NULL,
	"notify_on_urgent" boolean DEFAULT true NOT NULL,
	"notify_on_critical" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "balance_alert_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" varchar(32),
	"account_name" varchar(128),
	"threshold_usd" real NOT NULL,
	"severity" varchar(16) DEFAULT 'warning' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bhaoo_balance_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"balance" real NOT NULL,
	"credit_limit" real,
	"currency" varchar(8) DEFAULT 'USD',
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bhaoo_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"base_url" varchar(256) DEFAULT 'http://149.20.185.6/BhaooSMSV5' NOT NULL,
	"api_key" varchar(128) NOT NULL,
	"secret_key" varchar(128) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_name" varchar(128) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"our_amount" real DEFAULT 0 NOT NULL,
	"vendor_amount" real DEFAULT 0 NOT NULL,
	"discrepancy" real DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"resolution" real,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blacklist_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"value" varchar(64) NOT NULL,
	"reason" text,
	"source" varchar(32) DEFAULT 'manual',
	"active" boolean DEFAULT true,
	"hit_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "call_governance_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"governed_call_id" integer,
	"event_type" varchar(64) NOT NULL,
	"channel" varchar(255),
	"details" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "call_governance_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_name" varchar(100),
	"connection_name" varchar(128) NOT NULL,
	"channel_pattern" varchar(255),
	"destination_prefix" varchar(64),
	"caller_prefix" varchar(64),
	"cap_sec" integer DEFAULT 120 NOT NULL,
	"jitter_sec" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"action" varchar(32) DEFAULT 'cap_and_replay' NOT NULL,
	"scenario" varchar(32) DEFAULT 'time_cap' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "call_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"sippy_call_id" varchar(255) NOT NULL,
	"caller" varchar(64),
	"callee" varchar(64),
	"client_name" varchar(128),
	"vendor" varchar(128),
	"account_id" varchar(32),
	"i_customer" varchar(32),
	"i_environment" varchar(32),
	"direction" varchar(32),
	"codec" varchar(32),
	"cc_state" varchar(32),
	"max_duration_secs" real DEFAULT 0,
	"pdd_ms" integer DEFAULT 0,
	"media_ip_caller" varchar(64),
	"media_ip_callee" varchar(64),
	"connection" varchar(255),
	"first_seen" timestamp DEFAULT now(),
	"last_seen" timestamp DEFAULT now(),
	CONSTRAINT "call_snapshots_sippy_call_id_unique" UNIQUE("sippy_call_id")
);
--> statement-breakpoint
CREATE TABLE "call_test_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"cli" varchar(64) NOT NULL,
	"cld" varchar(64) NOT NULL,
	"i_account" integer,
	"call_id" varchar(128),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"caller" varchar(50) NOT NULL,
	"callee" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"start_time" timestamp DEFAULT now(),
	"end_time" timestamp,
	"direction" varchar(10) DEFAULT 'inbound',
	"pdd" real,
	"fail_reason" varchar(30),
	"origin_country" varchar(64),
	"term_country" varchar(64),
	"trunk_class" varchar(20),
	"sip_code" integer,
	"billable_secs" integer,
	"fas_flag" boolean DEFAULT false,
	"callback_flag" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "canonical_vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"vendor_prefix" varchar(4) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_vendors_vendor_prefix_unique" UNIQUE("vendor_prefix")
);
--> statement-breakpoint
CREATE TABLE "cap_alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" varchar(32) NOT NULL,
	"account_name" varchar(128),
	"cap_type" varchar(16) NOT NULL,
	"utilisation_pct" real NOT NULL,
	"current_value" integer NOT NULL,
	"limit_value" integer NOT NULL,
	"severity" varchar(16) DEFAULT 'warning' NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "carrier_quality_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier_id" varchar(64) NOT NULL,
	"carrier_name" varchar(128) NOT NULL,
	"window_hours" integer DEFAULT 24 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"connected_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"rolling_asr" real,
	"avg_acd_secs" real,
	"avg_pdd_ms" real,
	"p95_pdd_ms" real,
	"failure_rate" real,
	"stability_score" real,
	"trend" varchar(16),
	"last_computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier_name" varchar(256) NOT NULL,
	"i_tariff" varchar(64),
	"invoice_ref" varchar(128),
	"invoice_date" varchar(32),
	"period_start" varchar(32),
	"period_end" varchar(32),
	"carrier_total" real,
	"sippy_total" real,
	"reproduced_total" real,
	"snapshot_total" real,
	"delta_carrier_vs_reproduced" real,
	"delta_carrier_vs_sippy" real,
	"discrepancy_count" integer DEFAULT 0,
	"status" varchar(32) DEFAULT 'shadow' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cdr_anomaly_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_date" varchar(12) NOT NULL,
	"account" varchar(128) NOT NULL,
	"metric" varchar(32) NOT NULL,
	"baseline" real NOT NULL,
	"observed" real NOT NULL,
	"deviation_sigma" real NOT NULL,
	"severity" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cdr_rerate_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"mode" varchar(32) DEFAULT 'flat_rate' NOT NULL,
	"from_date" varchar(32) NOT NULL,
	"to_date" varchar(32) NOT NULL,
	"i_tariff_filter" varchar(64),
	"flat_rate_per_min" real,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"snapshot_count" integer DEFAULT 0,
	"original_cost" real DEFAULT 0,
	"rerated_cost" real DEFAULT 0,
	"delta" real DEFAULT 0,
	"savings_pct" real DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"sender_id" varchar(255) NOT NULL,
	"sender_name" varchar(128) NOT NULL,
	"sender_role" varchar(32) DEFAULT 'viewer' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" varchar(16) DEFAULT 'group' NOT NULL,
	"slug" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "chat_rooms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "client_branding_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_name" varchar(256),
	"company_name" varchar(256),
	"logo_url" text,
	"primary_color" varchar(7),
	"secondary_color" varchar(7),
	"banking_details" text,
	"bank_name" varchar(256),
	"account_number" varchar(128),
	"iban" varchar(64),
	"swift" varchar(16),
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"payment_instructions" text,
	"invoice_footer_text" text,
	"tax_id" varchar(64),
	"address_line1" varchar(256),
	"address_line2" varchar(256),
	"city" varchar(128),
	"country" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_identity_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"i_account" integer,
	"sippy_username" varchar(255),
	"billing_name" varchar(255),
	"display_name" varchar(255),
	"crm_name" varchar(255),
	"portal_name" varchar(255),
	"external_ref" varchar(255),
	"account_manager_id" varchar(255),
	"finance_owner_id" varchar(255),
	"risk_tier" varchar(20) DEFAULT 'standard',
	"i_tariff" varchar(64),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_identity_map_i_account_unique" UNIQUE("i_account")
);
--> statement-breakpoint
CREATE TABLE "client_ip_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"client_name" varchar(256) NOT NULL,
	"ip_address" varchar(64) NOT NULL,
	"trunk" varchar(128),
	"description" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"submitted_by" varchar(255),
	"reviewed_by" varchar(255),
	"rejection_reason" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "client_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" varchar(10) DEFAULT 'client' NOT NULL,
	"prefix" varchar(50),
	"ip_address" varchar(45),
	"rate_per_min" real DEFAULT 0.025,
	"rate_effective_from" timestamp,
	"rate_effective_to" timestamp,
	"notes" text,
	"switch_sync_status" json,
	"created_at" timestamp DEFAULT now(),
	"max_sessions" integer,
	"max_calls_per_second" integer,
	"max_session_time" integer,
	"credit_limit" real,
	"routing_group" varchar(128),
	"preferred_codec" varchar(32),
	"cld_translation_rule" varchar(128),
	"cli_translation_rule" varchar(128),
	"service_plan" varchar(128),
	"sip_class" varchar(128),
	"timezone" varchar(64) DEFAULT 'Etc/UTC',
	"language" varchar(32) DEFAULT 'English',
	"company_name" varchar(128),
	"alert_email" varchar(255),
	"cost_per_min" real,
	"revenue_per_min" real
);
--> statement-breakpoint
CREATE TABLE "client_revenue_reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"billing_period" varchar(7) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_id" integer,
	"client_account_id" varchar(64),
	"client_name" varchar(256) NOT NULL,
	"client_duration_sec" real,
	"client_amount_usd" real,
	"client_calls" integer,
	"bitsauto_duration_sec" real,
	"bitsauto_amount_usd" real,
	"bitsauto_calls" integer,
	"dmr_duration_sec" real,
	"dmr_amount_usd" real,
	"delta_duration_sec" real,
	"delta_amount_usd" real,
	"delta_pct" real,
	"discrepancy_type" varchar(32) DEFAULT 'no_client_data' NOT NULL,
	"severity" varchar(16) DEFAULT 'clean' NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"invoice_id" integer,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"raw_import" jsonb,
	"notes" text,
	"reviewed_by" varchar(128),
	"reviewed_at" timestamp,
	"reconciled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_name" varchar(256) NOT NULL,
	"client_id" varchar(128),
	"event_type" varchar(32) NOT NULL,
	"outstanding_amount_usd" real,
	"threshold_breached" varchar(32),
	"action_taken" text,
	"resolved_at" timestamp,
	"actor_name" varchar(128),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_notification_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer NOT NULL,
	"company_id" integer,
	"email" varchar(256) NOT NULL,
	"recipient_name" varchar(256),
	"delivery_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"failed_reason" varchar(512),
	"tracking_token" varchar(64),
	"opened_at" timestamp,
	"acknowledged_at" timestamp,
	"open_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(64) NOT NULL,
	"destination" varchar(128),
	"prefix" varchar(32),
	"old_value" varchar(128),
	"new_value" varchar(128),
	"effective_date" varchar(32),
	"subject" varchar(512) NOT NULL,
	"body" text NOT NULL,
	"audience_type" varchar(64) DEFAULT 'all_clients' NOT NULL,
	"sender_profile_id" integer,
	"tariff_change_event_id" integer,
	"policy_id" integer,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"sent_count" integer DEFAULT 0,
	"failed_count" integer DEFAULT 0,
	"dispatched_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "communication_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_type" varchar(64) NOT NULL,
	"severity_filter" varchar(32) DEFAULT 'all' NOT NULL,
	"sender_profile_id" integer,
	"template_type" varchar(64),
	"recipient_group" varchar(64) DEFAULT 'all_clients' NOT NULL,
	"channel_type" varchar(32) DEFAULT 'email' NOT NULL,
	"auto_draft" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 0 NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"short_code" varchar(32) NOT NULL,
	"country" varchar(64),
	"kam" varchar(128),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"company_type" varchar(32) DEFAULT 'retail' NOT NULL,
	"contract_type" varchar(32) DEFAULT 'bilateral' NOT NULL,
	"department" varchar(64),
	"team" varchar(64),
	"client_timezone" varchar(64),
	"vendor_timezone" varchar(64),
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"vendor_billing_cycle" varchar(32) DEFAULT 'weekly_cutoff',
	"vendor_grace_period" integer DEFAULT 3,
	"vendor_credit_limit" real DEFAULT 0,
	"dispute_over_pct" real DEFAULT 0,
	"client_billing_cycle" varchar(32) DEFAULT 'weekly_cutoff',
	"client_grace_period" integer DEFAULT 3,
	"client_credit_limit" real DEFAULT 0,
	"dispute_over_val" real DEFAULT 0,
	"payment_term" varchar(32) DEFAULT 'prepaid',
	"legal_name_ci" varchar(256),
	"legal_name_ven" varchar(256),
	"invoice_email" varchar(256),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(255),
	"provisioning_status" varchar(32) DEFAULT 'draft' NOT NULL,
	"provisioned_at" timestamp,
	"provisioned_by" varchar(255),
	"sippy_i_account" integer,
	"sippy_i_tariff" integer,
	"wizard_draft" text,
	"activated_at" timestamp,
	"activated_by" varchar(255),
	CONSTRAINT "companies_name_unique" UNIQUE("name"),
	CONSTRAINT "companies_short_code_unique" UNIQUE("short_code")
);
--> statement-breakpoint
CREATE TABLE "company_bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"bank_name" varchar(256) NOT NULL,
	"account_title" varchar(256) NOT NULL,
	"account_no" varchar(128) NOT NULL,
	"iban" varchar(64),
	"swift_code" varchar(32) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"country" varchar(64) NOT NULL,
	"address" text,
	"remarks" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"contact_type" varchar(32) NOT NULL,
	"first_name" varchar(128) NOT NULL,
	"last_name" varchar(128),
	"email" varchar(256) NOT NULL,
	"phone" varchar(64),
	"fax" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "concurrent_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"dim" varchar(32) NOT NULL,
	"entity_name" varchar(256) NOT NULL,
	"ts" bigint NOT NULL,
	"active" integer DEFAULT 0 NOT NULL,
	"connected" integer DEFAULT 0 NOT NULL,
	"routing" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configuration_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(32) NOT NULL,
	"config_key" varchar(128) NOT NULL,
	"label" varchar(256) NOT NULL,
	"description" text,
	"unit" varchar(32),
	"value" text,
	"default_value" text,
	"value_type" varchar(32) DEFAULT 'text' NOT NULL,
	"is_editable" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_vendor_cache2" (
	"id" serial PRIMARY KEY NOT NULL,
	"i_connection" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"i_vendor" integer,
	"vendor_name" varchar(255),
	"host" varchar(255),
	"protocol" varchar(32),
	"blocked" boolean DEFAULT false,
	"raw_json" text,
	"cached_at" timestamp DEFAULT now(),
	CONSTRAINT "connection_vendor_cache2_i_connection_unique" UNIQUE("i_connection")
);
--> statement-breakpoint
CREATE TABLE "console_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_key" varchar(255) NOT NULL,
	"entity_label" varchar(255) NOT NULL,
	"window_hash" varchar(64) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"state" varchar(24) DEFAULT 'active' NOT NULL,
	"title" varchar(500) NOT NULL,
	"alerts_json" text DEFAULT '[]' NOT NULL,
	"root_cause_json" text,
	"timeline_json" text DEFAULT '[]' NOT NULL,
	"actions_json" text DEFAULT '[]' NOT NULL,
	"metrics_json" text,
	"estimated_impact_per_hr" real,
	"linked_ticket_id" integer,
	"started_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"acknowledged_by" varchar(128),
	"acknowledged_at" timestamp,
	"acknowledge_note" text,
	"resolved_by" varchar(128),
	"resolution_note" text,
	"assigned_to" varchar(128),
	"assignment_history_json" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "console_incidents_window_hash_unique" UNIQUE("window_hash")
);
--> statement-breakpoint
CREATE TABLE "copilot_result_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_control_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_name" varchar(256),
	"client_id" varchar(128),
	"is_global" boolean DEFAULT false NOT NULL,
	"warning_threshold_usd" real,
	"suspend_threshold_usd" real,
	"grace_period_days" integer DEFAULT 3 NOT NULL,
	"auto_suspend" boolean DEFAULT false NOT NULL,
	"notify_on_warning" boolean DEFAULT true NOT NULL,
	"credit_limit_usd" real,
	"risk_score" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_id" varchar(32) NOT NULL,
	"credit_type" varchar(32) NOT NULL,
	"client_name" varchar(256) NOT NULL,
	"client_id" varchar(128),
	"invoice_id" integer,
	"dispute_case_id" integer,
	"billing_period" varchar(7),
	"amount_usd" real NOT NULL,
	"applied_amount_usd" real,
	"reason" varchar(512) NOT NULL,
	"description" text,
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"approved_by" varchar(128),
	"approved_at" timestamp,
	"applied_at" timestamp,
	"voided_at" timestamp,
	"voided_reason" text,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_reference_id_unique" UNIQUE("reference_id")
);
--> statement-breakpoint
CREATE TABLE "customer_product_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"i_account" integer NOT NULL,
	"customer_name" varchar(256),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "daily_minutes_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_date" date NOT NULL,
	"dmr_version" integer DEFAULT 1 NOT NULL,
	"parent_dmr_id" integer,
	"window_start_gmt" timestamp,
	"window_end_gmt" timestamp,
	"timezone" varchar(8) DEFAULT 'UTC' NOT NULL,
	"account_id" varchar(64),
	"account_name" varchar(256),
	"vendor_id" varchar(64),
	"vendor_name" varchar(256),
	"destination" varchar(256),
	"prefix" varchar(32),
	"sippy_duration" real,
	"sippy_amount" real,
	"sippy_calls" integer,
	"platform_duration" real,
	"platform_amount" real,
	"platform_calls" integer,
	"buy_amount" real,
	"sell_amount" real,
	"margin_amount" real,
	"margin_pct" real,
	"drift_duration" real,
	"drift_amount" real,
	"total_calls" integer,
	"asr" real,
	"acd" real,
	"pdd" real,
	"tariff_version_id" integer,
	"discrepancy_type" varchar(32) DEFAULT 'exact_match' NOT NULL,
	"verification_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"source" varchar(32) DEFAULT 'daily_summary' NOT NULL,
	"notes" text,
	"recalculated_at" timestamp,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_widget_prefs" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"hidden_widgets" text[] DEFAULT '{}' NOT NULL,
	"widget_order" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_retention_policy" (
	"id" serial PRIMARY KEY NOT NULL,
	"data_type" varchar(64) NOT NULL,
	"label" varchar(128) NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_purged_at" timestamp,
	"purged_count" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "data_retention_policy_data_type_unique" UNIQUE("data_type")
);
--> statement-breakpoint
CREATE TABLE "deal_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"action" varchar(32) NOT NULL,
	"performed_by" varchar(128),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_destinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"destination_id" integer,
	"destination_name" varchar(256),
	"offer_rate" numeric(10, 6),
	"cost_rate" numeric(10, 6),
	"volume_split_pct" numeric(8, 4),
	"premium_pct" numeric(8, 4) DEFAULT '50',
	"standard_pct" numeric(8, 4) DEFAULT '50',
	"premium_rate" numeric(10, 6),
	"standard_rate" numeric(10, 6),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_ref" varchar(64) NOT NULL,
	"i_account" integer NOT NULL,
	"customer_name" varchar(256),
	"product_id" integer NOT NULL,
	"kam_name" varchar(128),
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"deal_type" varchar(32) DEFAULT 'traffic_mix',
	"start_date" date,
	"end_date" date,
	"grace_period_days" integer DEFAULT 0,
	"volume_commitment" numeric(15, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(128),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requested_by" varchar(128) NOT NULL,
	"data_subject" varchar(255) NOT NULL,
	"data_type" varchar(64) NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"executed_by" varchar(128),
	"records_deleted" integer DEFAULT 0,
	"audit_note" text
);
--> statement-breakpoint
CREATE TABLE "destination_product_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"destination_id" integer,
	"product_prefix" varchar(16) NOT NULL,
	"dial_prefix" varchar(32),
	"destination_name" varchar(256),
	"buy_rate" numeric(10, 6),
	"sell_rate" numeric(10, 6),
	"currency" varchar(8) DEFAULT 'USD',
	"approval_status" varchar(32) DEFAULT 'pending',
	"approved_by" varchar(128),
	"approved_at" timestamp,
	"source" varchar(64) DEFAULT 'manual',
	"source_file" varchar(256),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"product_code" varchar(4),
	"interval_1" integer DEFAULT 1,
	"interval_n" integer DEFAULT 1,
	"price_status" varchar(32),
	"cli_enabled" boolean DEFAULT true,
	"activation_date" timestamp with time zone,
	"expiration_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "destination_sets_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"i_destination_set" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"route_count" integer DEFAULT 0,
	"cld_translation" varchar(255),
	"cli_translation" varchar(255),
	"raw_json" text,
	"cached_at" timestamp DEFAULT now(),
	CONSTRAINT "destination_sets_cache_i_destination_set_unique" UNIQUE("i_destination_set")
);
--> statement-breakpoint
CREATE TABLE "dispute_case_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"from_status" varchar(32),
	"to_status" varchar(32),
	"message" text,
	"actor_name" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_id" varchar(32) NOT NULL,
	"dispute_type" varchar(32) NOT NULL,
	"client_id" varchar(128),
	"client_name" varchar(256) NOT NULL,
	"billing_period" varchar(7),
	"invoice_id" integer,
	"reconciliation_id" integer,
	"assigned_to" varchar(128),
	"severity" varchar(16) DEFAULT 'medium' NOT NULL,
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"disputed_amount" real,
	"resolved_amount" real,
	"description" text,
	"internal_notes" text,
	"sla_hours" integer DEFAULT 72 NOT NULL,
	"sla_due_at" timestamp,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_cases_reference_id_unique" UNIQUE("reference_id")
);
--> statement-breakpoint
CREATE TABLE "entity_presence_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"dim" varchar(32) NOT NULL,
	"entity_name" varchar(256) NOT NULL,
	"last_seen" bigint DEFAULT 0 NOT NULL,
	"first_seen" bigint DEFAULT 0 NOT NULL,
	"peak_today" integer DEFAULT 0 NOT NULL,
	"peak_ts" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "execution_health_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer,
	"run_id" integer,
	"cld" varchar(64),
	"cli" varchar(64),
	"error_type" varchar(32),
	"error_message" text,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failover_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"from_carrier" varchar(256) NOT NULL,
	"to_carrier" varchar(256) NOT NULL,
	"shift_percent" integer NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL,
	"executed_by" varchar(128) NOT NULL,
	"rollback_at" timestamp,
	"rolled_back_at" timestamp,
	"rolled_back_by" varchar(128),
	"audit_log" json DEFAULT '[]'::json NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fas_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"caller" varchar(64),
	"callee" varchar(64),
	"client_name" varchar(128),
	"vendor" varchar(128),
	"pdd_secs" real,
	"bill_secs" integer,
	"sip_code" integer,
	"reason" varchar(255),
	"fraud_score" real,
	"detected_at" timestamp DEFAULT now(),
	"alert_sent" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "fas_vendor_settings" (
	"vendor" varchar(255) PRIMARY KEY NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"alert_threshold" integer DEFAULT 30,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fix_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"page" varchar(200),
	"issue_type" varchar(50) NOT NULL,
	"component" varchar(100),
	"fix_action" varchar(100),
	"outcome" varchar(20) NOT NULL,
	"outcome_message" text,
	"triggered_by" varchar(20) DEFAULT 'manual' NOT NULL,
	"performed_by" varchar(200),
	"screenshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_destinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"level" integer DEFAULT 1 NOT NULL,
	"name" varchar(128) NOT NULL,
	"country_code" varchar(4),
	"dial_prefix" varchar(32),
	"operator_name" varchar(128),
	"commercial_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"blocked_reason" varchar(256),
	"notes" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"reviewed_by" varchar(256),
	"reviewed_at" timestamp,
	"comments" text,
	"locked_by" varchar(256),
	"locked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governed_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"unique_id" varchar(128),
	"channel_a" varchar(255),
	"channel_b" varchar(255),
	"caller" varchar(64),
	"callee" varchar(64),
	"connection_name" varchar(128),
	"rule_id" integer,
	"cap_sec" integer,
	"start_time" timestamp DEFAULT now(),
	"bye_sent_at" timestamp,
	"playback_started_at" timestamp,
	"completed_at" timestamp,
	"recording_path" varchar(512),
	"trigger_reason" varchar(64),
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"cdr_status" varchar(32),
	"cdr_caller" varchar(64),
	"cdr_callee" varchar(64),
	"cdr_duration" integer,
	"cdr_cost" real,
	"cdr_vendor_cost" real,
	"cdr_vendor_name" varchar(128),
	"cdr_checked_at" timestamp,
	"vendor_call_id" varchar(256),
	"vendor_ip" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "host_outage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" integer NOT NULL,
	"host_label" varchar(128),
	"host_ip" varchar(128),
	"down_at" timestamp NOT NULL,
	"recovered_at" timestamp,
	"duration_sec" integer,
	"cause" varchar(128),
	"checked_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incident_lifecycle_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"from_state" varchar(24),
	"to_state" varchar(24) NOT NULL,
	"actor" varchar(128),
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" varchar(128) NOT NULL,
	"entity_name" varchar(255),
	"incident_type" varchar(64) NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"confidence" integer DEFAULT 70 NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"reasons" json DEFAULT '[]'::json,
	"suggested_action" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"source" varchar(64) NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "intelligent_failover_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_group_id" varchar(128),
	"destination_prefix" varchar(32),
	"label" varchar(128) NOT NULL,
	"route_class" varchar(32) DEFAULT 'STANDARD' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"minimum_asr" real DEFAULT 38 NOT NULL,
	"maximum_fas" real DEFAULT 5 NOT NULL,
	"minimum_stability" real DEFAULT 55 NOT NULL,
	"max_traffic_shift" integer DEFAULT 20 NOT NULL,
	"max_duration_minutes" integer DEFAULT 30 NOT NULL,
	"rollback_window_minutes" integer DEFAULT 30 NOT NULL,
	"notification_required" boolean DEFAULT true NOT NULL,
	"approved_failover_vendors" text[] DEFAULT '{}' NOT NULL,
	"updated_by" varchar(128),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"simulation_validated_at" timestamp,
	"simulation_scenario" json,
	"arming_status" varchar(32) DEFAULT 'disarmed' NOT NULL,
	"armed_at" timestamp,
	"armed_by" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "invoice_cdr_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"cdr_id" varchar(128),
	"cdr_start_time" varchar(64),
	"callee" varchar(256),
	"duration_secs" integer,
	"i_tariff" varchar(64),
	"tariff_version_id" integer,
	"rating_verification_id" integer,
	"reproduced_cost" real NOT NULL,
	"actual_cost" real,
	"delta" real,
	"interval_1_used" integer,
	"interval_n_used" integer,
	"price_1_used" real,
	"price_n_used" real,
	"connect_fee_used" real,
	"grace_period_used" integer,
	"free_seconds_used" integer,
	"post_call_surcharge_used" real,
	"prefix" varchar(32),
	"verification_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"snapshot_hash" varchar(64) NOT NULL,
	"locked_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_email_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"recipients" text NOT NULL,
	"cc_addresses" text DEFAULT '[]',
	"subject" varchar(512) NOT NULL,
	"body_text" text,
	"sent_by" varchar(255),
	"status" varchar(32) DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"sent_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(128),
	"client_name" varchar(256) NOT NULL,
	"billing_period" varchar(7) NOT NULL,
	"invoice_id" integer,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"scheduled_at" timestamp,
	"generated_at" timestamp,
	"approved_at" timestamp,
	"approved_by" varchar(128),
	"sent_at" timestamp,
	"failed_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"notes" text,
	"i_tariff" varchar(64),
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"snapshot_id" integer,
	"cdr_call_id" varchar(128),
	"prefix" varchar(32),
	"duration_secs" integer,
	"reproduced_cost" real,
	"actual_cost" real,
	"delta" real
);
--> statement-breakpoint
CREATE TABLE "invoice_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"company_name" varchar(256),
	"i_account" integer,
	"i_tariff" varchar(64),
	"frequency" varchar(32) DEFAULT 'monthly' NOT NULL,
	"day_of_week" integer DEFAULT 1,
	"day_of_month" integer DEFAULT 1,
	"timezone" varchar(64) DEFAULT 'Etc/UTC',
	"auto_approve" boolean DEFAULT false,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_name" varchar(256) NOT NULL,
	"template_type" varchar(32) DEFAULT 'standard' NOT NULL,
	"detail_level" varchar(32) DEFAULT 'full' NOT NULL,
	"client_name" varchar(256),
	"show_prefix_breakdown" boolean DEFAULT false NOT NULL,
	"show_destination_summary" boolean DEFAULT false NOT NULL,
	"show_call_level_details" boolean DEFAULT false NOT NULL,
	"header_override" text,
	"footer_override" text,
	"filename_pattern" varchar(256),
	"subject_line_pattern" varchar(512),
	"attach_pdf_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"branding_profile_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" varchar(64) NOT NULL,
	"i_tariff" varchar(64),
	"customer_name" varchar(256),
	"period_start" varchar(32),
	"period_end" varchar(32),
	"total_reproduced" real,
	"total_actual" real,
	"total_delta" real,
	"line_count" integer,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp DEFAULT now(),
	"approved_at" timestamp,
	"sent_at" timestamp,
	"notes" text,
	"html_content" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_restrictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" varchar(20) DEFAULT 'global' NOT NULL,
	"scope_value" varchar(255),
	"cidr" varchar(64) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "ip_sharing_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip_address" varchar(64) NOT NULL,
	"company_data" text DEFAULT '[]' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"flagged_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_by_id" varchar(255),
	"reviewed_by_name" varchar(255),
	"reviewed_at" timestamp,
	"review_reason" text,
	CONSTRAINT "ip_sharing_approvals_ip_address_unique" UNIQUE("ip_address")
);
--> statement-breakpoint
CREATE TABLE "irsf_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" varchar(64) NOT NULL,
	"caller" varchar(64),
	"callee" varchar(64),
	"client_name" varchar(128),
	"vendor" varchar(128),
	"risk_prefix" varchar(20),
	"country" varchar(64),
	"breakout" varchar(64),
	"fraud_score" real DEFAULT 100,
	"blocked" boolean DEFAULT false,
	"alert_sent" boolean DEFAULT false,
	"detected_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kam_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"kam_id" integer NOT NULL,
	"account_id" varchar(32) NOT NULL,
	"client_name" varchar(128),
	"drop_threshold" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32),
	"title" varchar(128),
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"org_role" varchar(20) DEFAULT 'KAM',
	"reports_to" integer,
	"user_id" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "margin_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" varchar(32) NOT NULL,
	"dimension_type" varchar(16) NOT NULL,
	"dimension_name" varchar(256) NOT NULL,
	"date" date NOT NULL,
	"threshold_pct" real,
	"actual_pct" real,
	"delta_pct" real,
	"amount_usd" real,
	"severity" varchar(16) DEFAULT 'medium' NOT NULL,
	"message" text,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by" varchar(128),
	"acknowledged_at" timestamp,
	"triggered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "margin_analytics_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"dimension_type" varchar(16) NOT NULL,
	"dimension_id" varchar(64),
	"dimension_name" varchar(256) NOT NULL,
	"revenue_usd" real,
	"cost_usd" real,
	"margin_usd" real,
	"margin_pct" real,
	"duration_sec" real,
	"calls" integer,
	"asr" real,
	"acd" real,
	"source" varchar(32) DEFAULT 'dmr' NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" integer NOT NULL,
	"timestamp" timestamp DEFAULT now(),
	"jitter" real NOT NULL,
	"latency" real NOT NULL,
	"packet_loss" real NOT NULL,
	"mos" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"secret" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"backup_codes" text[] DEFAULT '{}' NOT NULL,
	"enabled_at" timestamp,
	"last_used_at" timestamp,
	CONSTRAINT "mfa_secrets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "monitored_hosts" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar(128) NOT NULL,
	"ip" varchar(128) NOT NULL,
	"type" varchar(32) DEFAULT 'vendor' NOT NULL,
	"ports" text,
	"notify_email" varchar(256),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "monitoring_assignments" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"items" text[] DEFAULT '{}' NOT NULL,
	"assigned_by" varchar,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mos_hourly" (
	"id" serial PRIMARY KEY NOT NULL,
	"hour" timestamp NOT NULL,
	"vendor" varchar(128),
	"avg_mos" real,
	"min_mos" real,
	"max_mos" real,
	"call_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "navigation_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"module_key" text NOT NULL,
	"title" text NOT NULL,
	"icon" text DEFAULT 'circle' NOT NULL,
	"route" text NOT NULL,
	"engine" text,
	"adapter_support" text[] DEFAULT '{}' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"default_portal" text,
	"is_movable" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "navigation_modules_module_key_unique" UNIQUE("module_key")
);
--> statement-breakpoint
CREATE TABLE "noc_incident_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"user_name" varchar(255) NOT NULL,
	"assigned_by" varchar(255),
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "noc_incident_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20),
	"actor_id" varchar(255),
	"actor_name" varchar(255) DEFAULT 'system' NOT NULL,
	"note" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "noc_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"type" varchar(32) DEFAULT 'manual' NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"entity_type" varchar(32),
	"entity_id" varchar(128),
	"entity_name" varchar(255),
	"description" text,
	"suggested_action" text,
	"assignee_id" varchar(255),
	"assignee_name" varchar(255),
	"source" varchar(64) DEFAULT 'manual' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"mitigated_at" timestamp,
	"resolved_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_lookup_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(32) NOT NULL,
	"country" varchar(64),
	"country_code" varchar(4),
	"carrier" varchar(128),
	"line_type" varchar(32),
	"ported" boolean,
	"active" boolean,
	"roaming" boolean,
	"cnam" varchar(128),
	"stir_shaken" varchar(8),
	"reputation_score" integer,
	"raw_json" text,
	"looked_up_at" timestamp DEFAULT now(),
	CONSTRAINT "number_lookup_cache_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "outage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"down_at" timestamp NOT NULL,
	"recovered_at" timestamp,
	"duration_sec" integer,
	"cause" varchar(128),
	"checked_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "partner_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_name" varchar(256) NOT NULL,
	"company_display_name" varchar(256),
	"contact_email" varchar(256),
	"access_code_hash" varchar(256) NOT NULL,
	"access_code_prefix" varchar(8) NOT NULL,
	"logo_url" text,
	"welcome_message" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_reminder_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"grace_days" integer DEFAULT 7 NOT NULL,
	"reminder_interval_days" integer DEFAULT 7 NOT NULL,
	"max_reminders" integer DEFAULT 3 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reminder_email_template" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"company_name" varchar(256),
	"invoice_id" integer,
	"amount" real DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"payment_date" varchar(32) NOT NULL,
	"payment_method" varchar(64) DEFAULT 'bank_transfer',
	"reference" varchar(256),
	"notes" text,
	"status" varchar(32) DEFAULT 'received' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_feature_flags" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"owner_role" varchar(32) NOT NULL,
	"changed_by" varchar(255),
	"changed_by_name" varchar(128),
	"changed_at" timestamp DEFAULT now(),
	"reason" text,
	"prev_state" boolean
);
--> statement-breakpoint
CREATE TABLE "portal_access_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"account_id" varchar(32) NOT NULL,
	"account_name" varchar(128) NOT NULL,
	"label" varchar(128),
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"permissions" text DEFAULT '["cdrs","usage","billing"]',
	"client_profile_id" integer,
	CONSTRAINT "portal_access_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "portal_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'layout-dashboard' NOT NULL,
	"theme" text DEFAULT 'neutral' NOT NULL,
	"layout_type" text DEFAULT 'sidebar-sections' NOT NULL,
	"default_route" text DEFAULT '/' NOT NULL,
	"allowed_roles" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"primary_color" text DEFAULT 'purple' NOT NULL,
	"accent_color" text DEFAULT 'indigo' NOT NULL,
	"background_style" text DEFAULT 'flat' NOT NULL,
	"density" text DEFAULT 'comfortable' NOT NULL,
	"nav_style" text DEFAULT 'glass' NOT NULL,
	"font_scale" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_definitions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "portal_module_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"portal_id" text NOT NULL,
	"module_id" integer NOT NULL,
	"section" text DEFAULT 'main' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"display_label" text,
	"adapter" text,
	"visibility" text DEFAULT 'full' NOT NULL,
	"is_home" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"adapter_type" text,
	"widget_profile" text DEFAULT 'standard' NOT NULL,
	"access_scope" text DEFAULT 'global' NOT NULL,
	"realtime_enabled" boolean DEFAULT false NOT NULL,
	"density_mode" text DEFAULT 'standard' NOT NULL,
	"default_time_range" text DEFAULT '24h' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"portal_id" text NOT NULL,
	"section_key" text NOT NULL,
	"title" text NOT NULL,
	"icon" text DEFAULT 'circle' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_ticket_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author" varchar(20) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "portal_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"account_name" varchar(255),
	"category" varchar(50) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prefix_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" varchar(64) NOT NULL,
	"canonical_id" integer,
	"vendor_name" varchar(100),
	"full_prefix" varchar(10),
	"performed_by" varchar(128),
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_template_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"dial_prefix" varchar(32) NOT NULL,
	"country_name" varchar(128),
	"operator_name" varchar(128),
	"buy_rate" numeric(10, 6) NOT NULL,
	"margin_pct" numeric(8, 4) NOT NULL,
	"sell_rate" numeric(10, 6) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pricing_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"product_id" integer NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_destination_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"destination_id" integer NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(128),
	"offer_min" real,
	"offer_target" real,
	"offer_premium" real
);
--> statement-breakpoint
CREATE TABLE "product_docs" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_prefix" varchar(16) NOT NULL,
	"title" varchar(255) NOT NULL,
	"section" varchar(64) DEFAULT 'General' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by" varchar(255),
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer,
	"destination_id" integer,
	"event_type" varchar(64) NOT NULL,
	"description" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"performed_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_prefixes" (
	"prefix" varchar(16) PRIMARY KEY NOT NULL,
	"product_code" varchar(16) NOT NULL,
	"product_name" varchar(64) NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"destination_id" integer,
	"prefix" varchar(32),
	"rate" numeric(12, 6) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"color" varchar(32) DEFAULT 'violet',
	"default_routing_template" varchar(128),
	"backup_routing_template" varchar(128),
	"default_pricing_template" varchar(128),
	"min_margin_pct" real DEFAULT 0,
	"discount_range_min" real,
	"discount_range_max" real,
	"notice_period_days" integer DEFAULT 7,
	"offer_window_min" real,
	"offer_window_target" real,
	"offer_window_premium" real,
	"trunk_prefix" varchar(8),
	"segment" varchar(32),
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_registry_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "provisioning_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"i_account" integer NOT NULL,
	"product_id" integer NOT NULL,
	"routing_template_id" integer,
	"pricing_template_id" integer,
	"status" varchar(32) DEFAULT 'pending',
	"steps" text,
	"i_tariff" integer,
	"i_routing_group" integer,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "quality_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"avg_mos" real NOT NULL,
	"carrier" varchar(128),
	"sample_count" integer DEFAULT 0,
	"alert_sent" boolean DEFAULT false,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rate_card_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"rate_card_id" integer NOT NULL,
	"prefix" varchar(20) NOT NULL,
	"country" varchar(255),
	"breakout" varchar(255),
	"rate_per_min" real NOT NULL,
	"origin_prefix" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_name" varchar(128) NOT NULL,
	"name" varchar(128) NOT NULL,
	"card_type" varchar(10) DEFAULT 'vendor' NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"effective_date" timestamp,
	"entry_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"sippy_tariff_id" integer
);
--> statement-breakpoint
CREATE TABLE "rate_notification_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_ref" varchar(32) NOT NULL,
	"template_id" integer,
	"client_name" varchar(256) NOT NULL,
	"product_name" varchar(128),
	"notification_type" varchar(32),
	"destination_count" integer DEFAULT 0,
	"tariff_updated" boolean DEFAULT false,
	"sbc_mapping_ok" boolean DEFAULT false,
	"sbc_updated" boolean DEFAULT false,
	"email_sent" boolean DEFAULT false,
	"violated_rules" boolean DEFAULT false,
	"approval_required" boolean DEFAULT false,
	"company_id" integer,
	"product_id" integer,
	"i_account" integer,
	"i_tariff" integer,
	"service_plan_id" varchar(64),
	"sheet_generated" boolean DEFAULT false,
	"sheet_generated_at" timestamp,
	"template_version" varchar(128),
	"generated_attachment_hash" varchar(64),
	"destination_snapshot" text,
	"submitted_for_approval_at" timestamp,
	"submitted_by" varchar(128),
	"approved_by" varchar(128),
	"approved_at" timestamp,
	"rejected_by" varchar(128),
	"rejected_at" timestamp,
	"rejection_reason" text,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"remarks" text,
	"push_results" text,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_notification_template_destinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"country" varchar(128),
	"carrier_type" varchar(64),
	"category" varchar(128),
	"destination_name" varchar(256) NOT NULL,
	"dial_prefix" varchar(32),
	"rate" numeric(10, 6) NOT NULL,
	"base_rate" numeric(10, 6),
	"activation_date" varchar(16),
	"activation_time" varchar(8),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_notification_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_name" varchar(256) NOT NULL,
	"product_id" integer NOT NULL,
	"notification_type" varchar(32) DEFAULT 'default' NOT NULL,
	"recipients" text,
	"cc_emails" text,
	"traffic_format" varchar(64),
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"tariff_id" varchar(64),
	"product_id" integer,
	"notification_type" varchar(32) DEFAULT 'rate_change' NOT NULL,
	"subject" varchar(512),
	"message" text,
	"affected_accounts" integer[],
	"affected_count" integer DEFAULT 0,
	"scheduled_for" timestamp,
	"sent_at" timestamp,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_push_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"product_name" varchar(64),
	"trunk_prefix" varchar(8),
	"format" varchar(16) DEFAULT 'full',
	"rate_type" varchar(16) DEFAULT 'current',
	"total_clients" integer DEFAULT 0,
	"pushed_clients" integer DEFAULT 0,
	"failed_clients" integer DEFAULT 0,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"switch_name" varchar(128),
	"i_tariff" integer,
	"full_prefix" varchar(32),
	"old_rate" varchar(32),
	"new_rate" varchar(32),
	"effective_at" varchar(32),
	"upload_token" varchar(256),
	"upload_status" varchar(32),
	"verification_result" varchar(32),
	"push_method" varchar(32),
	"client_names" text,
	"dial_prefix" varchar(128),
	"destination_name" varchar(256),
	"notification_type" varchar(32),
	CONSTRAINT "rate_push_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "rating_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"cdr_call_id" varchar(128),
	"cdr_start_time" varchar(64),
	"prefix" varchar(32),
	"destination" varchar(256),
	"i_tariff" varchar(64),
	"tariff_version_id" integer,
	"duration_secs" integer,
	"billed_secs" integer,
	"sippy_actual_cost" real,
	"reproduced_cost" real,
	"delta_amount" real,
	"delta_pct" real,
	"discrepancy_type" varchar(64) DEFAULT 'unrated' NOT NULL,
	"verification_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"severity" varchar(16) DEFAULT 'none' NOT NULL,
	"verification_source" varchar(32) DEFAULT 'auto' NOT NULL,
	"verified_at" timestamp,
	"notes" text,
	"rate_snapshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rbac_permission_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"target_user_id" varchar(255),
	"target_role" varchar(40),
	"permission_key" varchar(80),
	"before_value" json,
	"after_value" json,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rbac_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(80) NOT NULL,
	"domain" varchar(40) NOT NULL,
	"label" varchar(120) NOT NULL,
	"description" text,
	"risk_level" varchar(20) DEFAULT 'low' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rbac_permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "rbac_role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" varchar(40) NOT NULL,
	"permission_key" varchar(80) NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"granted_by" varchar(255),
	"granted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rbac_user_permission_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"permission_key" varchar(80) NOT NULL,
	"granted" boolean NOT NULL,
	"scope" varchar(40) DEFAULT 'all',
	"reason" text,
	"granted_by" varchar(255) NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "recommendation_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"recommendation_id" integer,
	"execution_id" integer,
	"projected_asr_delta" real,
	"actual_asr_delta" real,
	"projected_margin_delta" real,
	"actual_margin_delta" real,
	"projected_fas_delta" real,
	"actual_fas_delta" real,
	"projected_stability_delta" real,
	"actual_stability_delta" real,
	"evaluated_at" timestamp DEFAULT now() NOT NULL,
	"rollback_triggered" boolean DEFAULT false NOT NULL,
	"rollback_reason" varchar(512)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"sender_user_id" varchar(128),
	"sender_name" varchar(255),
	"recipient_email" varchar(320) NOT NULL,
	"report_type" varchar(16) NOT NULL,
	"format" varchar(8) NOT NULL,
	"filename" varchar(255),
	"subject" varchar(500),
	"status" varchar(16) DEFAULT 'sent' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "reconciliation_report_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"report_type" varchar(20) DEFAULT 'carrier' NOT NULL,
	"recipients" text NOT NULL,
	"format" varchar(10) DEFAULT 'pdf' NOT NULL,
	"frequency" varchar(20) DEFAULT 'monthly' NOT NULL,
	"day_of_month" integer DEFAULT 1,
	"day_of_week" integer,
	"cron_hour" integer DEFAULT 8 NOT NULL,
	"carrier_tariff" varchar(64),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp,
	"next_due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_type" varchar(32) DEFAULT 'executive_monthly' NOT NULL,
	"title" varchar(256),
	"period_start" varchar(32),
	"period_end" varchar(32),
	"delivery_status" varchar(32) DEFAULT 'generated' NOT NULL,
	"recipients_json" text,
	"html_content" text,
	"generated_at" timestamp DEFAULT now(),
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reseller_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"contact_email" varchar(255),
	"markup_percent" real DEFAULT 0 NOT NULL,
	"i_customer" integer,
	"brand_name" varchar(128),
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_decision_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer,
	"run_id" integer,
	"cld" varchar(64) NOT NULL,
	"cli" varchar(64),
	"selected_carrier" varchar(128),
	"selected_carrier_id" integer,
	"candidate_routes" text,
	"decision_reason" varchar(255),
	"outcome" varchar(20),
	"sip_code" integer,
	"pdd_ms" real,
	"duration_sec" real,
	"failure_category" varchar(64),
	"failure_type" varchar(32),
	"carrier_scores_snapshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_health_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"routing_group_id" varchar(64) NOT NULL,
	"routing_group_name" varchar(256) NOT NULL,
	"scored_at" timestamp DEFAULT now() NOT NULL,
	"overall_score" real NOT NULL,
	"vendor_count" integer DEFAULT 0 NOT NULL,
	"lowest_vendor_score" real,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "route_quality_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" varchar(64) NOT NULL,
	"vendor_name" varchar(128) NOT NULL,
	"prefix" varchar(32) NOT NULL,
	"window_hours" integer NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"asr" real,
	"acd_seconds" real,
	"pdd_ms" real,
	"total_cost_usd" real,
	"revenue_usd" real,
	"margin_usd" real,
	"rate_503" real,
	"rate_486" real,
	"rate_480" real,
	"rate_408" real,
	"rate_404" real,
	"rate_403" real,
	"spike_flags" jsonb
);
--> statement-breakpoint
CREATE TABLE "route_test_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"destination_prefix" varchar(32) NOT NULL,
	"vendor_ids" text[] DEFAULT '{}' NOT NULL,
	"vendor_names" text[] DEFAULT '{}' NOT NULL,
	"schedule_minutes" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cli_to_send" varchar(32),
	"created_by" varchar(128),
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "route_test_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"vendor_id" varchar(64),
	"vendor_name" varchar(128),
	"destination" varchar(32),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"sip_code" integer,
	"pdd_ms" integer,
	"duration_ms" integer,
	"cli_sent" varchar(32),
	"cli_received" varchar(32),
	"cli_match" varchar(16),
	"notes" text,
	"raw_response" jsonb
);
--> statement-breakpoint
CREATE TABLE "routing_cache_meta" (
	"id" serial PRIMARY KEY NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_status" varchar(32) DEFAULT 'pending',
	"last_sync_error" text,
	"rg_count" integer DEFAULT 0,
	"ds_count" integer DEFAULT 0,
	"conn_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "routing_groups_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"i_routing_group" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"policy" varchar(64),
	"media_relay" varchar(64),
	"on_net" boolean DEFAULT false,
	"members_count" integer DEFAULT 0,
	"raw_json" text,
	"cached_at" timestamp DEFAULT now(),
	CONSTRAINT "routing_groups_cache_i_routing_group_unique" UNIQUE("i_routing_group")
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"condition_metric" varchar(64) NOT NULL,
	"condition_operator" varchar(16) NOT NULL,
	"condition_threshold" real NOT NULL,
	"condition_duration_min" integer DEFAULT 5 NOT NULL,
	"scope_vendor" varchar(128),
	"scope_destination" varchar(64),
	"action_type" varchar(64) NOT NULL,
	"action_payload" text,
	"last_triggered_at" timestamp,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier_name" varchar(256) NOT NULL,
	"entity" varchar(256),
	"current_score" real,
	"suggested_action" text NOT NULL,
	"reason" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"simulation_validated_at" timestamp,
	"simulation_scenario" json
);
--> statement-breakpoint
CREATE TABLE "routing_template_vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"vendor_name" varchar(128) NOT NULL,
	"i_connection" integer,
	"i_destination_set" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "routing_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"product_id" integer NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rtp_quality_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" varchar(128) NOT NULL,
	"avg_mos" real,
	"p10_mos" real,
	"avg_jitter_ms" real,
	"avg_pkt_loss_pct" real,
	"avg_latency_ms" real,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"snapped_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rtp_quality_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" varchar(128) NOT NULL,
	"destination_prefix" varchar(32) DEFAULT '' NOT NULL,
	"window_minutes" integer NOT NULL,
	"avg_mos" real,
	"p10_mos" real,
	"avg_jitter_ms" real,
	"avg_pkt_loss_pct" real,
	"avg_latency_ms" real,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sbc_hosts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 5060 NOT NULL,
	"vendor" varchar(64) DEFAULT 'generic' NOT NULL,
	"snmp_community" varchar(64),
	"api_url" varchar(255),
	"api_key" varchar(255),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_status" varchar(32) DEFAULT 'unknown',
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"metrics" text DEFAULT '["asr","acd","ner"]' NOT NULL,
	"time_window" varchar(20) DEFAULT '24h' NOT NULL,
	"frequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"recipients" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp,
	"next_due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"jitter_threshold" integer DEFAULT 30,
	"latency_threshold" integer DEFAULT 150,
	"packet_loss_threshold" real DEFAULT 1,
	"simulation_enabled" boolean DEFAULT false,
	"monitored_ip" varchar(45) DEFAULT '45.59.163.182',
	"switch_type" varchar(50) DEFAULT 'vos3000',
	"portal_url" varchar(255),
	"portal_username" varchar(128),
	"portal_password" varchar(255),
	"portal_session_token" varchar(512),
	"portal_session_user" varchar(128),
	"portal_session_base" varchar(512),
	"api_admin_username" varchar(128),
	"api_admin_password" varchar(255),
	"admin_web_password" varchar(255),
	"sippy_rate_admin_user" varchar(128),
	"sippy_rate_admin_pass" varchar(255),
	"snmp_enabled" boolean DEFAULT false,
	"snmp_host" varchar(255),
	"snmp_port" integer DEFAULT 161,
	"snmp_community" varchar(128) DEFAULT 'public',
	"snmp_environments" varchar(255) DEFAULT '1',
	"alert_admin_email" varchar(255),
	"alert_gmail_user" varchar(255),
	"alert_gmail_app_pass" varchar(255),
	"alert_enabled" boolean DEFAULT false,
	"balance_alert_threshold" real DEFAULT 10,
	"fas_min_pdd_secs" integer DEFAULT 10,
	"fas_max_bill_secs" integer DEFAULT 5,
	"fas_early_answer_secs" integer DEFAULT 2,
	"fas_short_call_secs" integer DEFAULT 10,
	"mgmt_feature_permissions" text DEFAULT '["alerts","server_monitoring","did_management","test_call","graphs","bitseye","reports","cdr_viewer","balance_monitor","fraud_fas","clients","tools","call_flow_simulator","lcr_analyser","vendor_sla","account_management"]',
	"whatsapp_enabled" boolean DEFAULT false,
	"whatsapp_provider" varchar(20) DEFAULT 'callmebot',
	"whatsapp_phones" text,
	"whatsapp_api_key" varchar(255),
	"whatsapp_instance_id" varchar(128),
	"whatsapp_alert_types" text DEFAULT 'fas,balance,traffic,outage,auth,sip_error',
	"recording_server_url" varchar(512),
	"grafana_url" varchar(1024),
	"grafana_default_range" varchar(20) DEFAULT '1h',
	"grafana_panel_height" integer DEFAULT 480,
	"approval_settings" text,
	"dual_approval_ttl_minutes" integer DEFAULT 30,
	"sidebar_hidden_items" text DEFAULT '[]',
	"hlr_provider" varchar(20) DEFAULT 'none',
	"hlr_api_key" varchar(255),
	"hlr_api_secret" varchar(255),
	"otp_channel_policy" text DEFAULT '{"primary":"voice","fallback":[]}',
	"meta_phone_number_id" varchar(64),
	"meta_access_token" varchar(512),
	"meta_otp_template_name" varchar(128) DEFAULT 'otp_verification',
	"meta_otp_template_language" varchar(16) DEFAULT 'en_us',
	"meta_use_otp_template" boolean DEFAULT true,
	"meta_flow_id" varchar(64),
	"meta_waba_id" varchar(64),
	"meta_flows_enabled" boolean DEFAULT false,
	"meta_flows_public_key" text,
	"approval_expiry_email_enabled" boolean DEFAULT true,
	"approval_expiry_slack_webhook_url" varchar(512),
	"invoice_smtp_host" varchar(255),
	"invoice_smtp_port" integer DEFAULT 587,
	"invoice_smtp_secure" boolean DEFAULT false,
	"invoice_smtp_user" varchar(255),
	"invoice_smtp_pass" varchar(512),
	"invoice_smtp_from_name" varchar(255) DEFAULT 'Ichibaan Logic Billing',
	"invoice_smtp_from_email" varchar(255),
	"sip_error_alert_threshold" real DEFAULT 15
);
--> statement-breakpoint
CREATE TABLE "simbox_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" varchar(64) NOT NULL,
	"vendor_name" varchar(128) NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"risk_score" real DEFAULT 0 NOT NULL,
	"risk_level" varchar(10) DEFAULT 'low' NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"short_calls" integer DEFAULT 0 NOT NULL,
	"early_disconnect" integer DEFAULT 0 NOT NULL,
	"repeated_routes" integer DEFAULT 0 NOT NULL,
	"unique_cli" integer DEFAULT 0 NOT NULL,
	"unique_cld" integer DEFAULT 0 NOT NULL,
	"avg_duration_sec" real DEFAULT 0 NOT NULL,
	"signal_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sip_error_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_name" varchar(128) NOT NULL,
	"window_minutes" integer NOT NULL,
	"code" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"rate" real DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"dest_prefix" varchar(12) DEFAULT '' NOT NULL,
	"time_bucket" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sippy_change_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(32) NOT NULL,
	"change_type" varchar(32) NOT NULL,
	"subject" text NOT NULL,
	"client_name" varchar(255),
	"vendor_name" varchar(255),
	"old_value" text,
	"new_value" text,
	"meta" json,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sippy_snapshots" (
	"key" text PRIMARY KEY NOT NULL,
	"data" json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_breach_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" varchar(64) NOT NULL,
	"vendor_name" varchar(128) NOT NULL,
	"metric" varchar(20) NOT NULL,
	"threshold" real NOT NULL,
	"actual_value" real NOT NULL,
	"breach_start" timestamp NOT NULL,
	"breach_end" timestamp,
	"duration_minutes" real,
	"resolved" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_dlr_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" varchar(128),
	"client_ref" varchar(128),
	"status" integer,
	"status_text" varchar(16),
	"msisdn" varchar(32),
	"operator" varchar(64),
	"country" varchar(64),
	"error_code" varchar(32),
	"raw_payload" jsonb,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"internal_id" varchar(64),
	"bhaoo_id" varchar(128),
	"to_number" varchar(32) NOT NULL,
	"from_id" varchar(32),
	"message_text" text,
	"message_type" varchar(16) DEFAULT 'text',
	"status" varchar(16) DEFAULT 'submitted' NOT NULL,
	"status_code" integer,
	"operator" varchar(64),
	"country" varchar(64),
	"error_code" varchar(32),
	"error_message" text,
	"client_ref" varchar(128),
	"profile_id" integer,
	"fallback_triggered" boolean DEFAULT false NOT NULL,
	"fallback_at" timestamp,
	"dlr_received_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"channel" varchar(16) DEFAULT 'sms',
	"provider" varchar(32),
	"fallback_from" integer,
	"latency_ms" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"flow_token" varchar(64),
	"verified_at" timestamp,
	CONSTRAINT "sms_messages_internal_id_unique" UNIQUE("internal_id")
);
--> statement-breakpoint
CREATE TABLE "sms_vendor_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"operator" varchar(64) NOT NULL,
	"country" varchar(64),
	"sent" integer DEFAULT 0,
	"delivered" integer DEFAULT 0,
	"failed" integer DEFAULT 0,
	"pending" integer DEFAULT 0,
	"delivery_rate" real,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smtp_sender_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"email_address" varchar(256) NOT NULL,
	"reply_to" varchar(256),
	"communication_type" varchar(64) DEFAULT 'general' NOT NULL,
	"is_default" boolean DEFAULT false,
	"smtp_host" varchar(256) DEFAULT 'smtp.gmail.com' NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_user" varchar(256) NOT NULL,
	"smtp_pass" varchar(512) NOT NULL,
	"smtp_secure" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "switches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" varchar(20) DEFAULT 'vos3000' NOT NULL,
	"portal_url" varchar(512),
	"portal_username" varchar(128),
	"portal_password" varchar(255),
	"api_admin_username" varchar(128),
	"api_admin_password" varchar(255),
	"admin_web_password" varchar(255),
	"login_type" integer DEFAULT 1,
	"enabled" boolean DEFAULT true,
	"last_sync_at" timestamp,
	"last_sync_status" varchar(512),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "synthetic_test_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"connected_calls" integer DEFAULT 0 NOT NULL,
	"failed_calls" integer DEFAULT 0 NOT NULL,
	"infra_failures" integer DEFAULT 0 NOT NULL,
	"carrier_failures" integer DEFAULT 0 NOT NULL,
	"asr" real,
	"avg_pdd_ms" real,
	"baseline_asr_at_run" real,
	"anomaly_fired" boolean DEFAULT false NOT NULL,
	"degraded_vs_last_run" boolean DEFAULT false NOT NULL,
	"triggered_by" varchar(20) DEFAULT 'scheduler' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariff_change_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tariff_version_id" integer NOT NULL,
	"i_tariff" varchar(64) NOT NULL,
	"prefix" varchar(32),
	"destination" varchar(256),
	"change_type" varchar(32) NOT NULL,
	"old_interval_1" integer,
	"new_interval_1" integer,
	"old_interval_n" integer,
	"new_interval_n" integer,
	"old_price_1" real,
	"new_price_1" real,
	"old_price_n" real,
	"new_price_n" real,
	"old_connect_fee" real,
	"new_connect_fee" real,
	"old_grace_period" integer,
	"new_grace_period" integer,
	"old_surcharge" real,
	"new_surcharge" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariff_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"i_tariff" varchar(64) NOT NULL,
	"tariff_name" varchar(256),
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"snapshot_json" text NOT NULL,
	"rate_count" integer DEFAULT 0,
	"effective_from" timestamp,
	"effective_to" timestamp,
	"notes" text,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "termination_chains" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"reve_profile_id" integer,
	"asterisk_trunk" varchar(64) DEFAULT 'Sippy' NOT NULL,
	"asterisk_host" varchar(128) DEFAULT '159.223.32.59' NOT NULL,
	"sippy_client_account_id" integer,
	"sippy_vendor_id" integer,
	"sippy_connection_id" integer,
	"sippy_routing_group_id" integer,
	"sippy_client_name" varchar(128),
	"sippy_vendor_name" varchar(128),
	"sippy_connection_name" varchar(128),
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_campaign_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"cld" varchar(64) NOT NULL,
	"cli" varchar(64),
	"label" varchar(128),
	"outcome" varchar(20) DEFAULT 'pending' NOT NULL,
	"sip_code" integer,
	"duration_sec" real,
	"pdd_ms" real,
	"fas_detected" boolean DEFAULT false,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "test_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"destinations" text NOT NULL,
	"schedule_type" varchar(20) DEFAULT 'once' NOT NULL,
	"scheduled_at" timestamp,
	"cron_hour" integer,
	"interval_minutes" integer,
	"next_run_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"baseline_asr" real,
	"baseline_pdd" real,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traffic_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_name" varchar(128) NOT NULL,
	"account_id" varchar(32),
	"kam_id" integer,
	"alert_type" varchar(32) NOT NULL,
	"prev_calls" integer DEFAULT 0,
	"curr_calls" integer DEFAULT 0,
	"email_sent" boolean DEFAULT false,
	"email_sent_at" timestamp,
	"resolved_at" timestamp,
	"triggered_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "traffic_anomalies" (
	"id" serial PRIMARY KEY NOT NULL,
	"detected_at" timestamp DEFAULT now(),
	"concurrent" integer NOT NULL,
	"baseline_avg" real NOT NULL,
	"baseline_std_dev" real NOT NULL,
	"sigma_multiple" real NOT NULL,
	"is_business_hours" boolean DEFAULT false,
	"resolved_at" timestamp,
	"alert_sent" boolean DEFAULT false,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "traffic_baselines" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_of_week" integer NOT NULL,
	"hour" integer NOT NULL,
	"avg_concurrent" real DEFAULT 0,
	"std_dev" real DEFAULT 0,
	"sample_count" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "traffic_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now(),
	"concurrent" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"hour" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_config" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"display_name" varchar(128),
	"phone" varchar(30),
	"department" varchar(128),
	"timezone" varchar(64) DEFAULT 'UTC',
	"notification_email" varchar(255),
	"default_report_range" varchar(30) DEFAULT 'Last 3 hr',
	"bio" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"module_key" text NOT NULL,
	"portal_key" text,
	"label" text,
	"icon" text DEFAULT 'circle' NOT NULL,
	"route" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"team_id" varchar(64),
	"assigned_at" timestamp DEFAULT now(),
	"assigned_by" varchar
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(512) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"last_activity" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "validation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" varchar(32) NOT NULL,
	"group_name" varchar(128) NOT NULL,
	"rule_key" varchar(128) NOT NULL,
	"description" text NOT NULL,
	"config_category" varchar(32),
	"config_key" varchar(128),
	"selected_action" varchar(64) DEFAULT 'ignore' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_column_maps" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"label" varchar(100) NOT NULL,
	"mappings" jsonb NOT NULL,
	"skip_rows" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_health_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_name" varchar(128) NOT NULL,
	"scored_at" timestamp DEFAULT now() NOT NULL,
	"overall_score" real NOT NULL,
	"quality_score" real,
	"reliability_score" real,
	"fraud_score" real,
	"margin_score" real,
	"trend" varchar(16),
	"trend_delta" real,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "vendor_metric_baselines" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" varchar(128) NOT NULL,
	"metric" varchar(32) NOT NULL,
	"mean" real NOT NULL,
	"stddev" real NOT NULL,
	"sample_count" integer NOT NULL,
	"window_hours" integer DEFAULT 72 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_parser_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"prefix_format" text DEFAULT 'single' NOT NULL,
	"prefix_expression_mode" text DEFAULT 'mixed' NOT NULL,
	"date_format" text DEFAULT 'YYYY-MM-DD' NOT NULL,
	"decimal_separator" text DEFAULT '.' NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"default_billing" text DEFAULT '60/60' NOT NULL,
	"ignore_header_rows" integer DEFAULT 0 NOT NULL,
	"sheet_name" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"parser_version" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "vendor_parser_profiles_vendor_id_unique" UNIQUE("vendor_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_probe_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" varchar(32) NOT NULL,
	"vendor_name" varchar(255),
	"connection_id" varchar(32),
	"connection_name" varchar(255),
	"host" varchar(255),
	"port" integer DEFAULT 5060,
	"probed_at" timestamp DEFAULT now() NOT NULL,
	"latency_ms" integer,
	"sip_response_code" integer,
	"reachable" boolean DEFAULT false NOT NULL,
	"error" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "vendor_product_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"vendor_product_label" text NOT NULL,
	"internal_product_id" integer,
	"destination_set_id" integer,
	"sippy_switch_id" integer,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vendor_product_prefixes" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_id" integer NOT NULL,
	"product_code" varchar(1) NOT NULL,
	"product_name" varchar(32) NOT NULL,
	"full_prefix" varchar(5) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_product_prefixes_full_prefix_unique" UNIQUE("full_prefix")
);
--> statement-breakpoint
CREATE TABLE "vendor_rate_normalized_prefixes" (
	"id" serial PRIMARY KEY NOT NULL,
	"sheet_id" integer NOT NULL,
	"sheet_row_id" integer,
	"normalized_prefix" varchar(50) NOT NULL,
	"destination" varchar(255),
	"destination_id" integer,
	"rate" numeric(10, 6) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"effective_date" date,
	"expiry_date" date,
	"interval_1" integer DEFAULT 60,
	"interval_n" integer DEFAULT 60,
	"match_status" varchar(20) DEFAULT 'pending',
	"match_confidence" varchar(20),
	"match_method" varchar(30),
	"parser_version" integer,
	"parser_warnings" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vendor_rate_sheet_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"sheet_id" integer NOT NULL,
	"prefix" varchar(50) NOT NULL,
	"destination" varchar(255),
	"rate" numeric(10, 6) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"effective_date" date,
	"expiry_date" date,
	"interval_1" integer DEFAULT 60,
	"interval_n" integer DEFAULT 60,
	"interconnect" text,
	"raw_row" jsonb,
	"raw_prefix_expression" text
);
--> statement-breakpoint
CREATE TABLE "vendor_rate_sheets" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"effective_date" date,
	"row_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"uploaded_by" varchar(128),
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"activated_at" timestamp,
	"activated_by" varchar(128),
	"vendor_product" text,
	"internal_product_id" integer,
	"destination_set_id" integer,
	"sippy_switch_id" integer,
	"parser_profile_id" integer,
	"parser_version" integer
);
--> statement-breakpoint
CREATE TABLE "vendor_stability_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" varchar(128) NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL,
	"q_score" integer NOT NULL,
	"asr" real,
	"ner" real,
	"avg_pdd" real,
	"fas_rate" real,
	"call_count" integer DEFAULT 0 NOT NULL,
	"stability" varchar(20) DEFAULT 'unknown' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_otp_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"to_number" varchar(32) NOT NULL,
	"otp" varchar(16) NOT NULL,
	"trunk" varchar(64) DEFAULT 'Sippy',
	"asterisk_id" varchar(128),
	"status" varchar(16) DEFAULT 'initiated' NOT NULL,
	"error_message" text,
	"initiated_at" timestamp DEFAULT now() NOT NULL,
	"answered_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "watcher_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"user_id" varchar(255),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"notify_approval_expiry" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_alert_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" varchar(50) NOT NULL,
	"recipient" varchar(32) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_msg" text,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspace_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"portal_slug" text,
	"domain_id" text,
	"icon" text,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_definitions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workspace_tab_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tab_id" integer NOT NULL,
	"route" text NOT NULL,
	"label" text,
	"icon" text,
	"sort_order" integer DEFAULT 0,
	"is_contextual" boolean DEFAULT false NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"visibility_roles" text[]
);
--> statement-breakpoint
CREATE TABLE "workspace_tabs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0,
	"is_visible" boolean DEFAULT true NOT NULL,
	"visibility_roles" text[]
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_portal_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"portal_slug" varchar NOT NULL,
	"assigned_at" timestamp DEFAULT now(),
	"assigned_by" varchar
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"username" varchar,
	"password_hash" varchar,
	"job_title" varchar,
	"platform_access_type" varchar DEFAULT 'full_platform' NOT NULL,
	"default_portal" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "call_governance_log" ADD CONSTRAINT "call_governance_log_governed_call_id_governed_calls_id_fk" FOREIGN KEY ("governed_call_id") REFERENCES "public"."governed_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governed_calls" ADD CONSTRAINT "governed_calls_rule_id_call_governance_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."call_governance_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sections" ADD CONSTRAINT "portal_sections_portal_id_portal_definitions_slug_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portal_definitions"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_permission_key_rbac_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."rbac_permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_user_permission_overrides" ADD CONSTRAINT "rbac_user_permission_overrides_permission_key_rbac_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."rbac_permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_test_results" ADD CONSTRAINT "route_test_results_job_id_route_test_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."route_test_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_column_maps" ADD CONSTRAINT "vendor_column_maps_vendor_id_canonical_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."canonical_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_parser_profiles" ADD CONSTRAINT "vendor_parser_profiles_vendor_id_canonical_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."canonical_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_product_mappings" ADD CONSTRAINT "vendor_product_mappings_vendor_id_canonical_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."canonical_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_product_mappings" ADD CONSTRAINT "vendor_product_mappings_internal_product_id_product_registry_id_fk" FOREIGN KEY ("internal_product_id") REFERENCES "public"."product_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_product_prefixes" ADD CONSTRAINT "vendor_product_prefixes_canonical_id_canonical_vendors_id_fk" FOREIGN KEY ("canonical_id") REFERENCES "public"."canonical_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_normalized_prefixes" ADD CONSTRAINT "vendor_rate_normalized_prefixes_sheet_id_vendor_rate_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."vendor_rate_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_normalized_prefixes" ADD CONSTRAINT "vendor_rate_normalized_prefixes_sheet_row_id_vendor_rate_sheet_rows_id_fk" FOREIGN KEY ("sheet_row_id") REFERENCES "public"."vendor_rate_sheet_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_sheet_rows" ADD CONSTRAINT "vendor_rate_sheet_rows_sheet_id_vendor_rate_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."vendor_rate_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate_sheets" ADD CONSTRAINT "vendor_rate_sheets_vendor_id_canonical_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."canonical_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "csnap_dim_name_ts_idx" ON "concurrent_snapshots" USING btree ("dim","entity_name","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "epr_dim_name_uidx" ON "entity_presence_registry" USING btree ("dim","entity_name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_portal_module" ON "portal_module_assignments" USING btree ("portal_id","module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_portal_section" ON "portal_sections" USING btree ("portal_id","section_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rtp_quality_stats_uidx" ON "rtp_quality_stats" USING btree ("vendor_id","destination_prefix","window_minutes");--> statement-breakpoint
CREATE UNIQUE INDEX "sip_error_stats_uniq" ON "sip_error_stats" USING btree ("vendor_name","window_minutes","code","time_bucket","dest_prefix");--> statement-breakpoint
CREATE INDEX "vsn_vendor_ts_idx" ON "vendor_stability_snapshots" USING btree ("vendor","ts");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_upa_user_id" ON "user_portal_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_upa_portal" ON "user_portal_assignments" USING btree ("portal_slug");
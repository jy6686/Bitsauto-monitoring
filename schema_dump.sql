--
-- PostgreSQL database dump
--

\restrict wUz6qZB7kYzl6BU777NeaZl0EdrTNKYgtlGWMLNAA3jgO4Dptcil0qHyDpqc7gw

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_actions (
    id integer NOT NULL,
    account_id character varying(64) NOT NULL,
    account_name character varying(255),
    recommendation_ref jsonb,
    action_type character varying(50) NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    execution_mode character varying(20) DEFAULT 'dry_run'::character varying NOT NULL,
    primary_action text,
    sippy_params jsonb,
    sippy_result jsonb,
    requested_by character varying(255),
    requested_by_name character varying(255),
    approved_by character varying(255),
    approved_by_name character varying(255),
    rejected_by character varying(255),
    rejection_reason text,
    snoozed_until timestamp without time zone,
    notes text,
    audit_trail jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    idempotency_key character varying(128),
    verification_state character varying(30) DEFAULT 'not_applicable'::character varying
);


--
-- Name: account_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_actions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: account_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_actions_id_seq OWNED BY public.account_actions.id;


--
-- Name: account_caps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_caps (
    account_id character varying(64) NOT NULL,
    account_name text,
    session_limit integer,
    cps_limit integer,
    warning_threshold integer DEFAULT 90 NOT NULL,
    critical_threshold integer DEFAULT 100 NOT NULL,
    synced_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: account_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_configs (
    i_account integer NOT NULL,
    config_json text DEFAULT '{}'::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: account_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_state (
    id integer NOT NULL,
    account_id character varying(64) NOT NULL,
    account_name character varying(255),
    health_score integer DEFAULT 100 NOT NULL,
    fraud_risk integer DEFAULT 0 NOT NULL,
    anomaly_score integer DEFAULT 0 NOT NULL,
    quality_score integer DEFAULT 100 NOT NULL,
    balance_trend character varying(20) DEFAULT 'stable'::character varying NOT NULL,
    active_incident_count integer DEFAULT 0 NOT NULL,
    state character varying(20) DEFAULT 'healthy'::character varying NOT NULL,
    reasons json DEFAULT '[]'::json,
    last_incident_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    previous_health_score integer,
    previous_state character varying(20),
    trend_direction character varying(20) DEFAULT 'stable'::character varying NOT NULL,
    score_delta_24h integer DEFAULT 0 NOT NULL,
    auth_exposure_score integer DEFAULT 0 NOT NULL,
    exposure_risk_level character varying(20) DEFAULT 'low'::character varying NOT NULL,
    auth_exposure_signals jsonb,
    recommendation jsonb,
    risk_index integer DEFAULT 0
);


--
-- Name: account_state_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_state_history (
    id integer NOT NULL,
    account_id character varying(64) NOT NULL,
    account_name character varying(255),
    health_score integer NOT NULL,
    fraud_risk integer NOT NULL,
    anomaly_score integer NOT NULL,
    quality_score integer NOT NULL,
    state character varying(20) NOT NULL,
    reasons json DEFAULT '[]'::json,
    snapshot_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: account_state_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_state_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: account_state_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_state_history_id_seq OWNED BY public.account_state_history.id;


--
-- Name: account_state_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_state_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: account_state_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_state_id_seq OWNED BY public.account_state.id;


--
-- Name: action_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_ledger (
    id integer NOT NULL,
    ledger_id character varying(64) NOT NULL,
    scope character varying(20) NOT NULL,
    source_system character varying(20) NOT NULL,
    action_type character varying(64) NOT NULL,
    entity_id character varying(128),
    entity_name character varying(255),
    payload jsonb,
    idempotency_key character varying(128),
    risk_index_snapshot integer,
    approval_state character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    execution_state character varying(30) DEFAULT 'not_executed'::character varying NOT NULL,
    verification_state character varying(30) DEFAULT 'not_applicable'::character varying NOT NULL,
    source_record_id character varying(64),
    event_type character varying(30) NOT NULL,
    requested_by character varying(255),
    requested_by_name character varying(255),
    actor_id character varying(255),
    actor_name character varying(255),
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    intent_id character varying(64),
    intent_label character varying(128)
);


--
-- Name: action_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.action_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: action_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.action_ledger_id_seq OWNED BY public.action_ledger.id;


--
-- Name: adjustment_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adjustment_ledger (
    id integer NOT NULL,
    client_name character varying(256) NOT NULL,
    reference_type character varying(32) NOT NULL,
    reference_id character varying(64) NOT NULL,
    debit_usd real,
    credit_usd real,
    balance_after_usd real,
    description text,
    actor_name character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE adjustment_ledger; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.adjustment_ledger IS 'Immutable ledger of all credit/debit adjustments linked to credit notes, invoices, and disputes.';


--
-- Name: adjustment_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.adjustment_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: adjustment_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.adjustment_ledger_id_seq OWNED BY public.adjustment_ledger.id;


--
-- Name: ai_ops_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_ops_events (
    id integer NOT NULL,
    type text NOT NULL,
    severity character varying(16) NOT NULL,
    message text NOT NULL,
    entity text,
    value text,
    linked_exec_id text,
    source text DEFAULT 'execution'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    confidence real,
    signal_source character varying(32),
    dedupe_key character varying(128),
    classification character varying(32)
);


--
-- Name: ai_ops_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_ops_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_ops_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_ops_events_id_seq OWNED BY public.ai_ops_events.id;


--
-- Name: ai_ops_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_ops_incidents (
    id integer NOT NULL,
    title text NOT NULL,
    entity text,
    severity character varying(16) NOT NULL,
    start_time timestamp without time zone NOT NULL,
    last_seen timestamp without time zone NOT NULL,
    signals_count integer DEFAULT 0 NOT NULL,
    anomalies_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    narrative text,
    timeline_json text
);


--
-- Name: ai_ops_incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_ops_incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_ops_incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_ops_incidents_id_seq OWNED BY public.ai_ops_incidents.id;


--
-- Name: ai_revenue_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_revenue_alerts (
    id integer NOT NULL,
    alert_type character varying(64) NOT NULL,
    severity character varying(16) DEFAULT 'medium'::character varying NOT NULL,
    anomaly_score integer DEFAULT 0 NOT NULL,
    client_name character varying(256),
    vendor_name character varying(256),
    billing_period character varying(7),
    baseline_value real,
    current_value real,
    deviation_pct real,
    evidence jsonb,
    recommended_action text,
    status character varying(32) DEFAULT 'OPEN'::character varying NOT NULL,
    reviewed_by character varying(128),
    reviewed_at timestamp with time zone,
    resolved_at timestamp with time zone,
    dismissed_reason text,
    detected_on timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ai_revenue_alerts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ai_revenue_alerts IS 'Anomaly alerts produced by the AI Revenue Assurance engine. Advisory-only — no auto-actions.';


--
-- Name: ai_revenue_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_revenue_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_revenue_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_revenue_alerts_id_seq OWNED BY public.ai_revenue_alerts.id;


--
-- Name: ai_scan_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_scan_runs (
    id integer NOT NULL,
    triggered_by character varying(128),
    alerts_created integer DEFAULT 0 NOT NULL,
    detectors_ran integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    status character varying(32) DEFAULT 'running'::character varying NOT NULL,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: TABLE ai_scan_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ai_scan_runs IS 'Audit log of every assurance scan run, with alert counts and timing.';


--
-- Name: ai_scan_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_scan_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_scan_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_scan_runs_id_seq OWNED BY public.ai_scan_runs.id;


--
-- Name: alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_rules (
    id integer NOT NULL,
    metric character varying(64) NOT NULL,
    label character varying(128),
    threshold real NOT NULL,
    comparison character varying(10) DEFAULT 'lt'::character varying NOT NULL,
    carrier character varying(128),
    enabled boolean DEFAULT true,
    email_enabled boolean DEFAULT false,
    webhook_enabled boolean DEFAULT false,
    webhook_url character varying(512),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: alert_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alert_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_rules_id_seq OWNED BY public.alert_rules.id;


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id integer NOT NULL,
    type character varying(50) NOT NULL,
    severity character varying(20) NOT NULL,
    message text NOT NULL,
    resolved boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    acknowledged_at timestamp without time zone,
    acknowledged_by character varying(128),
    resolved_at timestamp without time zone,
    vendor character varying(128),
    connection character varying(128)
);


--
-- Name: alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alerts_id_seq OWNED BY public.alerts.id;


--
-- Name: anomaly_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anomaly_events (
    id integer NOT NULL,
    vendor character varying(128),
    metric character varying(32) NOT NULL,
    severity character varying(16) NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    root_cause text NOT NULL,
    recommendation text NOT NULL,
    affected_entities text[] DEFAULT '{}'::text[] NOT NULL,
    current_value real NOT NULL,
    baseline_mean real NOT NULL,
    baseline_stddev real NOT NULL,
    deviation_sigma real NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp without time zone,
    detected_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: anomaly_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.anomaly_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: anomaly_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.anomaly_events_id_seq OWNED BY public.anomaly_events.id;


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id integer NOT NULL,
    user_id character varying NOT NULL,
    name character varying(128) NOT NULL,
    key_hash character varying(64) NOT NULL,
    key_prefix character varying(12) NOT NULL,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;


--
-- Name: approval_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_audit_log (
    id integer NOT NULL,
    request_id integer NOT NULL,
    action character varying(32) NOT NULL,
    actor_id character varying(255) NOT NULL,
    actor_name character varying(128),
    actor_role character varying(32),
    note text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: approval_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.approval_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: approval_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.approval_audit_log_id_seq OWNED BY public.approval_audit_log.id;


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id integer NOT NULL,
    operation_type character varying(64) NOT NULL,
    action character varying(20) NOT NULL,
    entity_id character varying(64),
    entity_name character varying(255),
    payload_before json,
    payload_after json,
    requested_by character varying(255) NOT NULL,
    requested_by_name character varying(128),
    team_id character varying(64),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by character varying(255),
    reviewed_by_name character varying(128),
    reviewed_at timestamp without time zone,
    rejection_reason text,
    self_approval boolean DEFAULT false,
    requested_at timestamp without time zone DEFAULT now(),
    source character varying(32) DEFAULT 'manual'::character varying,
    rule_id integer,
    rollback_of integer,
    exec_result json
);


--
-- Name: approval_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.approval_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: approval_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.approval_requests_id_seq OWNED BY public.approval_requests.id;


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id integer NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    category character varying(32) NOT NULL,
    action character varying(64) NOT NULL,
    actor character varying(255) DEFAULT 'system'::character varying NOT NULL,
    actor_type character varying(16) DEFAULT 'system'::character varying NOT NULL,
    target_type character varying(32),
    target_id character varying(128),
    target_name character varying(255),
    severity character varying(16) DEFAULT 'info'::character varying NOT NULL,
    metadata json,
    ip character varying(64)
);


--
-- Name: audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_events_id_seq OWNED BY public.audit_events.id;


--
-- Name: balance_alert_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_alert_events (
    id integer NOT NULL,
    account_id character varying(32) NOT NULL,
    account_name character varying(128),
    threshold_usd real NOT NULL,
    severity character varying(16) NOT NULL,
    current_balance real NOT NULL,
    triggered_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone,
    checked_at timestamp without time zone DEFAULT now() NOT NULL,
    notification_sent_at timestamp without time zone
);


--
-- Name: balance_alert_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.balance_alert_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: balance_alert_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.balance_alert_events_id_seq OWNED BY public.balance_alert_events.id;


--
-- Name: balance_alert_notification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_alert_notification_settings (
    id integer NOT NULL,
    email_list text,
    webhook_url character varying(512),
    notify_on_warning boolean DEFAULT true NOT NULL,
    notify_on_urgent boolean DEFAULT true NOT NULL,
    notify_on_critical boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: balance_alert_notification_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.balance_alert_notification_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: balance_alert_notification_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.balance_alert_notification_settings_id_seq OWNED BY public.balance_alert_notification_settings.id;


--
-- Name: balance_alert_thresholds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_alert_thresholds (
    id integer NOT NULL,
    account_id character varying(32),
    account_name character varying(128),
    threshold_usd real NOT NULL,
    severity character varying(16) DEFAULT 'warning'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: balance_alert_thresholds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.balance_alert_thresholds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: balance_alert_thresholds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.balance_alert_thresholds_id_seq OWNED BY public.balance_alert_thresholds.id;


--
-- Name: bhaoo_balance_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bhaoo_balance_log (
    id integer NOT NULL,
    balance real NOT NULL,
    credit_limit real,
    currency character varying(8) DEFAULT 'USD'::character varying,
    checked_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bhaoo_balance_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bhaoo_balance_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bhaoo_balance_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bhaoo_balance_log_id_seq OWNED BY public.bhaoo_balance_log.id;


--
-- Name: bhaoo_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bhaoo_profiles (
    id integer NOT NULL,
    name character varying(64) NOT NULL,
    base_url character varying(256) DEFAULT 'http://149.20.185.6/BhaooSMSV5'::character varying NOT NULL,
    api_key character varying(128) NOT NULL,
    secret_key character varying(128) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bhaoo_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bhaoo_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bhaoo_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bhaoo_profiles_id_seq OWNED BY public.bhaoo_profiles.id;


--
-- Name: billing_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_disputes (
    id integer NOT NULL,
    vendor_name character varying(128) NOT NULL,
    period_start timestamp without time zone NOT NULL,
    period_end timestamp without time zone NOT NULL,
    our_amount real DEFAULT 0 NOT NULL,
    vendor_amount real DEFAULT 0 NOT NULL,
    discrepancy real DEFAULT 0 NOT NULL,
    currency character varying(8) DEFAULT 'USD'::character varying,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    resolution real,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_disputes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_disputes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_disputes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_disputes_id_seq OWNED BY public.billing_disputes.id;


--
-- Name: blacklist_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blacklist_rules (
    id integer NOT NULL,
    type character varying(20) NOT NULL,
    value character varying(64) NOT NULL,
    reason text,
    source character varying(32) DEFAULT 'manual'::character varying,
    active boolean DEFAULT true,
    hit_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: blacklist_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.blacklist_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: blacklist_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.blacklist_rules_id_seq OWNED BY public.blacklist_rules.id;


--
-- Name: branding_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branding_profiles (
    id integer NOT NULL,
    name text NOT NULL,
    company_name text NOT NULL,
    address_line1 text,
    address_line2 text,
    address_line3 text,
    email text,
    website text,
    logo_url text,
    bank_name text,
    bank_beneficiary text,
    bank_account_number text,
    bank_swift text,
    bank_currency text DEFAULT 'USD'::text,
    bank_address text,
    footer_note text,
    dispute_email text DEFAULT 'dispute@ichibaanlogic.com'::text,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: branding_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.branding_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: branding_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.branding_profiles_id_seq OWNED BY public.branding_profiles.id;


--
-- Name: call_governance_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_governance_log (
    id integer NOT NULL,
    governed_call_id integer,
    event_type character varying(64) NOT NULL,
    channel character varying(255),
    details text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: call_governance_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.call_governance_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: call_governance_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.call_governance_log_id_seq OWNED BY public.call_governance_log.id;


--
-- Name: call_governance_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_governance_rules (
    id integer NOT NULL,
    connection_name character varying(128) NOT NULL,
    channel_pattern character varying(255),
    cap_sec integer DEFAULT 120 NOT NULL,
    jitter_sec integer DEFAULT 15 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    action character varying(32) DEFAULT 'cap_and_replay'::character varying NOT NULL,
    scenario character varying(32) DEFAULT 'time_cap'::character varying NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    rule_name character varying(100),
    destination_prefix character varying(64),
    caller_prefix character varying(64)
);


--
-- Name: call_governance_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.call_governance_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: call_governance_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.call_governance_rules_id_seq OWNED BY public.call_governance_rules.id;


--
-- Name: call_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_snapshots (
    id integer NOT NULL,
    sippy_call_id character varying(255) NOT NULL,
    caller character varying(64),
    callee character varying(64),
    client_name character varying(128),
    vendor character varying(128),
    account_id character varying(32),
    i_customer character varying(32),
    i_environment character varying(32),
    direction character varying(32),
    codec character varying(32),
    cc_state character varying(32),
    max_duration_secs real DEFAULT 0,
    pdd_ms integer DEFAULT 0,
    media_ip_caller character varying(64),
    media_ip_callee character varying(64),
    connection character varying(255),
    first_seen timestamp without time zone DEFAULT now(),
    last_seen timestamp without time zone DEFAULT now()
);


--
-- Name: call_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.call_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: call_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.call_snapshots_id_seq OWNED BY public.call_snapshots.id;


--
-- Name: call_test_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_test_logs (
    id integer NOT NULL,
    user_id character varying NOT NULL,
    cli character varying(64) NOT NULL,
    cld character varying(64) NOT NULL,
    i_account integer,
    call_id character varying(128),
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    message text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: call_test_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.call_test_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: call_test_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.call_test_logs_id_seq OWNED BY public.call_test_logs.id;


--
-- Name: calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calls (
    id integer NOT NULL,
    caller character varying(50) NOT NULL,
    callee character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    start_time timestamp without time zone DEFAULT now(),
    end_time timestamp without time zone,
    direction character varying(10) DEFAULT 'inbound'::character varying,
    pdd real,
    fail_reason character varying(30),
    origin_country character varying(64),
    term_country character varying(64),
    trunk_class character varying(20),
    sip_code integer,
    billable_secs integer,
    fas_flag boolean DEFAULT false,
    callback_flag boolean DEFAULT false
);


--
-- Name: calls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: calls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calls_id_seq OWNED BY public.calls.id;


--
-- Name: canonical_vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canonical_vendors (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    vendor_prefix character varying(4) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: canonical_vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.canonical_vendors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: canonical_vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.canonical_vendors_id_seq OWNED BY public.canonical_vendors.id;


--
-- Name: cap_alert_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cap_alert_events (
    id integer NOT NULL,
    account_id character varying(64) NOT NULL,
    account_name text,
    cap_type character varying(32) NOT NULL,
    utilisation_pct integer NOT NULL,
    current_value integer NOT NULL,
    limit_value integer NOT NULL,
    severity character varying(16) NOT NULL,
    triggered_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone
);


--
-- Name: cap_alert_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cap_alert_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cap_alert_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cap_alert_events_id_seq OWNED BY public.cap_alert_events.id;


--
-- Name: carrier_quality_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carrier_quality_scores (
    id integer NOT NULL,
    carrier_id character varying(64) NOT NULL,
    carrier_name character varying(128) NOT NULL,
    window_hours integer DEFAULT 24 NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    connected_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    rolling_asr real,
    avg_pdd_ms real,
    p95_pdd_ms real,
    failure_rate real,
    stability_score real,
    trend character varying(16),
    last_computed_at timestamp without time zone DEFAULT now() NOT NULL,
    avg_acd_secs real
);


--
-- Name: carrier_quality_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.carrier_quality_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: carrier_quality_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.carrier_quality_scores_id_seq OWNED BY public.carrier_quality_scores.id;


--
-- Name: carrier_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carrier_reconciliations (
    id integer NOT NULL,
    carrier_name character varying(256) NOT NULL,
    i_tariff character varying(64),
    invoice_ref character varying(128),
    invoice_date character varying(32),
    period_start character varying(32),
    period_end character varying(32),
    carrier_total real,
    sippy_total real,
    reproduced_total real,
    snapshot_total real,
    delta_carrier_vs_reproduced real,
    delta_carrier_vs_sippy real,
    discrepancy_count integer DEFAULT 0,
    status character varying(32) DEFAULT 'shadow'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE carrier_reconciliations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.carrier_reconciliations IS 'Layer 5C: Carrier invoice vs BitsAuto reproduced cost comparison. Shadow verification mode — discrepancy intelligence only, no automatic accounting actions.';


--
-- Name: COLUMN carrier_reconciliations.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.carrier_reconciliations.status IS 'shadow | pending | reviewed | resolved | disputed';


--
-- Name: carrier_reconciliations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.carrier_reconciliations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: carrier_reconciliations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.carrier_reconciliations_id_seq OWNED BY public.carrier_reconciliations.id;


--
-- Name: cdr_anomaly_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cdr_anomaly_batches (
    id integer NOT NULL,
    run_date character varying(12) NOT NULL,
    account character varying(128) NOT NULL,
    metric character varying(32) NOT NULL,
    baseline real NOT NULL,
    observed real NOT NULL,
    deviation_sigma real NOT NULL,
    severity character varying(16) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: cdr_anomaly_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cdr_anomaly_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cdr_anomaly_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cdr_anomaly_batches_id_seq OWNED BY public.cdr_anomaly_batches.id;


--
-- Name: cdr_recon_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cdr_recon_rows (
    id integer NOT NULL,
    session_id integer NOT NULL,
    cli character varying(100),
    cld character varying(100),
    start_time timestamp with time zone,
    their_duration integer,
    our_duration integer,
    delta integer,
    their_cost numeric(14,6),
    our_cost numeric(14,6),
    match_status character varying(30) NOT NULL,
    sippy_call_id character varying(100)
);


--
-- Name: cdr_recon_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cdr_recon_rows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cdr_recon_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cdr_recon_rows_id_seq OWNED BY public.cdr_recon_rows.id;


--
-- Name: cdr_recon_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cdr_recon_sessions (
    id integer NOT NULL,
    session_type character varying(10) NOT NULL,
    party_name character varying(255) NOT NULL,
    billing_period character varying(20) NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now(),
    total_rows integer DEFAULT 0,
    matched integer DEFAULT 0,
    duration_mismatch integer DEFAULT 0,
    missing_ours integer DEFAULT 0,
    extra_ours integer DEFAULT 0,
    notes text,
    CONSTRAINT cdr_recon_sessions_session_type_check CHECK (((session_type)::text = ANY ((ARRAY['vendor'::character varying, 'client'::character varying])::text[])))
);


--
-- Name: cdr_recon_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cdr_recon_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cdr_recon_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cdr_recon_sessions_id_seq OWNED BY public.cdr_recon_sessions.id;


--
-- Name: cdr_rerate_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cdr_rerate_runs (
    id integer NOT NULL,
    name character varying(256) NOT NULL,
    mode character varying(32) DEFAULT 'flat_rate'::character varying NOT NULL,
    from_date character varying(32) NOT NULL,
    to_date character varying(32) NOT NULL,
    i_tariff_filter character varying(64),
    flat_rate_per_min real,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    snapshot_count integer DEFAULT 0,
    original_cost real DEFAULT 0,
    rerated_cost real DEFAULT 0,
    delta real DEFAULT 0,
    savings_pct real DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone
);


--
-- Name: cdr_rerate_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cdr_rerate_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cdr_rerate_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cdr_rerate_runs_id_seq OWNED BY public.cdr_rerate_runs.id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    room_id integer NOT NULL,
    sender_id character varying(255) NOT NULL,
    sender_name character varying(128) NOT NULL,
    sender_role character varying(32) DEFAULT 'viewer'::character varying NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chat_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_rooms (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    type character varying(16) DEFAULT 'group'::character varying NOT NULL,
    slug character varying(128) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: chat_rooms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_rooms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_rooms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_rooms_id_seq OWNED BY public.chat_rooms.id;


--
-- Name: client_branding_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_branding_profiles (
    id integer NOT NULL,
    client_name character varying(256),
    company_name character varying(256),
    logo_url text,
    primary_color character varying(7),
    secondary_color character varying(7),
    banking_details text,
    bank_name character varying(256),
    account_number character varying(128),
    iban character varying(64),
    swift character varying(16),
    payment_terms_days integer DEFAULT 30 NOT NULL,
    payment_instructions text,
    invoice_footer_text text,
    tax_id character varying(64),
    address_line1 character varying(256),
    address_line2 character varying(256),
    city character varying(128),
    country character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE client_branding_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_branding_profiles IS 'Client branding and banking profiles for invoice rendering. Includes logo, colors, banking details, and payment terms.';


--
-- Name: client_branding_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_branding_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_branding_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_branding_profiles_id_seq OWNED BY public.client_branding_profiles.id;


--
-- Name: client_identity_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_identity_map (
    id integer NOT NULL,
    i_account integer,
    sippy_username character varying(255),
    billing_name character varying(255),
    display_name character varying(255),
    crm_name character varying(255),
    portal_name character varying(255),
    external_ref character varying(255),
    account_manager_id character varying(255),
    finance_owner_id character varying(255),
    risk_tier character varying(20) DEFAULT 'standard'::character varying,
    notes text,
    active boolean DEFAULT true NOT NULL,
    last_synced_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    i_tariff character varying(64)
);


--
-- Name: client_identity_map_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_identity_map_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_identity_map_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_identity_map_id_seq OWNED BY public.client_identity_map.id;


--
-- Name: client_ip_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_ip_requests (
    id integer NOT NULL,
    company_id integer,
    client_name character varying(256) NOT NULL,
    ip_address character varying(64) NOT NULL,
    trunk character varying(128),
    description text,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    submitted_by character varying(255),
    reviewed_by character varying(255),
    rejection_reason text,
    submitted_at timestamp without time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp without time zone
);


--
-- Name: client_ip_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_ip_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_ip_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_ip_requests_id_seq OWNED BY public.client_ip_requests.id;


--
-- Name: client_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_profiles (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    type character varying(10) DEFAULT 'client'::character varying NOT NULL,
    prefix character varying(50),
    rate_per_min real DEFAULT 0.025,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    ip_address character varying(45),
    rate_effective_from timestamp without time zone,
    rate_effective_to timestamp without time zone,
    switch_sync_status json,
    max_sessions integer,
    max_calls_per_second integer,
    max_session_time integer,
    credit_limit real,
    routing_group character varying(128),
    preferred_codec character varying(32),
    cld_translation_rule character varying(128),
    cli_translation_rule character varying(128),
    service_plan character varying(128),
    sip_class character varying(128),
    timezone character varying(64) DEFAULT 'Etc/UTC'::character varying,
    language character varying(32) DEFAULT 'English'::character varying,
    company_name character varying(128),
    alert_email character varying(255),
    cost_per_min real,
    revenue_per_min real
);


--
-- Name: client_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_profiles_id_seq OWNED BY public.client_profiles.id;


--
-- Name: client_revenue_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_revenue_reconciliations (
    id integer NOT NULL,
    billing_period character varying(7) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    parent_id integer,
    client_account_id character varying(64),
    client_name character varying(256) NOT NULL,
    client_duration_sec real,
    client_amount_usd real,
    client_calls integer,
    bitsauto_duration_sec real,
    bitsauto_amount_usd real,
    bitsauto_calls integer,
    dmr_duration_sec real,
    dmr_amount_usd real,
    delta_duration_sec real,
    delta_amount_usd real,
    delta_pct real,
    discrepancy_type character varying(32) DEFAULT 'no_client_data'::character varying NOT NULL,
    severity character varying(16) DEFAULT 'clean'::character varying NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    invoice_id integer,
    source character varying(32) DEFAULT 'manual'::character varying NOT NULL,
    raw_import jsonb,
    notes text,
    reviewed_by character varying(128),
    reviewed_at timestamp with time zone,
    reconciled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE client_revenue_reconciliations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_revenue_reconciliations IS 'Customer-side revenue reconciliation. Compares client-submitted billing data against BitsAuto invoice and DMR operational truth. Append-only version pattern — recalculate creates a new version row, never overwrites history. Completes bilateral telecom finance triangulation: vendor-us-customer.';


--
-- Name: client_revenue_reconciliations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_revenue_reconciliations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_revenue_reconciliations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_revenue_reconciliations_id_seq OWNED BY public.client_revenue_reconciliations.id;


--
-- Name: collection_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_events (
    id integer NOT NULL,
    client_name character varying(256) NOT NULL,
    client_id character varying(128),
    event_type character varying(32) NOT NULL,
    outstanding_amount_usd real,
    threshold_breached character varying(32),
    action_taken text,
    resolved_at timestamp with time zone,
    actor_name character varying(128),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE collection_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.collection_events IS 'Immutable timeline of all credit control and collection actions per client.';


--
-- Name: collection_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.collection_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: collection_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.collection_events_id_seq OWNED BY public.collection_events.id;


--
-- Name: commercial_notification_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_notification_recipients (
    id integer NOT NULL,
    notification_id integer NOT NULL,
    company_id integer,
    email character varying(256) NOT NULL,
    recipient_name character varying(256),
    delivery_status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    sent_at timestamp without time zone,
    failed_reason character varying(512),
    tracking_token character varying(64) DEFAULT (gen_random_uuid())::text,
    opened_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    open_count integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN commercial_notification_recipients.tracking_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_notification_recipients.tracking_token IS 'UUID token embedded in tracking pixel URL. Unique per recipient row.';


--
-- Name: COLUMN commercial_notification_recipients.opened_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_notification_recipients.opened_at IS 'Timestamp of first email open (via 1x1 tracking pixel hit).';


--
-- Name: COLUMN commercial_notification_recipients.acknowledged_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_notification_recipients.acknowledged_at IS 'Timestamp of explicit acknowledgement by recipient (via acknowledge endpoint).';


--
-- Name: COLUMN commercial_notification_recipients.open_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_notification_recipients.open_count IS 'Total number of times the tracking pixel was loaded.';


--
-- Name: commercial_notification_recipients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commercial_notification_recipients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commercial_notification_recipients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commercial_notification_recipients_id_seq OWNED BY public.commercial_notification_recipients.id;


--
-- Name: commercial_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_notifications (
    id integer NOT NULL,
    type character varying(64) NOT NULL,
    destination character varying(128),
    prefix character varying(32),
    old_value character varying(128),
    new_value character varying(128),
    effective_date character varying(32),
    subject character varying(512) NOT NULL,
    body text NOT NULL,
    audience_type character varying(64) DEFAULT 'all_clients'::character varying NOT NULL,
    created_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    sent_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    dispatched_at timestamp without time zone,
    sender_profile_id integer,
    tariff_change_event_id integer,
    policy_id integer
);


--
-- Name: COLUMN commercial_notifications.tariff_change_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_notifications.tariff_change_event_id IS 'Links draft notification to the specific tariff_change_event that triggered it — end-to-end economics→communication traceability.';


--
-- Name: COLUMN commercial_notifications.policy_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commercial_notifications.policy_id IS 'Links draft notification to the communication_policy rule that auto-created it.';


--
-- Name: commercial_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commercial_notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commercial_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commercial_notifications_id_seq OWNED BY public.commercial_notifications.id;


--
-- Name: communication_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_policies (
    id integer NOT NULL,
    trigger_type character varying(64) NOT NULL,
    severity_filter character varying(32) DEFAULT 'all'::character varying NOT NULL,
    sender_profile_id integer,
    template_type character varying(64),
    recipient_group character varying(64) DEFAULT 'all_clients'::character varying NOT NULL,
    channel_type character varying(32) DEFAULT 'email'::character varying NOT NULL,
    auto_draft boolean DEFAULT true NOT NULL,
    cooldown_minutes integer DEFAULT 0 NOT NULL,
    approval_required boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE communication_policies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_policies IS 'Event-to-draft-notification routing rules. When a telecom economics event fires, matching enabled policies auto-create draft commercial notifications for human review.';


--
-- Name: COLUMN communication_policies.trigger_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_policies.trigger_type IS 'rate_change | interval_change | tariff_added | tariff_removed | invoice_generated | reconciliation_drift | qos_advisory | fraud_advisory | executive_report';


--
-- Name: COLUMN communication_policies.severity_filter; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_policies.severity_filter IS 'all | minor | major | critical — only triggers when event matches this severity';


--
-- Name: COLUMN communication_policies.recipient_group; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_policies.recipient_group IS 'all_clients | management | finance | noc | internal_team';


--
-- Name: COLUMN communication_policies.auto_draft; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_policies.auto_draft IS 'Always TRUE on first deploy — policies create draft notifications only. Human must review and dispatch.';


--
-- Name: communication_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.communication_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: communication_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.communication_policies_id_seq OWNED BY public.communication_policies.id;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id integer NOT NULL,
    name character varying(256) NOT NULL,
    short_code character varying(32) NOT NULL,
    country character varying(64),
    kam character varying(128),
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    company_type character varying(32) DEFAULT 'retail'::character varying NOT NULL,
    contract_type character varying(32) DEFAULT 'bilateral'::character varying NOT NULL,
    department character varying(64),
    team character varying(64),
    client_timezone character varying(64),
    vendor_timezone character varying(64),
    currency character varying(8) DEFAULT 'USD'::character varying NOT NULL,
    vendor_billing_cycle character varying(32) DEFAULT 'weekly_cutoff'::character varying,
    vendor_grace_period integer DEFAULT 3,
    vendor_credit_limit real DEFAULT 0,
    dispute_over_pct real DEFAULT 0,
    client_billing_cycle character varying(32) DEFAULT 'weekly_cutoff'::character varying,
    client_grace_period integer DEFAULT 3,
    client_credit_limit real DEFAULT 0,
    dispute_over_val real DEFAULT 0,
    payment_term character varying(32) DEFAULT 'prepaid'::character varying,
    legal_name_ci character varying(256),
    legal_name_ven character varying(256),
    invoice_email character varying(256),
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by character varying(255),
    provisioning_status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    provisioned_at timestamp without time zone,
    provisioned_by character varying(255),
    sippy_i_account integer,
    wizard_draft text,
    sippy_i_tariff integer
);


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: company_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_bank_accounts (
    id integer NOT NULL,
    company_id integer NOT NULL,
    bank_name character varying(256) NOT NULL,
    account_title character varying(256) NOT NULL,
    account_no character varying(128) NOT NULL,
    iban character varying(64),
    swift_code character varying(32) NOT NULL,
    currency character varying(8) DEFAULT 'USD'::character varying NOT NULL,
    country character varying(64) NOT NULL,
    address text,
    remarks text,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL
);


--
-- Name: company_bank_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_bank_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_bank_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_bank_accounts_id_seq OWNED BY public.company_bank_accounts.id;


--
-- Name: company_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_contacts (
    id integer NOT NULL,
    company_id integer NOT NULL,
    contact_type character varying(32) NOT NULL,
    first_name character varying(128) NOT NULL,
    last_name character varying(128),
    email character varying(256) NOT NULL,
    phone character varying(64),
    fax character varying(64)
);


--
-- Name: company_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_contacts_id_seq OWNED BY public.company_contacts.id;


--
-- Name: concurrent_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concurrent_snapshots (
    id integer NOT NULL,
    dim character varying(32) NOT NULL,
    entity_name character varying(256) NOT NULL,
    ts bigint NOT NULL,
    active integer DEFAULT 0 NOT NULL,
    connected integer DEFAULT 0 NOT NULL,
    routing integer DEFAULT 0 NOT NULL
);


--
-- Name: concurrent_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.concurrent_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: concurrent_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.concurrent_snapshots_id_seq OWNED BY public.concurrent_snapshots.id;


--
-- Name: connection_vendor_cache2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connection_vendor_cache2 (
    id integer NOT NULL,
    i_connection integer NOT NULL,
    name character varying(255) NOT NULL,
    i_vendor integer,
    vendor_name character varying(255),
    host character varying(255),
    protocol character varying(32),
    blocked boolean DEFAULT false,
    raw_json text,
    cached_at timestamp without time zone DEFAULT now()
);


--
-- Name: connection_vendor_cache2_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.connection_vendor_cache2_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: connection_vendor_cache2_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.connection_vendor_cache2_id_seq OWNED BY public.connection_vendor_cache2.id;


--
-- Name: console_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.console_incidents (
    id integer NOT NULL,
    entity_key character varying(255) NOT NULL,
    entity_label character varying(255) NOT NULL,
    window_hash character varying(64) NOT NULL,
    severity character varying(16) NOT NULL,
    state character varying(24) DEFAULT 'active'::character varying NOT NULL,
    title character varying(500) NOT NULL,
    alerts_json text DEFAULT '[]'::text NOT NULL,
    root_cause_json text,
    timeline_json text DEFAULT '[]'::text NOT NULL,
    actions_json text DEFAULT '[]'::text NOT NULL,
    metrics_json text,
    estimated_impact_per_hr real,
    linked_ticket_id integer,
    started_at timestamp without time zone NOT NULL,
    last_seen_at timestamp without time zone NOT NULL,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    acknowledged_by character varying(128),
    acknowledged_at timestamp without time zone,
    acknowledge_note text,
    resolved_by character varying(128),
    resolution_note text,
    assigned_to character varying(128),
    assignment_history_json text DEFAULT '[]'::text NOT NULL
);


--
-- Name: console_incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.console_incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: console_incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.console_incidents_id_seq OWNED BY public.console_incidents.id;


--
-- Name: copilot_503_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.copilot_503_settings (
    id integer DEFAULT 1 NOT NULL,
    threshold_pct real DEFAULT 15 NOT NULL,
    sustain_windows integer DEFAULT 2 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: copilot_result_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.copilot_result_cache (
    id integer NOT NULL,
    result jsonb NOT NULL,
    generated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: copilot_result_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.copilot_result_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: copilot_result_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.copilot_result_cache_id_seq OWNED BY public.copilot_result_cache.id;


--
-- Name: credit_control_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_control_rules (
    id integer NOT NULL,
    client_name character varying(256),
    client_id character varying(128),
    is_global boolean DEFAULT false NOT NULL,
    warning_threshold_usd real,
    suspend_threshold_usd real,
    grace_period_days integer DEFAULT 3 NOT NULL,
    auto_suspend boolean DEFAULT false NOT NULL,
    notify_on_warning boolean DEFAULT true NOT NULL,
    credit_limit_usd real,
    risk_score integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE credit_control_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.credit_control_rules IS 'Per-client or global credit threshold configuration. Controls warning/suspend thresholds, grace periods, and auto-suspend behavior.';


--
-- Name: credit_control_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credit_control_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credit_control_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.credit_control_rules_id_seq OWNED BY public.credit_control_rules.id;


--
-- Name: credit_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_notes (
    id integer NOT NULL,
    reference_id character varying(32) NOT NULL,
    credit_type character varying(32) NOT NULL,
    client_name character varying(256) NOT NULL,
    client_id character varying(128),
    invoice_id integer,
    dispute_case_id integer,
    billing_period character varying(7),
    amount_usd real NOT NULL,
    applied_amount_usd real,
    reason character varying(512) NOT NULL,
    description text,
    status character varying(32) DEFAULT 'DRAFT'::character varying NOT NULL,
    approved_by character varying(128),
    approved_at timestamp with time zone,
    applied_at timestamp with time zone,
    voided_at timestamp with time zone,
    voided_reason text,
    created_by character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE credit_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.credit_notes IS 'Formal credit adjustments (partial, full, write-off, carry-forward) against invoices. Governed lifecycle: DRAFT → APPROVED → APPLIED | VOID.';


--
-- Name: credit_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credit_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credit_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.credit_notes_id_seq OWNED BY public.credit_notes.id;


--
-- Name: customer_product_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_product_assignments (
    id integer NOT NULL,
    product_id integer NOT NULL,
    i_account integer NOT NULL,
    customer_name character varying(256),
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by character varying(128)
);


--
-- Name: customer_product_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_product_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_product_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_product_assignments_id_seq OWNED BY public.customer_product_assignments.id;


--
-- Name: daily_minutes_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_minutes_reports (
    id integer NOT NULL,
    report_date date NOT NULL,
    dmr_version integer DEFAULT 1 NOT NULL,
    parent_dmr_id integer,
    account_id character varying(64),
    account_name character varying(256),
    vendor_id character varying(64),
    vendor_name character varying(256),
    destination character varying(256),
    prefix character varying(32),
    sippy_duration real,
    sippy_amount real,
    sippy_calls integer,
    platform_duration real,
    platform_amount real,
    platform_calls integer,
    buy_amount real,
    sell_amount real,
    margin_amount real,
    margin_pct real,
    drift_duration real,
    drift_amount real,
    total_calls integer,
    asr real,
    acd real,
    pdd real,
    tariff_version_id integer,
    discrepancy_type character varying(32) DEFAULT 'exact_match'::character varying NOT NULL,
    verification_status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    source character varying(32) DEFAULT 'daily_summary'::character varying NOT NULL,
    notes text,
    recalculated_at timestamp with time zone,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    window_start_gmt timestamp without time zone,
    window_end_gmt timestamp without time zone,
    timezone character varying(8) DEFAULT 'UTC'::character varying NOT NULL
);


--
-- Name: TABLE daily_minutes_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_minutes_reports IS 'Daily telecom operational economics. Append-only — recalculation creates new dmr_version rows. Never silently mutates historical economics. Used for revenue assurance, drift detection, and invoice confidence validation.';


--
-- Name: daily_minutes_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_minutes_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_minutes_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_minutes_reports_id_seq OWNED BY public.daily_minutes_reports.id;


--
-- Name: dashboard_widget_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_widget_prefs (
    user_id character varying NOT NULL,
    hidden_widgets text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    widget_order text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: data_retention_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_retention_policy (
    id integer NOT NULL,
    data_type character varying(64) NOT NULL,
    label character varying(128) NOT NULL,
    retention_days integer DEFAULT 90 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_purged_at timestamp without time zone,
    purged_count integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: data_retention_policy_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.data_retention_policy_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: data_retention_policy_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.data_retention_policy_id_seq OWNED BY public.data_retention_policy.id;


--
-- Name: deal_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_approvals (
    id integer NOT NULL,
    deal_id integer NOT NULL,
    action character varying(32) NOT NULL,
    performed_by character varying(128),
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deal_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deal_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deal_approvals_id_seq OWNED BY public.deal_approvals.id;


--
-- Name: deal_destinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_destinations (
    id integer NOT NULL,
    deal_id integer NOT NULL,
    destination_id integer,
    destination_name character varying(256),
    offer_rate numeric(10,6),
    cost_rate numeric(10,6),
    volume_split_pct numeric(8,4),
    premium_pct numeric(8,4) DEFAULT 50,
    standard_pct numeric(8,4) DEFAULT 50,
    premium_rate numeric(10,6),
    standard_rate numeric(10,6),
    notes text
);


--
-- Name: deal_destinations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deal_destinations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deal_destinations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deal_destinations_id_seq OWNED BY public.deal_destinations.id;


--
-- Name: deal_workspace; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_workspace (
    id integer NOT NULL,
    deal_name text NOT NULL,
    customer_name text,
    destination text,
    product_code text,
    requested_rate numeric(10,6),
    offered_rate numeric(10,6),
    approved_rate numeric(10,6),
    status text DEFAULT 'new'::text NOT NULL,
    notes text,
    created_by text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_workspace_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deal_workspace_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deal_workspace_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deal_workspace_id_seq OWNED BY public.deal_workspace.id;


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals (
    id integer NOT NULL,
    deal_ref character varying(64) NOT NULL,
    i_account integer NOT NULL,
    customer_name character varying(256),
    product_id integer NOT NULL,
    kam_name character varying(128),
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    start_date date,
    end_date date,
    grace_period_days integer DEFAULT 0,
    volume_commitment numeric(15,2),
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by character varying(128),
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deal_type character varying(32) DEFAULT 'traffic_mix'::character varying
);


--
-- Name: deals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deals_id_seq OWNED BY public.deals.id;


--
-- Name: deletion_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_requests (
    id integer NOT NULL,
    requested_by character varying(128) NOT NULL,
    data_subject character varying(255) NOT NULL,
    data_type character varying(64) NOT NULL,
    reason text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    requested_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    executed_by character varying(128),
    records_deleted integer DEFAULT 0,
    audit_note text
);


--
-- Name: deletion_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deletion_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deletion_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deletion_requests_id_seq OWNED BY public.deletion_requests.id;


--
-- Name: destination_product_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.destination_product_rates (
    id integer NOT NULL,
    destination_id integer,
    product_prefix character varying(16) NOT NULL,
    dial_prefix character varying(32),
    destination_name character varying(256),
    buy_rate numeric(10,6),
    sell_rate numeric(10,6),
    currency character varying(8) DEFAULT 'USD'::character varying,
    approval_status character varying(32) DEFAULT 'pending'::character varying,
    approved_by character varying(128),
    approved_at timestamp without time zone,
    source character varying(64) DEFAULT 'manual'::character varying,
    source_file character varying(256),
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    product_code character varying(4),
    interval_1 integer DEFAULT 1,
    interval_n integer DEFAULT 1,
    price_status character varying(32),
    cli_enabled boolean DEFAULT true,
    activation_date timestamp with time zone,
    expiration_date timestamp with time zone
);


--
-- Name: destination_product_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.destination_product_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: destination_product_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.destination_product_rates_id_seq OWNED BY public.destination_product_rates.id;


--
-- Name: destination_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.destination_rates (
    id integer NOT NULL,
    destination_name text NOT NULL,
    dial_prefix text NOT NULL,
    product_code text NOT NULL,
    buy_rate numeric(10,6),
    sell_rate numeric(10,6),
    approval_status text DEFAULT 'pending'::text NOT NULL,
    approved_by text,
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: destination_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.destination_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: destination_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.destination_rates_id_seq OWNED BY public.destination_rates.id;


--
-- Name: destination_sets_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.destination_sets_cache (
    id integer NOT NULL,
    i_destination_set integer NOT NULL,
    name character varying(255) NOT NULL,
    route_count integer DEFAULT 0,
    cld_translation character varying(255),
    cli_translation character varying(255),
    raw_json text,
    cached_at timestamp without time zone DEFAULT now()
);


--
-- Name: destination_sets_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.destination_sets_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: destination_sets_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.destination_sets_cache_id_seq OWNED BY public.destination_sets_cache.id;


--
-- Name: dispute_case_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_case_events (
    id integer NOT NULL,
    case_id integer NOT NULL,
    event_type character varying(32) NOT NULL,
    from_status character varying(32),
    to_status character varying(32),
    message text,
    actor_name character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE dispute_case_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dispute_case_events IS 'Immutable event timeline for dispute cases. Every status change, note, and assignment is appended here.';


--
-- Name: dispute_case_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispute_case_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispute_case_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispute_case_events_id_seq OWNED BY public.dispute_case_events.id;


--
-- Name: dispute_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_cases (
    id integer NOT NULL,
    reference_id character varying(32) NOT NULL,
    dispute_type character varying(32) NOT NULL,
    client_id character varying(128),
    client_name character varying(256) NOT NULL,
    billing_period character varying(7),
    invoice_id integer,
    reconciliation_id integer,
    assigned_to character varying(128),
    severity character varying(16) DEFAULT 'medium'::character varying NOT NULL,
    status character varying(32) DEFAULT 'OPEN'::character varying NOT NULL,
    disputed_amount real,
    resolved_amount real,
    description text,
    internal_notes text,
    sla_hours integer DEFAULT 72 NOT NULL,
    sla_due_at timestamp with time zone,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE dispute_cases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dispute_cases IS 'Formal dispute lifecycle management. Each row is a governed case with SLA tracking, assignment, and linked finance evidence (invoice, reconciliation).';


--
-- Name: dispute_cases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispute_cases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispute_cases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispute_cases_id_seq OWNED BY public.dispute_cases.id;


--
-- Name: entity_presence_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_presence_registry (
    id integer NOT NULL,
    dim character varying(32) NOT NULL,
    entity_name character varying(256) NOT NULL,
    last_seen bigint DEFAULT 0 NOT NULL,
    first_seen bigint DEFAULT 0 NOT NULL,
    peak_today integer DEFAULT 0 NOT NULL,
    peak_ts bigint DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: entity_presence_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.entity_presence_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: entity_presence_registry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.entity_presence_registry_id_seq OWNED BY public.entity_presence_registry.id;


--
-- Name: execution_health_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_health_log (
    id integer NOT NULL,
    campaign_id integer,
    run_id integer,
    cld character varying(64),
    cli character varying(64),
    error_type character varying(32),
    error_message text,
    attempt_count integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: execution_health_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.execution_health_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: execution_health_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.execution_health_log_id_seq OWNED BY public.execution_health_log.id;


--
-- Name: failover_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failover_executions (
    id integer NOT NULL,
    policy_id integer NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    from_carrier character varying(256) NOT NULL,
    to_carrier character varying(256) NOT NULL,
    shift_percent integer NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    executed_by character varying(128) NOT NULL,
    rollback_at timestamp with time zone,
    rolled_back_at timestamp with time zone,
    rolled_back_by character varying(128),
    audit_log jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: failover_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.failover_executions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: failover_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.failover_executions_id_seq OWNED BY public.failover_executions.id;


--
-- Name: fas_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fas_events (
    id integer NOT NULL,
    call_id character varying(64) NOT NULL,
    caller character varying(64),
    callee character varying(64),
    vendor character varying(128),
    pdd_secs real,
    bill_secs integer,
    sip_code integer,
    reason character varying(255),
    detected_at timestamp without time zone DEFAULT now(),
    alert_sent boolean DEFAULT false,
    fraud_score real,
    client_name character varying(128)
);


--
-- Name: fas_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fas_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fas_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fas_events_id_seq OWNED BY public.fas_events.id;


--
-- Name: fas_vendor_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fas_vendor_settings (
    vendor character varying(255) NOT NULL,
    suppressed boolean DEFAULT false NOT NULL,
    alert_threshold integer DEFAULT 30,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: fix_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fix_history (
    id integer NOT NULL,
    page character varying(200),
    issue_type character varying(50) NOT NULL,
    component character varying(100),
    fix_action character varying(100),
    outcome character varying(20) NOT NULL,
    outcome_message text,
    triggered_by character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    performed_by character varying(200),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    screenshot text
);


--
-- Name: fix_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fix_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fix_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fix_history_id_seq OWNED BY public.fix_history.id;


--
-- Name: global_destinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.global_destinations (
    id integer NOT NULL,
    parent_id integer,
    level integer DEFAULT 1 NOT NULL,
    name character varying(128) NOT NULL,
    country_code character varying(4),
    dial_prefix character varying(32),
    operator_name character varying(128),
    commercial_status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    notes text,
    blocked_reason character varying(256)
);


--
-- Name: global_destinations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.global_destinations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: global_destinations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.global_destinations_id_seq OWNED BY public.global_destinations.id;


--
-- Name: governed_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.governed_calls (
    id integer NOT NULL,
    unique_id character varying(128),
    channel_a character varying(255),
    channel_b character varying(255),
    caller character varying(64),
    callee character varying(64),
    connection_name character varying(128),
    rule_id integer,
    cap_sec integer,
    start_time timestamp without time zone DEFAULT now(),
    bye_sent_at timestamp without time zone,
    playback_started_at timestamp without time zone,
    completed_at timestamp without time zone,
    recording_path character varying(512),
    trigger_reason character varying(64),
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    cdr_status character varying(32),
    cdr_caller character varying(64),
    cdr_callee character varying(64),
    cdr_duration integer,
    cdr_cost numeric(12,6),
    cdr_vendor_cost numeric(12,6),
    cdr_vendor_name character varying(128),
    cdr_checked_at timestamp without time zone,
    vendor_call_id character varying(256),
    vendor_ip character varying(64)
);


--
-- Name: governed_calls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.governed_calls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: governed_calls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.governed_calls_id_seq OWNED BY public.governed_calls.id;


--
-- Name: host_outage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.host_outage_log (
    id integer NOT NULL,
    host_id integer NOT NULL,
    host_label character varying(128),
    host_ip character varying(128),
    down_at timestamp without time zone NOT NULL,
    recovered_at timestamp without time zone,
    duration_sec integer,
    cause character varying(128),
    checked_at timestamp without time zone DEFAULT now()
);


--
-- Name: host_outage_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.host_outage_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: host_outage_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.host_outage_log_id_seq OWNED BY public.host_outage_log.id;


--
-- Name: incident_lifecycle_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_lifecycle_events (
    id integer NOT NULL,
    incident_id integer NOT NULL,
    from_state character varying(24),
    to_state character varying(24) NOT NULL,
    actor character varying(128),
    note text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: incident_lifecycle_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.incident_lifecycle_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incident_lifecycle_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.incident_lifecycle_events_id_seq OWNED BY public.incident_lifecycle_events.id;


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incidents (
    id integer NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id character varying(128) NOT NULL,
    entity_name character varying(255),
    incident_type character varying(64) NOT NULL,
    severity character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    confidence integer DEFAULT 70 NOT NULL,
    title text NOT NULL,
    summary text,
    reasons json DEFAULT '[]'::json,
    suggested_action text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    source character varying(64) NOT NULL,
    opened_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone
);


--
-- Name: incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.incidents_id_seq OWNED BY public.incidents.id;


--
-- Name: intelligent_failover_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligent_failover_policies (
    id integer NOT NULL,
    route_group_id character varying(128),
    destination_prefix character varying(32),
    label character varying(128) NOT NULL,
    route_class character varying(32) DEFAULT 'STANDARD'::character varying NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    minimum_asr real DEFAULT 38 NOT NULL,
    maximum_fas real DEFAULT 5 NOT NULL,
    minimum_stability real DEFAULT 55 NOT NULL,
    max_traffic_shift integer DEFAULT 20 NOT NULL,
    max_duration_minutes integer DEFAULT 30 NOT NULL,
    rollback_window_minutes integer DEFAULT 30 NOT NULL,
    notification_required boolean DEFAULT true NOT NULL,
    approved_failover_vendors text[] DEFAULT '{}'::text[] NOT NULL,
    updated_by character varying(128),
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    simulation_validated_at timestamp with time zone,
    simulation_scenario jsonb,
    arming_status character varying(32) DEFAULT 'disarmed'::character varying NOT NULL,
    armed_at timestamp with time zone,
    armed_by character varying(128)
);


--
-- Name: intelligent_failover_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.intelligent_failover_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intelligent_failover_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.intelligent_failover_policies_id_seq OWNED BY public.intelligent_failover_policies.id;


--
-- Name: invoice_cdr_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_cdr_snapshots (
    id integer NOT NULL,
    cdr_id character varying(128),
    cdr_start_time character varying(64),
    callee character varying(256),
    duration_secs integer,
    i_tariff character varying(64),
    tariff_version_id integer,
    rating_verification_id integer,
    reproduced_cost real NOT NULL,
    actual_cost real,
    delta real,
    interval_1_used integer,
    interval_n_used integer,
    price_1_used real,
    price_n_used real,
    connect_fee_used real,
    grace_period_used integer,
    free_seconds_used integer,
    post_call_surcharge_used real,
    prefix character varying(32),
    verification_status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    snapshot_hash character varying(64) NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE invoice_cdr_snapshots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoice_cdr_snapshots IS 'Layer 4C: Immutable telecom finance truth. Each row crystallizes a CDR rating, historical tariff, and verification result. Never mutated after creation — snapshot_hash provides tamper detection.';


--
-- Name: COLUMN invoice_cdr_snapshots.snapshot_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoice_cdr_snapshots.snapshot_hash IS 'SHA-256 of canonical JSON of immutable fields. Re-compute and compare to detect tampering.';


--
-- Name: COLUMN invoice_cdr_snapshots.locked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoice_cdr_snapshots.locked_at IS 'Immutable commit timestamp. Set once at creation, never updated.';


--
-- Name: invoice_cdr_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_cdr_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_cdr_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_cdr_snapshots_id_seq OWNED BY public.invoice_cdr_snapshots.id;


--
-- Name: invoice_email_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_email_deliveries (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    recipients text NOT NULL,
    cc_addresses text DEFAULT '[]'::text,
    subject character varying(512) NOT NULL,
    body_text text,
    sent_by character varying(255),
    status character varying(32) DEFAULT 'sent'::character varying NOT NULL,
    error_message text,
    sent_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: invoice_email_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_email_deliveries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_email_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_email_deliveries_id_seq OWNED BY public.invoice_email_deliveries.id;


--
-- Name: invoice_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_jobs (
    id integer NOT NULL,
    client_id character varying(128),
    client_name character varying(256) NOT NULL,
    billing_period character varying(7) NOT NULL,
    invoice_id integer,
    status character varying(32) DEFAULT 'PENDING'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    generated_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by character varying(128),
    sent_at timestamp with time zone,
    failed_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    last_error text,
    notes text,
    created_by character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    i_tariff character varying(64)
);


--
-- Name: TABLE invoice_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoice_jobs IS 'Invoice delivery automation jobs. One job per client per billing period. Tracks the full lifecycle from draft generation through finance approval to SMTP dispatch.';


--
-- Name: invoice_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_jobs_id_seq OWNED BY public.invoice_jobs.id;


--
-- Name: invoice_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_line_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    snapshot_id integer,
    cdr_call_id character varying(128),
    prefix character varying(32),
    duration_secs integer,
    reproduced_cost real,
    actual_cost real,
    delta real
);


--
-- Name: TABLE invoice_line_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoice_line_items IS 'Per-CDR invoice line items. Each row traces to an immutable invoice_cdr_snapshot.';


--
-- Name: invoice_line_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_line_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_line_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_line_items_id_seq OWNED BY public.invoice_line_items.id;


--
-- Name: invoice_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_schedules (
    id integer NOT NULL,
    company_id integer,
    company_name character varying(256),
    i_account integer,
    i_tariff character varying(64),
    frequency character varying(32) DEFAULT 'monthly'::character varying NOT NULL,
    day_of_week integer DEFAULT 1,
    day_of_month integer DEFAULT 1,
    timezone character varying(64) DEFAULT 'Etc/UTC'::character varying,
    auto_approve boolean DEFAULT false,
    active boolean DEFAULT true NOT NULL,
    last_run_at timestamp without time zone,
    next_run_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: invoice_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_schedules_id_seq OWNED BY public.invoice_schedules.id;


--
-- Name: invoice_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_templates (
    id integer NOT NULL,
    template_name character varying(256) NOT NULL,
    template_type character varying(32) DEFAULT 'standard'::character varying NOT NULL,
    detail_level character varying(32) DEFAULT 'full'::character varying NOT NULL,
    client_name character varying(256),
    show_prefix_breakdown boolean DEFAULT false NOT NULL,
    show_destination_summary boolean DEFAULT false NOT NULL,
    show_call_level_details boolean DEFAULT false NOT NULL,
    header_override text,
    footer_override text,
    filename_pattern character varying(256),
    subject_line_pattern character varying(512),
    attach_pdf_enabled boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    branding_profile_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE invoice_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoice_templates IS 'Per-client or global invoice rendering templates. Controls detail level, branding, filename patterns, and email subject lines.';


--
-- Name: invoice_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_templates_id_seq OWNED BY public.invoice_templates.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    invoice_number character varying(64) NOT NULL,
    i_tariff character varying(64),
    customer_name character varying(256),
    period_start character varying(32),
    period_end character varying(32),
    total_reproduced real,
    total_actual real,
    total_delta real,
    line_count integer,
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    generated_at timestamp with time zone DEFAULT now(),
    approved_at timestamp with time zone,
    sent_at timestamp with time zone,
    notes text,
    html_content text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE invoices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoices IS 'Layer 5B: Invoices sourced exclusively from invoice_cdr_snapshots. Draft→Review→Approve→Send flow.';


--
-- Name: COLUMN invoices.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.status IS 'draft | review | approved | sent | void';


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: ip_restrictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ip_restrictions (
    id integer NOT NULL,
    scope character varying(20) DEFAULT 'global'::character varying NOT NULL,
    scope_value character varying(255),
    cidr character varying(64) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by character varying(255)
);


--
-- Name: ip_restrictions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ip_restrictions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ip_restrictions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ip_restrictions_id_seq OWNED BY public.ip_restrictions.id;


--
-- Name: ip_sharing_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ip_sharing_approvals (
    id integer NOT NULL,
    ip_address character varying(64) NOT NULL,
    company_data text DEFAULT '[]'::text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    flagged_at timestamp without time zone DEFAULT now() NOT NULL,
    reviewed_by_id character varying(255),
    reviewed_by_name character varying(255),
    reviewed_at timestamp without time zone,
    review_reason text
);


--
-- Name: ip_sharing_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ip_sharing_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ip_sharing_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ip_sharing_approvals_id_seq OWNED BY public.ip_sharing_approvals.id;


--
-- Name: irsf_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.irsf_events (
    id integer NOT NULL,
    call_id character varying(64) NOT NULL,
    caller character varying(64),
    callee character varying(64),
    client_name character varying(128),
    vendor character varying(128),
    risk_prefix character varying(20),
    country character varying(64),
    breakout character varying(64),
    fraud_score real DEFAULT 100,
    blocked boolean DEFAULT false,
    alert_sent boolean DEFAULT false,
    detected_at timestamp without time zone DEFAULT now()
);


--
-- Name: irsf_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.irsf_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: irsf_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.irsf_events_id_seq OWNED BY public.irsf_events.id;


--
-- Name: kam_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kam_accounts (
    id integer NOT NULL,
    kam_id integer NOT NULL,
    account_id character varying(32) NOT NULL,
    client_name character varying(128),
    drop_threshold integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: kam_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kam_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kam_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kam_accounts_id_seq OWNED BY public.kam_accounts.id;


--
-- Name: kams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kams (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(32),
    title character varying(128),
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    org_role character varying(20) DEFAULT 'KAM'::character varying,
    reports_to integer,
    user_id character varying(255)
);


--
-- Name: kams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kams_id_seq OWNED BY public.kams.id;


--
-- Name: margin_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.margin_alerts (
    id integer NOT NULL,
    alert_type character varying(32) NOT NULL,
    dimension_type character varying(16) NOT NULL,
    dimension_name character varying(256) NOT NULL,
    date date NOT NULL,
    threshold_pct real,
    actual_pct real,
    delta_pct real,
    amount_usd real,
    severity character varying(16) DEFAULT 'medium'::character varying NOT NULL,
    message text,
    acknowledged boolean DEFAULT false NOT NULL,
    acknowledged_by character varying(128),
    acknowledged_at timestamp with time zone,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE margin_alerts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.margin_alerts IS 'Margin threshold breach alerts generated during materialization. Negative margin, margin drops, and vendor cost spikes trigger entries here.';


--
-- Name: margin_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.margin_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: margin_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.margin_alerts_id_seq OWNED BY public.margin_alerts.id;


--
-- Name: margin_analytics_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.margin_analytics_daily (
    id integer NOT NULL,
    date date NOT NULL,
    dimension_type character varying(16) NOT NULL,
    dimension_id character varying(64),
    dimension_name character varying(256) NOT NULL,
    revenue_usd real,
    cost_usd real,
    margin_usd real,
    margin_pct real,
    duration_sec real,
    calls integer,
    asr real,
    acd real,
    source character varying(32) DEFAULT 'dmr'::character varying NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE margin_analytics_daily; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.margin_analytics_daily IS 'Pre-computed margin analytics by client, vendor, and aggregate. Materialized from DMR rows. Used for profitability ranking, trend analysis, and commercial intelligence.';


--
-- Name: margin_analytics_daily_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.margin_analytics_daily_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: margin_analytics_daily_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.margin_analytics_daily_id_seq OWNED BY public.margin_analytics_daily.id;


--
-- Name: metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metrics (
    id integer NOT NULL,
    call_id integer NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now(),
    jitter real NOT NULL,
    latency real NOT NULL,
    packet_loss real NOT NULL,
    mos real NOT NULL
);


--
-- Name: metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.metrics_id_seq OWNED BY public.metrics.id;


--
-- Name: mfa_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_secrets (
    id integer NOT NULL,
    user_id character varying(255) NOT NULL,
    secret text NOT NULL,
    is_enabled boolean DEFAULT false NOT NULL,
    backup_codes text[] DEFAULT '{}'::text[] NOT NULL,
    enabled_at timestamp without time zone,
    last_used_at timestamp without time zone
);


--
-- Name: mfa_secrets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mfa_secrets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mfa_secrets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mfa_secrets_id_seq OWNED BY public.mfa_secrets.id;


--
-- Name: monitored_hosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitored_hosts (
    id integer NOT NULL,
    label character varying(128) NOT NULL,
    ip character varying(128) NOT NULL,
    type character varying(32) DEFAULT 'vendor'::character varying NOT NULL,
    ports text,
    notify_email character varying(256),
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: monitored_hosts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.monitored_hosts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: monitored_hosts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.monitored_hosts_id_seq OWNED BY public.monitored_hosts.id;


--
-- Name: monitoring_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitoring_assignments (
    user_id character varying NOT NULL,
    items text[] DEFAULT '{}'::text[] NOT NULL,
    assigned_by character varying,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: mos_hourly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mos_hourly (
    id integer NOT NULL,
    hour timestamp without time zone NOT NULL,
    vendor character varying(128),
    avg_mos real,
    min_mos real,
    max_mos real,
    call_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: mos_hourly_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mos_hourly_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mos_hourly_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mos_hourly_id_seq OWNED BY public.mos_hourly.id;


--
-- Name: navigation_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.navigation_modules (
    id integer NOT NULL,
    module_key text NOT NULL,
    title text NOT NULL,
    icon text DEFAULT 'circle'::text NOT NULL,
    route text NOT NULL,
    engine text,
    adapter_support text[] DEFAULT '{}'::text[] NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    default_portal text,
    is_movable boolean DEFAULT true NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: navigation_modules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.navigation_modules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: navigation_modules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.navigation_modules_id_seq OWNED BY public.navigation_modules.id;


--
-- Name: noc_incident_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noc_incident_assignments (
    id integer NOT NULL,
    incident_id integer NOT NULL,
    user_id character varying(255) NOT NULL,
    user_name character varying(255) NOT NULL,
    assigned_by character varying(255),
    assigned_at timestamp without time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: noc_incident_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.noc_incident_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: noc_incident_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.noc_incident_assignments_id_seq OWNED BY public.noc_incident_assignments.id;


--
-- Name: noc_incident_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noc_incident_events (
    id integer NOT NULL,
    incident_id integer NOT NULL,
    event_type character varying(32) NOT NULL,
    from_status character varying(20),
    to_status character varying(20),
    actor_id character varying(255),
    actor_name character varying(255) DEFAULT 'system'::character varying NOT NULL,
    note text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: noc_incident_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.noc_incident_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: noc_incident_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.noc_incident_events_id_seq OWNED BY public.noc_incident_events.id;


--
-- Name: noc_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noc_incidents (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    type character varying(32) DEFAULT 'manual'::character varying NOT NULL,
    severity character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    entity_type character varying(32),
    entity_id character varying(128),
    entity_name character varying(255),
    description text,
    suggested_action text,
    assignee_id character varying(255),
    assignee_name character varying(255),
    source character varying(64) DEFAULT 'manual'::character varying NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    opened_at timestamp without time zone DEFAULT now() NOT NULL,
    acknowledged_at timestamp without time zone,
    mitigated_at timestamp without time zone,
    resolved_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: noc_incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.noc_incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: noc_incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.noc_incidents_id_seq OWNED BY public.noc_incidents.id;


--
-- Name: number_lookup_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_lookup_cache (
    id integer NOT NULL,
    number character varying(32) NOT NULL,
    country character varying(64),
    country_code character varying(4),
    carrier character varying(128),
    line_type character varying(32),
    ported boolean,
    active boolean,
    roaming boolean,
    cnam character varying(128),
    stir_shaken character varying(8),
    reputation_score integer,
    raw_json text,
    looked_up_at timestamp without time zone DEFAULT now()
);


--
-- Name: number_lookup_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.number_lookup_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: number_lookup_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.number_lookup_cache_id_seq OWNED BY public.number_lookup_cache.id;


--
-- Name: outage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outage_log (
    id integer NOT NULL,
    down_at timestamp without time zone NOT NULL,
    recovered_at timestamp without time zone,
    duration_sec integer,
    cause character varying(128),
    checked_at timestamp without time zone DEFAULT now()
);


--
-- Name: outage_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outage_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outage_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outage_log_id_seq OWNED BY public.outage_log.id;


--
-- Name: partner_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_profiles (
    id integer NOT NULL,
    client_name character varying(256) NOT NULL,
    company_display_name character varying(256),
    contact_email character varying(256),
    access_code_hash character varying(256) NOT NULL,
    access_code_prefix character varying(8) NOT NULL,
    logo_url text,
    welcome_message text,
    active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE partner_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.partner_profiles IS 'Partner portal access profiles — maps hashed access codes to a clientName for read-only portal access.';


--
-- Name: partner_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.partner_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partner_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.partner_profiles_id_seq OWNED BY public.partner_profiles.id;


--
-- Name: payment_reminder_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_reminder_config (
    id integer NOT NULL,
    grace_days integer DEFAULT 7 NOT NULL,
    reminder_interval_days integer DEFAULT 7 NOT NULL,
    max_reminders integer DEFAULT 3 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    reminder_email_template text,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_reminder_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_reminder_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_reminder_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_reminder_config_id_seq OWNED BY public.payment_reminder_config.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    company_id integer,
    company_name character varying(256),
    invoice_id integer,
    amount real DEFAULT 0 NOT NULL,
    currency character varying(8) DEFAULT 'USD'::character varying NOT NULL,
    payment_date character varying(32) NOT NULL,
    payment_method character varying(64) DEFAULT 'bank_transfer'::character varying,
    reference character varying(256),
    notes text,
    status character varying(32) DEFAULT 'received'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: platform_feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_feature_flags (
    key character varying(64) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    owner_role character varying(32) NOT NULL,
    changed_by character varying(255),
    changed_by_name character varying(128),
    changed_at timestamp without time zone DEFAULT now(),
    reason text,
    prev_state boolean
);


--
-- Name: portal_access_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_access_tokens (
    id integer NOT NULL,
    token text NOT NULL,
    account_id text NOT NULL,
    account_name text NOT NULL,
    label text,
    created_by text,
    expires_at timestamp without time zone,
    last_used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    permissions text DEFAULT '["cdrs","usage","billing"]'::text,
    client_profile_id integer
);


--
-- Name: portal_access_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_access_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_access_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_access_tokens_id_seq OWNED BY public.portal_access_tokens.id;


--
-- Name: portal_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_definitions (
    id integer NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    icon text DEFAULT 'layout-dashboard'::text NOT NULL,
    theme text DEFAULT 'neutral'::text NOT NULL,
    layout_type text DEFAULT 'sidebar-sections'::text NOT NULL,
    default_route text DEFAULT '/'::text NOT NULL,
    allowed_roles text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    primary_color text DEFAULT 'purple'::text NOT NULL,
    accent_color text DEFAULT 'indigo'::text NOT NULL,
    background_style text DEFAULT 'flat'::text NOT NULL,
    density text DEFAULT 'comfortable'::text NOT NULL,
    nav_style text DEFAULT 'glass'::text NOT NULL,
    font_scale text DEFAULT 'normal'::text NOT NULL
);


--
-- Name: portal_definitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_definitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_definitions_id_seq OWNED BY public.portal_definitions.id;


--
-- Name: portal_module_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_module_assignments (
    id integer NOT NULL,
    portal_id text NOT NULL,
    module_id integer NOT NULL,
    section text DEFAULT 'main'::text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    display_label text,
    adapter text,
    visibility text DEFAULT 'full'::text NOT NULL,
    is_home boolean DEFAULT false NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    adapter_type text,
    widget_profile text DEFAULT 'standard'::text NOT NULL,
    access_scope text DEFAULT 'global'::text NOT NULL,
    realtime_enabled boolean DEFAULT false NOT NULL,
    density_mode text DEFAULT 'standard'::text NOT NULL,
    default_time_range text DEFAULT '24h'::text NOT NULL
);


--
-- Name: portal_module_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_module_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_module_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_module_assignments_id_seq OWNED BY public.portal_module_assignments.id;


--
-- Name: portal_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_sections (
    id integer NOT NULL,
    portal_id text NOT NULL,
    section_key text NOT NULL,
    title text NOT NULL,
    icon text DEFAULT 'circle'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: portal_sections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_sections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_sections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_sections_id_seq OWNED BY public.portal_sections.id;


--
-- Name: portal_ticket_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_ticket_messages (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    author character varying(20) NOT NULL,
    body text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: portal_ticket_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_ticket_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_ticket_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_ticket_messages_id_seq OWNED BY public.portal_ticket_messages.id;


--
-- Name: portal_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_tickets (
    id integer NOT NULL,
    token_id integer NOT NULL,
    account_id integer NOT NULL,
    account_name character varying(255),
    category character varying(50) NOT NULL,
    subject character varying(255) NOT NULL,
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    severity character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: portal_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_tickets_id_seq OWNED BY public.portal_tickets.id;


--
-- Name: prefix_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prefix_audit_log (
    id integer NOT NULL,
    action character varying(64) NOT NULL,
    canonical_id integer,
    vendor_name character varying(100),
    full_prefix character varying(10),
    performed_by character varying(128),
    details jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: prefix_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prefix_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prefix_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prefix_audit_log_id_seq OWNED BY public.prefix_audit_log.id;


--
-- Name: pricing_template_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_template_rates (
    id integer NOT NULL,
    template_id integer NOT NULL,
    dial_prefix character varying(32) NOT NULL,
    country_name character varying(128),
    operator_name character varying(128),
    buy_rate numeric(10,6) NOT NULL,
    margin_pct numeric(8,4) NOT NULL,
    sell_rate numeric(10,6) NOT NULL,
    notes text
);


--
-- Name: pricing_template_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pricing_template_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pricing_template_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pricing_template_rates_id_seq OWNED BY public.pricing_template_rates.id;


--
-- Name: pricing_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_templates (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    product_id integer NOT NULL,
    description text,
    is_default boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pricing_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pricing_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pricing_templates_id_seq OWNED BY public.pricing_templates.id;


--
-- Name: product_destination_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_destination_assignments (
    id integer NOT NULL,
    product_id integer NOT NULL,
    destination_id integer NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by character varying(128),
    offer_min real,
    offer_target real,
    offer_premium real
);


--
-- Name: product_destination_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_destination_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_destination_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_destination_assignments_id_seq OWNED BY public.product_destination_assignments.id;


--
-- Name: product_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_docs (
    id integer NOT NULL,
    product_prefix character varying(16) NOT NULL,
    title character varying(255) NOT NULL,
    section character varying(64) DEFAULT 'General'::character varying NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    updated_by character varying(255),
    updated_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: product_docs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_docs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_docs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_docs_id_seq OWNED BY public.product_docs.id;


--
-- Name: product_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_history (
    id integer NOT NULL,
    product_id integer,
    destination_id integer,
    event_type character varying(64) NOT NULL,
    description text NOT NULL,
    previous_value jsonb,
    new_value jsonb,
    performed_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: product_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_history_id_seq OWNED BY public.product_history.id;


--
-- Name: product_prefixes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_prefixes (
    prefix character varying(16) NOT NULL,
    product_code character varying(16) NOT NULL,
    product_name character varying(64) NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: product_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_rates (
    id integer NOT NULL,
    product_id integer NOT NULL,
    destination_id integer,
    prefix character varying(32),
    rate numeric(12,6) DEFAULT 0 NOT NULL,
    currency character varying(8) DEFAULT 'USD'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    notes text,
    created_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: product_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_rates_id_seq OWNED BY public.product_rates.id;


--
-- Name: product_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_registry (
    id integer NOT NULL,
    code character varying(16) NOT NULL,
    name character varying(64) NOT NULL,
    description text,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    color character varying(32) DEFAULT 'violet'::character varying,
    default_routing_template character varying(128),
    backup_routing_template character varying(128),
    default_pricing_template character varying(128),
    min_margin_pct real DEFAULT 0,
    discount_range_min real,
    discount_range_max real,
    notice_period_days integer DEFAULT 7,
    offer_window_min real,
    offer_window_target real,
    offer_window_premium real,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    trunk_prefix character varying(8)
);


--
-- Name: product_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_registry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_registry_id_seq OWNED BY public.product_registry.id;


--
-- Name: provisioning_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provisioning_jobs (
    id integer NOT NULL,
    i_account integer NOT NULL,
    product_id integer NOT NULL,
    routing_template_id integer,
    pricing_template_id integer,
    status character varying(32) DEFAULT 'pending'::character varying,
    steps text,
    i_tariff integer,
    i_routing_group integer,
    created_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone
);


--
-- Name: provisioning_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.provisioning_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: provisioning_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.provisioning_jobs_id_seq OWNED BY public.provisioning_jobs.id;


--
-- Name: quality_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quality_events (
    id integer NOT NULL,
    window_start timestamp without time zone NOT NULL,
    window_end timestamp without time zone NOT NULL,
    avg_mos real NOT NULL,
    carrier character varying(128),
    sample_count integer DEFAULT 0,
    alert_sent boolean DEFAULT false,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: quality_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quality_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quality_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quality_events_id_seq OWNED BY public.quality_events.id;


--
-- Name: rate_card_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_card_entries (
    id integer NOT NULL,
    rate_card_id integer NOT NULL,
    prefix character varying(20) NOT NULL,
    country character varying(255),
    breakout character varying(255),
    rate_per_min real NOT NULL,
    origin_prefix character varying(20)
);


--
-- Name: rate_card_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_card_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_card_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_card_entries_id_seq OWNED BY public.rate_card_entries.id;


--
-- Name: rate_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_cards (
    id integer NOT NULL,
    vendor_name character varying(128) NOT NULL,
    name character varying(128) NOT NULL,
    currency character varying(8) DEFAULT 'USD'::character varying,
    effective_date timestamp without time zone,
    entry_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    card_type character varying(10) DEFAULT 'vendor'::character varying NOT NULL,
    sippy_tariff_id integer
);


--
-- Name: rate_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_cards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_cards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_cards_id_seq OWNED BY public.rate_cards.id;


--
-- Name: rate_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_notifications (
    id integer NOT NULL,
    tariff_id character varying(64),
    product_id integer,
    notification_type character varying(32) DEFAULT 'rate_change'::character varying NOT NULL,
    subject character varying(512),
    message text,
    affected_accounts integer[],
    affected_count integer DEFAULT 0,
    scheduled_for timestamp without time zone,
    sent_at timestamp without time zone,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    created_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_notifications_id_seq OWNED BY public.rate_notifications.id;


--
-- Name: rate_push_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_push_jobs (
    id integer NOT NULL,
    job_id character varying(64) DEFAULT (gen_random_uuid())::text NOT NULL,
    product_name character varying(64),
    trunk_prefix character varying(8),
    format character varying(16) DEFAULT 'full'::character varying,
    rate_type character varying(16) DEFAULT 'current'::character varying,
    total_clients integer DEFAULT 0,
    pushed_clients integer DEFAULT 0,
    failed_clients integer DEFAULT 0,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    created_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    switch_name character varying(128),
    i_tariff integer,
    full_prefix character varying(32),
    old_rate character varying(32),
    new_rate character varying(32),
    effective_at character varying(32),
    upload_token character varying(256),
    upload_status character varying(32),
    verification_result character varying(32),
    push_method character varying(32)
);


--
-- Name: rate_push_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_push_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_push_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_push_jobs_id_seq OWNED BY public.rate_push_jobs.id;


--
-- Name: rating_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rating_verifications (
    id integer NOT NULL,
    cdr_call_id character varying(128),
    cdr_start_time character varying(64),
    prefix character varying(32),
    destination character varying(256),
    i_tariff character varying(64),
    tariff_version_id integer,
    duration_secs integer,
    billed_secs integer,
    sippy_actual_cost real,
    reproduced_cost real,
    delta_amount real,
    delta_pct real,
    discrepancy_type character varying(64) DEFAULT 'unrated'::character varying NOT NULL,
    verification_status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    severity character varying(16) DEFAULT 'none'::character varying NOT NULL,
    verification_source character varying(32) DEFAULT 'auto'::character varying NOT NULL,
    verified_at timestamp with time zone,
    notes text,
    rate_snapshot text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE rating_verifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rating_verifications IS 'Layer 4B: Per-CDR telecom rating reproduction and discrepancy classification. Read-only against Sippy — never modifies ratings.';


--
-- Name: COLUMN rating_verifications.discrepancy_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rating_verifications.discrepancy_type IS 'exact_match | overbilled | underbilled | interval_mismatch | connect_fee_mismatch | grace_period_mismatch | surcharge_mismatch | missing_rate | unrated';


--
-- Name: COLUMN rating_verifications.rate_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rating_verifications.rate_snapshot IS 'JSON snapshot of the rate row used for reproduction — immutable audit record.';


--
-- Name: rating_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rating_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rating_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rating_verifications_id_seq OWNED BY public.rating_verifications.id;


--
-- Name: rbac_permission_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_permission_audit_events (
    id integer NOT NULL,
    event_type character varying(60) NOT NULL,
    actor_id character varying(255) NOT NULL,
    target_user_id character varying(255),
    target_role character varying(40),
    permission_key character varying(80),
    before_value jsonb,
    after_value jsonb,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rbac_permission_audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rbac_permission_audit_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rbac_permission_audit_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rbac_permission_audit_events_id_seq OWNED BY public.rbac_permission_audit_events.id;


--
-- Name: rbac_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_permissions (
    id integer NOT NULL,
    key character varying(80) NOT NULL,
    domain character varying(40) NOT NULL,
    label character varying(120) NOT NULL,
    description text,
    risk_level character varying(20) DEFAULT 'low'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rbac_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rbac_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rbac_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rbac_permissions_id_seq OWNED BY public.rbac_permissions.id;


--
-- Name: rbac_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_role_permissions (
    id integer NOT NULL,
    role character varying(40) NOT NULL,
    permission_key character varying(80) NOT NULL,
    granted boolean DEFAULT true NOT NULL,
    granted_by character varying(255),
    granted_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rbac_role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rbac_role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rbac_role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rbac_role_permissions_id_seq OWNED BY public.rbac_role_permissions.id;


--
-- Name: rbac_user_permission_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_user_permission_overrides (
    id integer NOT NULL,
    user_id character varying(255) NOT NULL,
    permission_key character varying(80) NOT NULL,
    granted boolean NOT NULL,
    scope character varying(40) DEFAULT 'all'::character varying,
    reason text,
    granted_by character varying(255) NOT NULL,
    granted_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone
);


--
-- Name: rbac_user_permission_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rbac_user_permission_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rbac_user_permission_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rbac_user_permission_overrides_id_seq OWNED BY public.rbac_user_permission_overrides.id;


--
-- Name: recommendation_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_outcomes (
    id integer NOT NULL,
    recommendation_id integer,
    execution_id integer,
    projected_asr_delta real,
    actual_asr_delta real,
    projected_margin_delta real,
    actual_margin_delta real,
    projected_fas_delta real,
    actual_fas_delta real,
    projected_stability_delta real,
    actual_stability_delta real,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    rollback_triggered boolean DEFAULT false NOT NULL,
    rollback_reason character varying(512)
);


--
-- Name: recommendation_outcomes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recommendation_outcomes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recommendation_outcomes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recommendation_outcomes_id_seq OWNED BY public.recommendation_outcomes.id;


--
-- Name: reconciliation_email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_email_log (
    id integer NOT NULL,
    sent_at timestamp without time zone DEFAULT now() NOT NULL,
    sender_user_id character varying(128),
    sender_name character varying(255),
    recipient_email character varying(320) NOT NULL,
    report_type character varying(16) NOT NULL,
    format character varying(8) NOT NULL,
    filename character varying(255),
    subject character varying(500),
    status character varying(16) DEFAULT 'sent'::character varying NOT NULL,
    error_message text
);


--
-- Name: reconciliation_email_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reconciliation_email_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reconciliation_email_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reconciliation_email_log_id_seq OWNED BY public.reconciliation_email_log.id;


--
-- Name: reconciliation_report_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_report_schedules (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    report_type character varying(20) DEFAULT 'carrier'::character varying NOT NULL,
    recipients text NOT NULL,
    format character varying(10) DEFAULT 'pdf'::character varying NOT NULL,
    frequency character varying(20) DEFAULT 'monthly'::character varying NOT NULL,
    day_of_month integer DEFAULT 1,
    day_of_week integer,
    cron_hour integer DEFAULT 8 NOT NULL,
    carrier_tariff character varying(64),
    enabled boolean DEFAULT true NOT NULL,
    last_sent_at timestamp without time zone,
    next_due_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: reconciliation_report_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reconciliation_report_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reconciliation_report_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reconciliation_report_schedules_id_seq OWNED BY public.reconciliation_report_schedules.id;


--
-- Name: report_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_jobs (
    id integer NOT NULL,
    report_type character varying(32) DEFAULT 'executive_monthly'::character varying NOT NULL,
    title character varying(256),
    period_start character varying(32),
    period_end character varying(32),
    delivery_status character varying(32) DEFAULT 'generated'::character varying NOT NULL,
    recipients_json text,
    html_content text,
    generated_at timestamp with time zone DEFAULT now(),
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE report_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.report_jobs IS 'Layer 5A: Executive report generation jobs. Intelligence presentation only — not financial truth.';


--
-- Name: report_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: report_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_jobs_id_seq OWNED BY public.report_jobs.id;


--
-- Name: reseller_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reseller_profiles (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    contact_email character varying(255),
    markup_percent real DEFAULT 0 NOT NULL,
    i_customer integer,
    brand_name character varying(128),
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: reseller_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reseller_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reseller_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reseller_profiles_id_seq OWNED BY public.reseller_profiles.id;


--
-- Name: route_decision_traces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_decision_traces (
    id integer NOT NULL,
    campaign_id integer,
    run_id integer,
    cld character varying(64) NOT NULL,
    cli character varying(64),
    selected_carrier character varying(128),
    selected_carrier_id integer,
    candidate_routes text,
    decision_reason character varying(255),
    outcome character varying(20),
    sip_code integer,
    pdd_ms real,
    duration_sec real,
    failure_category character varying(64),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    failure_type character varying(32),
    carrier_scores_snapshot text
);


--
-- Name: route_decision_traces_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.route_decision_traces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_decision_traces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_decision_traces_id_seq OWNED BY public.route_decision_traces.id;


--
-- Name: route_health_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_health_scores (
    id integer NOT NULL,
    routing_group_id character varying(64) NOT NULL,
    routing_group_name character varying(256) NOT NULL,
    scored_at timestamp without time zone DEFAULT now() NOT NULL,
    overall_score real NOT NULL,
    vendor_count integer DEFAULT 0 NOT NULL,
    lowest_vendor_score real,
    details jsonb
);


--
-- Name: route_health_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.route_health_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_health_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_health_scores_id_seq OWNED BY public.route_health_scores.id;


--
-- Name: route_quality_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_quality_snapshots (
    id integer NOT NULL,
    vendor_id character varying(64) NOT NULL,
    vendor_name character varying(128) NOT NULL,
    prefix character varying(32) NOT NULL,
    window_hours integer NOT NULL,
    computed_at timestamp without time zone DEFAULT now() NOT NULL,
    call_count integer DEFAULT 0 NOT NULL,
    answered_count integer DEFAULT 0 NOT NULL,
    asr real,
    acd_seconds real,
    pdd_ms real,
    total_cost_usd real,
    revenue_usd real,
    margin_usd real,
    rate_503 real,
    rate_486 real,
    rate_480 real,
    rate_408 real,
    rate_404 real,
    rate_403 real,
    spike_flags jsonb
);


--
-- Name: route_quality_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.route_quality_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_quality_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_quality_snapshots_id_seq OWNED BY public.route_quality_snapshots.id;


--
-- Name: route_test_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_test_jobs (
    id integer NOT NULL,
    name character varying(256) NOT NULL,
    destination_prefix character varying(64) NOT NULL,
    vendor_ids text[] DEFAULT '{}'::text[] NOT NULL,
    vendor_names text[] DEFAULT '{}'::text[] NOT NULL,
    schedule_minutes integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by character varying(128),
    last_run_at timestamp without time zone,
    next_run_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    cli_to_send character varying(32)
);


--
-- Name: route_test_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.route_test_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_test_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_test_jobs_id_seq OWNED BY public.route_test_jobs.id;


--
-- Name: route_test_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_test_results (
    id integer NOT NULL,
    job_id integer,
    vendor_id character varying(128),
    vendor_name character varying(256),
    destination character varying(64),
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    connected boolean DEFAULT false NOT NULL,
    sip_code integer,
    pdd_ms integer,
    duration_ms integer,
    cli_received character varying(64),
    notes text,
    raw_response jsonb,
    cli_sent character varying(32),
    cli_match character varying(16)
);


--
-- Name: route_test_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.route_test_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_test_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_test_results_id_seq OWNED BY public.route_test_results.id;


--
-- Name: routing_cache_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_cache_meta (
    id integer NOT NULL,
    last_sync_at timestamp without time zone,
    last_sync_status character varying(32) DEFAULT 'pending'::character varying,
    last_sync_error text,
    rg_count integer DEFAULT 0,
    ds_count integer DEFAULT 0,
    conn_count integer DEFAULT 0
);


--
-- Name: routing_cache_meta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routing_cache_meta_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_cache_meta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routing_cache_meta_id_seq OWNED BY public.routing_cache_meta.id;


--
-- Name: routing_groups_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_groups_cache (
    id integer NOT NULL,
    i_routing_group integer NOT NULL,
    name character varying(255) NOT NULL,
    policy character varying(64),
    media_relay character varying(64),
    on_net boolean DEFAULT false,
    members_count integer DEFAULT 0,
    raw_json text,
    cached_at timestamp without time zone DEFAULT now()
);


--
-- Name: routing_groups_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routing_groups_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_groups_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routing_groups_cache_id_seq OWNED BY public.routing_groups_cache.id;


--
-- Name: routing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_rules (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    condition_metric character varying(64) NOT NULL,
    condition_operator character varying(16) NOT NULL,
    condition_threshold real NOT NULL,
    condition_duration_min integer DEFAULT 5 NOT NULL,
    scope_vendor character varying(128),
    scope_destination character varying(64),
    action_type character varying(64) NOT NULL,
    action_payload text,
    last_triggered_at timestamp without time zone,
    trigger_count integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: routing_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routing_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routing_rules_id_seq OWNED BY public.routing_rules.id;


--
-- Name: routing_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_suggestions (
    id integer NOT NULL,
    carrier_name character varying(256) NOT NULL,
    entity character varying(256),
    current_score numeric(5,2),
    suggested_action text NOT NULL,
    reason text NOT NULL,
    confidence numeric(3,2) DEFAULT 0.5 NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone,
    simulation_validated_at timestamp with time zone,
    simulation_scenario jsonb
);


--
-- Name: routing_suggestions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routing_suggestions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_suggestions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routing_suggestions_id_seq OWNED BY public.routing_suggestions.id;


--
-- Name: routing_template_vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_template_vendors (
    id integer NOT NULL,
    template_id integer NOT NULL,
    vendor_name character varying(128) NOT NULL,
    i_connection integer,
    i_destination_set integer,
    priority integer DEFAULT 0 NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true,
    note text
);


--
-- Name: routing_template_vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routing_template_vendors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_template_vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routing_template_vendors_id_seq OWNED BY public.routing_template_vendors.id;


--
-- Name: routing_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_templates (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    product_id integer NOT NULL,
    description text,
    is_default boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: routing_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routing_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routing_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routing_templates_id_seq OWNED BY public.routing_templates.id;


--
-- Name: rtp_quality_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rtp_quality_history (
    id integer NOT NULL,
    vendor_id character varying(128) NOT NULL,
    avg_mos real,
    p10_mos real,
    avg_jitter_ms real,
    avg_pkt_loss_pct real,
    avg_latency_ms real,
    sample_count integer DEFAULT 0 NOT NULL,
    snapped_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rtp_quality_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rtp_quality_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rtp_quality_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rtp_quality_history_id_seq OWNED BY public.rtp_quality_history.id;


--
-- Name: rtp_quality_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rtp_quality_stats (
    id integer NOT NULL,
    vendor_id character varying(128) NOT NULL,
    destination_prefix character varying(32) DEFAULT ''::character varying NOT NULL,
    window_minutes integer NOT NULL,
    avg_mos real,
    p10_mos real,
    avg_jitter_ms real,
    avg_pkt_loss_pct real,
    avg_latency_ms real,
    sample_count integer DEFAULT 0 NOT NULL,
    computed_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rtp_quality_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rtp_quality_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rtp_quality_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rtp_quality_stats_id_seq OWNED BY public.rtp_quality_stats.id;


--
-- Name: sbc_hosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sbc_hosts (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    host character varying(255) NOT NULL,
    port integer DEFAULT 5060 NOT NULL,
    vendor character varying(64) DEFAULT 'generic'::character varying NOT NULL,
    snmp_community character varying(64),
    api_url character varying(255),
    api_key character varying(255),
    enabled boolean DEFAULT true NOT NULL,
    last_status character varying(32) DEFAULT 'unknown'::character varying,
    last_checked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sbc_hosts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sbc_hosts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sbc_hosts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sbc_hosts_id_seq OWNED BY public.sbc_hosts.id;


--
-- Name: scheduled_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_reports (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    metrics text DEFAULT '["asr","acd","ner"]'::text NOT NULL,
    time_window character varying(20) DEFAULT '24h'::character varying NOT NULL,
    frequency character varying(20) DEFAULT 'daily'::character varying NOT NULL,
    recipients text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_sent_at timestamp without time zone,
    next_due_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: scheduled_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scheduled_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduled_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scheduled_reports_id_seq OWNED BY public.scheduled_reports.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp without time zone NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id integer NOT NULL,
    jitter_threshold integer DEFAULT 30,
    latency_threshold integer DEFAULT 150,
    packet_loss_threshold real DEFAULT 1,
    simulation_enabled boolean DEFAULT false,
    monitored_ip character varying(45) DEFAULT '45.59.163.182'::character varying,
    portal_url character varying(255),
    portal_username character varying(128),
    portal_password character varying(255),
    switch_type character varying(50) DEFAULT 'vos3000'::character varying,
    portal_session_token character varying(512),
    portal_session_user character varying(128),
    portal_session_base character varying(512),
    api_admin_username character varying(128),
    api_admin_password character varying(255),
    snmp_enabled boolean DEFAULT false,
    snmp_host character varying(255),
    snmp_port integer DEFAULT 161,
    snmp_community character varying(128) DEFAULT 'public'::character varying,
    snmp_environments character varying(255) DEFAULT '1'::character varying,
    alert_admin_email character varying(255),
    alert_gmail_user character varying(255),
    alert_gmail_app_pass character varying(255),
    alert_enabled boolean DEFAULT false,
    balance_alert_threshold real DEFAULT 10,
    fas_min_pdd_secs integer DEFAULT 10,
    fas_max_bill_secs integer DEFAULT 5,
    fas_early_answer_secs integer DEFAULT 2,
    fas_short_call_secs integer DEFAULT 10,
    whatsapp_enabled boolean DEFAULT false,
    whatsapp_provider character varying(20) DEFAULT 'callmebot'::character varying,
    whatsapp_phones text,
    whatsapp_api_key character varying(255),
    whatsapp_instance_id character varying(128),
    whatsapp_alert_types text DEFAULT 'fas,balance,traffic,outage,auth'::text,
    admin_web_password character varying(255),
    mgmt_feature_permissions text DEFAULT '["alerts","server_monitoring","did_management","test_call","graphs","bitseye","reports","cdr_viewer","balance_monitor","fraud_fas","clients","tools","call_flow_simulator","lcr_analyser","vendor_sla"]'::text,
    grafana_url character varying(1024),
    grafana_default_range character varying(20) DEFAULT '1h'::character varying,
    grafana_panel_height integer DEFAULT 480,
    approval_settings text,
    recording_server_url character varying(512),
    sidebar_hidden_items text DEFAULT '[]'::text,
    hlr_provider character varying(20) DEFAULT 'none'::character varying,
    hlr_api_key character varying(255),
    hlr_api_secret character varying(255),
    otp_channel_policy text,
    meta_phone_number_id character varying(64),
    meta_access_token character varying(512),
    meta_otp_template_name character varying(128) DEFAULT 'otp_verification'::character varying,
    meta_otp_template_language character varying(16) DEFAULT 'en_us'::character varying,
    meta_use_otp_template boolean DEFAULT true,
    meta_flow_id character varying(64),
    meta_waba_id character varying(64),
    meta_flows_enabled boolean DEFAULT false,
    meta_flows_public_key text,
    dual_approval_ttl_minutes integer DEFAULT 30,
    approval_expiry_email_enabled boolean DEFAULT true,
    approval_expiry_slack_webhook_url character varying(512),
    invoice_smtp_host character varying(255),
    invoice_smtp_port integer DEFAULT 587,
    invoice_smtp_secure boolean DEFAULT false,
    invoice_smtp_user character varying(255),
    invoice_smtp_pass character varying(512),
    invoice_smtp_from_name character varying(255) DEFAULT 'Ichibaan Logic Billing'::character varying,
    invoice_smtp_from_email character varying(255),
    sip_error_alert_threshold real DEFAULT 15,
    sippy_rate_admin_user character varying(128),
    sippy_rate_admin_pass character varying(255)
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: simbox_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.simbox_scores (
    id integer NOT NULL,
    vendor_id character varying(64) NOT NULL,
    vendor_name character varying(128) NOT NULL,
    window_start timestamp without time zone NOT NULL,
    window_end timestamp without time zone NOT NULL,
    risk_score real DEFAULT 0 NOT NULL,
    risk_level character varying(10) DEFAULT 'low'::character varying NOT NULL,
    total_calls integer DEFAULT 0 NOT NULL,
    short_calls integer DEFAULT 0 NOT NULL,
    early_disconnect integer DEFAULT 0 NOT NULL,
    repeated_routes integer DEFAULT 0 NOT NULL,
    unique_cli integer DEFAULT 0 NOT NULL,
    unique_cld integer DEFAULT 0 NOT NULL,
    avg_duration_sec real DEFAULT 0 NOT NULL,
    signal_details text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: simbox_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.simbox_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: simbox_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.simbox_scores_id_seq OWNED BY public.simbox_scores.id;


--
-- Name: sip_error_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sip_error_history (
    id integer NOT NULL,
    vendor_name character varying(128) NOT NULL,
    code integer NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    rate real DEFAULT 0 NOT NULL,
    snapshot_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sip_error_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sip_error_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sip_error_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sip_error_history_id_seq OWNED BY public.sip_error_history.id;


--
-- Name: sip_error_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sip_error_stats (
    id integer NOT NULL,
    vendor_name character varying(128) NOT NULL,
    window_minutes integer NOT NULL,
    code integer NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    rate real DEFAULT 0 NOT NULL,
    computed_at timestamp without time zone DEFAULT now() NOT NULL,
    dest_prefix character varying(12) DEFAULT ''::character varying NOT NULL,
    time_bucket timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sip_error_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sip_error_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sip_error_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sip_error_stats_id_seq OWNED BY public.sip_error_stats.id;


--
-- Name: sippy_change_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sippy_change_events (
    id integer NOT NULL,
    category character varying(32) NOT NULL,
    change_type character varying(32) NOT NULL,
    subject text NOT NULL,
    client_name character varying(255),
    vendor_name character varying(255),
    old_value text,
    new_value text,
    meta json,
    detected_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sippy_change_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sippy_change_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sippy_change_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sippy_change_events_id_seq OWNED BY public.sippy_change_events.id;


--
-- Name: sippy_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sippy_snapshots (
    key text NOT NULL,
    data json NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sla_breach_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sla_breach_log (
    id integer NOT NULL,
    vendor_id character varying(64) NOT NULL,
    vendor_name character varying(128) NOT NULL,
    metric character varying(20) NOT NULL,
    threshold real NOT NULL,
    actual_value real NOT NULL,
    breach_start timestamp without time zone NOT NULL,
    breach_end timestamp without time zone,
    duration_minutes real,
    resolved boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sla_breach_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sla_breach_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sla_breach_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sla_breach_log_id_seq OWNED BY public.sla_breach_log.id;


--
-- Name: sms_dlr_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_dlr_events (
    id integer NOT NULL,
    message_id character varying(128),
    client_ref character varying(128),
    status integer,
    status_text character varying(16),
    msisdn character varying(32),
    operator character varying(64),
    country character varying(64),
    error_code character varying(32),
    raw_payload jsonb,
    received_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sms_dlr_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sms_dlr_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sms_dlr_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sms_dlr_events_id_seq OWNED BY public.sms_dlr_events.id;


--
-- Name: sms_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_messages (
    id integer NOT NULL,
    internal_id character varying(64),
    bhaoo_id character varying(128),
    to_number character varying(32) NOT NULL,
    from_id character varying(32),
    message_text text,
    message_type character varying(16) DEFAULT 'text'::character varying,
    status character varying(16) DEFAULT 'submitted'::character varying NOT NULL,
    status_code integer,
    operator character varying(64),
    country character varying(64),
    error_code character varying(32),
    error_message text,
    client_ref character varying(128),
    dlr_received_at timestamp without time zone,
    submitted_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    fallback_triggered boolean DEFAULT false NOT NULL,
    fallback_at timestamp without time zone,
    profile_id integer,
    channel character varying(16) DEFAULT 'sms'::character varying,
    provider character varying(32),
    fallback_from integer,
    latency_ms integer,
    retry_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    verified_at timestamp with time zone,
    flow_token character varying(64)
);


--
-- Name: sms_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sms_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sms_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sms_messages_id_seq OWNED BY public.sms_messages.id;


--
-- Name: sms_vendor_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_vendor_stats (
    id integer NOT NULL,
    operator character varying(64) NOT NULL,
    country character varying(64),
    sent integer DEFAULT 0,
    delivered integer DEFAULT 0,
    failed integer DEFAULT 0,
    pending integer DEFAULT 0,
    delivery_rate real,
    window_start timestamp without time zone NOT NULL,
    window_end timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sms_vendor_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sms_vendor_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sms_vendor_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sms_vendor_stats_id_seq OWNED BY public.sms_vendor_stats.id;


--
-- Name: smtp_sender_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.smtp_sender_profiles (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    email_address character varying(256) NOT NULL,
    reply_to character varying(256),
    communication_type character varying(64) DEFAULT 'general'::character varying NOT NULL,
    is_default boolean DEFAULT false,
    smtp_host character varying(256) DEFAULT 'smtp.gmail.com'::character varying NOT NULL,
    smtp_port integer DEFAULT 587 NOT NULL,
    smtp_user character varying(256) NOT NULL,
    smtp_pass character varying(512) NOT NULL,
    smtp_secure boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: smtp_sender_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.smtp_sender_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: smtp_sender_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.smtp_sender_profiles_id_seq OWNED BY public.smtp_sender_profiles.id;


--
-- Name: ssl_cert_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssl_cert_status (
    cert_id text NOT NULL,
    subject text NOT NULL,
    issuer text,
    expires_at timestamp without time zone,
    days_remaining integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    source text DEFAULT 'sippy_api'::text NOT NULL,
    auto_renew boolean DEFAULT false NOT NULL,
    checked_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: switches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.switches (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    type character varying(20) DEFAULT 'vos3000'::character varying NOT NULL,
    portal_url character varying(512),
    portal_username character varying(128),
    portal_password character varying(255),
    login_type integer DEFAULT 1,
    enabled boolean DEFAULT true,
    last_sync_at timestamp without time zone,
    last_sync_status character varying(512),
    created_at timestamp without time zone DEFAULT now(),
    api_admin_username character varying(128),
    api_admin_password character varying(255),
    admin_web_password character varying(255)
);


--
-- Name: switches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.switches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: switches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.switches_id_seq OWNED BY public.switches.id;


--
-- Name: synthetic_test_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synthetic_test_runs (
    id integer NOT NULL,
    campaign_id integer NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    total_calls integer DEFAULT 0 NOT NULL,
    connected_calls integer DEFAULT 0 NOT NULL,
    failed_calls integer DEFAULT 0 NOT NULL,
    asr real,
    avg_pdd_ms real,
    baseline_asr_at_run real,
    anomaly_fired boolean DEFAULT false NOT NULL,
    triggered_by character varying(20) DEFAULT 'scheduler'::character varying NOT NULL,
    infra_failures integer DEFAULT 0,
    carrier_failures integer DEFAULT 0,
    degraded_vs_last_run boolean DEFAULT false NOT NULL
);


--
-- Name: synthetic_test_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.synthetic_test_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: synthetic_test_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.synthetic_test_runs_id_seq OWNED BY public.synthetic_test_runs.id;


--
-- Name: tariff_change_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tariff_change_events (
    id integer NOT NULL,
    tariff_version_id integer NOT NULL,
    i_tariff character varying(64) NOT NULL,
    prefix character varying(32),
    destination character varying(256),
    change_type character varying(32) NOT NULL,
    old_interval_1 integer,
    new_interval_1 integer,
    old_interval_n integer,
    new_interval_n integer,
    old_price_1 real,
    new_price_1 real,
    old_price_n real,
    new_price_n real,
    old_connect_fee real,
    new_connect_fee real,
    old_grace_period integer,
    new_grace_period integer,
    old_surcharge real,
    new_surcharge real,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notification_sent boolean DEFAULT false,
    acknowledged boolean DEFAULT false,
    impact_score real
);


--
-- Name: TABLE tariff_change_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tariff_change_events IS 'Field-level delta records for each tariff version. Supports change type filtering for reconciliation engine.';


--
-- Name: COLUMN tariff_change_events.change_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_change_events.change_type IS 'added | removed | interval_changed | rate_changed | surcharge_changed | modified';


--
-- Name: COLUMN tariff_change_events.notification_sent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_change_events.notification_sent IS 'True when a commercial notification has been dispatched for this change.';


--
-- Name: COLUMN tariff_change_events.acknowledged; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_change_events.acknowledged IS 'True when the change has been acknowledged by an operator or counterparty.';


--
-- Name: COLUMN tariff_change_events.impact_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_change_events.impact_score IS 'Estimated monthly traffic impact in USD — populated by the impact analysis engine.';


--
-- Name: tariff_change_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tariff_change_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tariff_change_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tariff_change_events_id_seq OWNED BY public.tariff_change_events.id;


--
-- Name: tariff_profile_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tariff_profile_templates (
    id integer NOT NULL,
    name text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: tariff_profile_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tariff_profile_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tariff_profile_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tariff_profile_templates_id_seq OWNED BY public.tariff_profile_templates.id;


--
-- Name: tariff_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tariff_profiles (
    id integer NOT NULL,
    profile_name text NOT NULL,
    product_code text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tariff_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tariff_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tariff_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tariff_profiles_id_seq OWNED BY public.tariff_profiles.id;


--
-- Name: tariff_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tariff_versions (
    id integer NOT NULL,
    i_tariff character varying(64) NOT NULL,
    tariff_name character varying(256),
    source character varying(32) DEFAULT 'manual'::character varying NOT NULL,
    snapshot_json text NOT NULL,
    rate_count integer DEFAULT 0,
    effective_from timestamp with time zone,
    effective_to timestamp with time zone,
    notes text,
    created_by character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version_hash character varying(64),
    change_source character varying(32) DEFAULT 'MANUAL'::character varying
);


--
-- Name: TABLE tariff_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tariff_versions IS 'Immutable point-in-time snapshots of Sippy tariff rate lists. Required for Layer 4B rating verification and Layer 5 invoice automation.';


--
-- Name: COLUMN tariff_versions.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_versions.source IS 'manual | auto_snapshot | pre_change | post_change | morocco_workflow';


--
-- Name: COLUMN tariff_versions.snapshot_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_versions.snapshot_json IS 'Full JSON array of rate rows. Never mutated after insert.';


--
-- Name: COLUMN tariff_versions.version_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_versions.version_hash IS 'SHA-256 of snapshot_json — used for tamper detection and audit defense.';


--
-- Name: COLUMN tariff_versions.change_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_versions.change_source IS 'MANUAL | AUTO_SYNC | WORKFLOW | AI_RECOMMENDATION | IMPORT';


--
-- Name: tariff_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tariff_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tariff_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tariff_versions_id_seq OWNED BY public.tariff_versions.id;


--
-- Name: termination_chains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.termination_chains (
    id integer NOT NULL,
    name character varying(64) NOT NULL,
    description text,
    reve_profile_id integer,
    asterisk_trunk character varying(64) DEFAULT 'Sippy'::character varying NOT NULL,
    asterisk_host character varying(128) DEFAULT '159.223.32.59'::character varying NOT NULL,
    sippy_client_account_id integer,
    sippy_vendor_id integer,
    sippy_connection_id integer,
    sippy_routing_group_id integer,
    sippy_client_name character varying(128),
    sippy_vendor_name character varying(128),
    sippy_connection_name character varying(128),
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: termination_chains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.termination_chains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: termination_chains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.termination_chains_id_seq OWNED BY public.termination_chains.id;


--
-- Name: test_campaign_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_campaign_results (
    id integer NOT NULL,
    campaign_id integer NOT NULL,
    run_at timestamp without time zone DEFAULT now() NOT NULL,
    cld character varying(64) NOT NULL,
    cli character varying(64),
    label character varying(128),
    outcome character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    sip_code integer,
    duration_sec real,
    pdd_ms real,
    fas_detected boolean DEFAULT false,
    notes text
);


--
-- Name: test_campaign_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.test_campaign_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: test_campaign_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.test_campaign_results_id_seq OWNED BY public.test_campaign_results.id;


--
-- Name: test_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_campaigns (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    destinations text NOT NULL,
    schedule_type character varying(20) DEFAULT 'once'::character varying NOT NULL,
    scheduled_at timestamp without time zone,
    cron_hour integer,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    last_run_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    interval_minutes integer,
    next_run_at timestamp without time zone,
    enabled boolean DEFAULT true NOT NULL,
    baseline_asr real,
    baseline_pdd real
);


--
-- Name: test_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.test_campaigns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: test_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.test_campaigns_id_seq OWNED BY public.test_campaigns.id;


--
-- Name: traffic_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traffic_alerts (
    id integer NOT NULL,
    client_name character varying(128) NOT NULL,
    account_id character varying(32),
    kam_id integer,
    alert_type character varying(32) NOT NULL,
    prev_calls integer DEFAULT 0,
    curr_calls integer DEFAULT 0,
    email_sent boolean DEFAULT false,
    email_sent_at timestamp without time zone,
    resolved_at timestamp without time zone,
    triggered_at timestamp without time zone DEFAULT now()
);


--
-- Name: traffic_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.traffic_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: traffic_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.traffic_alerts_id_seq OWNED BY public.traffic_alerts.id;


--
-- Name: traffic_anomalies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traffic_anomalies (
    id integer NOT NULL,
    detected_at timestamp without time zone DEFAULT now(),
    concurrent integer NOT NULL,
    baseline_avg real NOT NULL,
    baseline_std_dev real NOT NULL,
    sigma_multiple real NOT NULL,
    is_business_hours boolean DEFAULT false,
    resolved_at timestamp without time zone,
    alert_sent boolean DEFAULT false,
    notes text
);


--
-- Name: traffic_anomalies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.traffic_anomalies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: traffic_anomalies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.traffic_anomalies_id_seq OWNED BY public.traffic_anomalies.id;


--
-- Name: traffic_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traffic_baselines (
    id integer NOT NULL,
    day_of_week integer NOT NULL,
    hour integer NOT NULL,
    avg_concurrent real DEFAULT 0,
    std_dev real DEFAULT 0,
    sample_count integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: traffic_baselines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.traffic_baselines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: traffic_baselines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.traffic_baselines_id_seq OWNED BY public.traffic_baselines.id;


--
-- Name: traffic_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traffic_snapshots (
    id integer NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now(),
    concurrent integer NOT NULL,
    day_of_week integer NOT NULL,
    hour integer NOT NULL
);


--
-- Name: traffic_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.traffic_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: traffic_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.traffic_snapshots_id_seq OWNED BY public.traffic_snapshots.id;


--
-- Name: user_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_config (
    user_id character varying NOT NULL,
    display_name character varying(128),
    phone character varying(30),
    department character varying(128),
    timezone character varying(64) DEFAULT 'UTC'::character varying,
    notification_email character varying(255),
    default_report_range character varying(30) DEFAULT 'Last 3 hr'::character varying,
    bio text,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_favorites (
    id integer NOT NULL,
    user_id text NOT NULL,
    module_key text NOT NULL,
    portal_key text,
    label text,
    icon text DEFAULT 'circle'::text NOT NULL,
    route text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: user_favorites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_favorites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_favorites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_favorites_id_seq OWNED BY public.user_favorites.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id character varying NOT NULL,
    role character varying(20) DEFAULT 'viewer'::character varying NOT NULL,
    assigned_at timestamp without time zone DEFAULT now(),
    assigned_by character varying,
    team_id character varying(64)
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id integer NOT NULL,
    session_id character varying(512) NOT NULL,
    user_id character varying(255) NOT NULL,
    ip_address character varying(64),
    user_agent text,
    last_activity timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    is_revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp without time zone,
    revoked_by character varying(255)
);


--
-- Name: user_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_sessions_id_seq OWNED BY public.user_sessions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    email character varying,
    first_name character varying,
    last_name character varying,
    profile_image_url character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: vendor_health_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_health_scores (
    id integer NOT NULL,
    vendor_name character varying(128) NOT NULL,
    scored_at timestamp without time zone DEFAULT now() NOT NULL,
    overall_score real NOT NULL,
    quality_score real,
    reliability_score real,
    fraud_score real,
    margin_score real,
    trend character varying(16),
    trend_delta real,
    details jsonb
);


--
-- Name: vendor_health_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_health_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_health_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_health_scores_id_seq OWNED BY public.vendor_health_scores.id;


--
-- Name: vendor_metric_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_metric_baselines (
    id integer NOT NULL,
    vendor character varying(128) NOT NULL,
    metric character varying(32) NOT NULL,
    mean real NOT NULL,
    stddev real NOT NULL,
    sample_count integer NOT NULL,
    window_hours integer DEFAULT 72 NOT NULL,
    computed_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_metric_baselines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_metric_baselines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_metric_baselines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_metric_baselines_id_seq OWNED BY public.vendor_metric_baselines.id;


--
-- Name: vendor_probe_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_probe_results (
    id integer NOT NULL,
    vendor_id character varying(32) NOT NULL,
    vendor_name character varying(255),
    connection_id character varying(32),
    connection_name character varying(255),
    host character varying(255),
    port integer DEFAULT 5060,
    probed_at timestamp without time zone DEFAULT now() NOT NULL,
    latency_ms integer,
    sip_response_code integer,
    reachable boolean DEFAULT false NOT NULL,
    error character varying(255)
);


--
-- Name: vendor_probe_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_probe_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_probe_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_probe_results_id_seq OWNED BY public.vendor_probe_results.id;


--
-- Name: vendor_product_prefixes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_product_prefixes (
    id integer NOT NULL,
    canonical_id integer NOT NULL,
    product_code character varying(1) NOT NULL,
    product_name character varying(32) NOT NULL,
    full_prefix character varying(5) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_product_prefixes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_product_prefixes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_product_prefixes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_product_prefixes_id_seq OWNED BY public.vendor_product_prefixes.id;


--
-- Name: vendor_stability_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_stability_snapshots (
    id integer NOT NULL,
    vendor character varying(128) NOT NULL,
    ts timestamp without time zone DEFAULT now() NOT NULL,
    q_score integer NOT NULL,
    asr real,
    ner real,
    avg_pdd real,
    fas_rate real,
    call_count integer DEFAULT 0 NOT NULL,
    stability character varying(20) DEFAULT 'unknown'::character varying NOT NULL
);


--
-- Name: vendor_stability_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_stability_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_stability_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_stability_snapshots_id_seq OWNED BY public.vendor_stability_snapshots.id;


--
-- Name: voice_otp_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_otp_calls (
    id integer NOT NULL,
    to_number character varying(32) NOT NULL,
    otp character varying(16) NOT NULL,
    trunk character varying(64) DEFAULT 'Sippy'::character varying,
    asterisk_id character varying(128),
    status character varying(16) DEFAULT 'initiated'::character varying NOT NULL,
    error_message text,
    initiated_at timestamp without time zone DEFAULT now() NOT NULL,
    answered_at timestamp without time zone,
    completed_at timestamp without time zone
);


--
-- Name: voice_otp_calls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.voice_otp_calls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: voice_otp_calls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.voice_otp_calls_id_seq OWNED BY public.voice_otp_calls.id;


--
-- Name: watcher_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watcher_recipients (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    display_name character varying(255),
    user_id character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    notify_approval_expiry boolean DEFAULT true NOT NULL
);


--
-- Name: watcher_recipients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.watcher_recipients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: watcher_recipients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.watcher_recipients_id_seq OWNED BY public.watcher_recipients.id;


--
-- Name: whatsapp_alert_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_alert_log (
    id integer NOT NULL,
    alert_type character varying(50) NOT NULL,
    recipient character varying(32) NOT NULL,
    message text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error_msg text,
    sent_at timestamp without time zone DEFAULT now()
);


--
-- Name: whatsapp_alert_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_alert_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_alert_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_alert_log_id_seq OWNED BY public.whatsapp_alert_log.id;


--
-- Name: workspace_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_definitions (
    id integer NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    description text,
    portal_slug text,
    domain_id text,
    icon text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_definitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workspace_definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workspace_definitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workspace_definitions_id_seq OWNED BY public.workspace_definitions.id;


--
-- Name: workspace_tab_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_tab_items (
    id integer NOT NULL,
    tab_id integer NOT NULL,
    route text NOT NULL,
    label text,
    icon text,
    sort_order integer DEFAULT 0,
    is_contextual boolean DEFAULT false NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    visibility_roles text[]
);


--
-- Name: workspace_tab_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workspace_tab_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workspace_tab_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workspace_tab_items_id_seq OWNED BY public.workspace_tab_items.id;


--
-- Name: workspace_tabs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_tabs (
    id integer NOT NULL,
    workspace_id integer NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    icon text,
    sort_order integer DEFAULT 0,
    is_visible boolean DEFAULT true NOT NULL,
    visibility_roles text[]
);


--
-- Name: workspace_tabs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workspace_tabs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workspace_tabs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workspace_tabs_id_seq OWNED BY public.workspace_tabs.id;


--
-- Name: account_actions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_actions ALTER COLUMN id SET DEFAULT nextval('public.account_actions_id_seq'::regclass);


--
-- Name: account_state id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_state ALTER COLUMN id SET DEFAULT nextval('public.account_state_id_seq'::regclass);


--
-- Name: account_state_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_state_history ALTER COLUMN id SET DEFAULT nextval('public.account_state_history_id_seq'::regclass);


--
-- Name: action_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_ledger ALTER COLUMN id SET DEFAULT nextval('public.action_ledger_id_seq'::regclass);


--
-- Name: adjustment_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustment_ledger ALTER COLUMN id SET DEFAULT nextval('public.adjustment_ledger_id_seq'::regclass);


--
-- Name: ai_ops_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_ops_events ALTER COLUMN id SET DEFAULT nextval('public.ai_ops_events_id_seq'::regclass);


--
-- Name: ai_ops_incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_ops_incidents ALTER COLUMN id SET DEFAULT nextval('public.ai_ops_incidents_id_seq'::regclass);


--
-- Name: ai_revenue_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_revenue_alerts ALTER COLUMN id SET DEFAULT nextval('public.ai_revenue_alerts_id_seq'::regclass);


--
-- Name: ai_scan_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scan_runs ALTER COLUMN id SET DEFAULT nextval('public.ai_scan_runs_id_seq'::regclass);


--
-- Name: alert_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules ALTER COLUMN id SET DEFAULT nextval('public.alert_rules_id_seq'::regclass);


--
-- Name: alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts ALTER COLUMN id SET DEFAULT nextval('public.alerts_id_seq'::regclass);


--
-- Name: anomaly_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anomaly_events ALTER COLUMN id SET DEFAULT nextval('public.anomaly_events_id_seq'::regclass);


--
-- Name: api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


--
-- Name: approval_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_audit_log ALTER COLUMN id SET DEFAULT nextval('public.approval_audit_log_id_seq'::regclass);


--
-- Name: approval_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests ALTER COLUMN id SET DEFAULT nextval('public.approval_requests_id_seq'::regclass);


--
-- Name: audit_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events ALTER COLUMN id SET DEFAULT nextval('public.audit_events_id_seq'::regclass);


--
-- Name: balance_alert_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_alert_events ALTER COLUMN id SET DEFAULT nextval('public.balance_alert_events_id_seq'::regclass);


--
-- Name: balance_alert_notification_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_alert_notification_settings ALTER COLUMN id SET DEFAULT nextval('public.balance_alert_notification_settings_id_seq'::regclass);


--
-- Name: balance_alert_thresholds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_alert_thresholds ALTER COLUMN id SET DEFAULT nextval('public.balance_alert_thresholds_id_seq'::regclass);


--
-- Name: bhaoo_balance_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bhaoo_balance_log ALTER COLUMN id SET DEFAULT nextval('public.bhaoo_balance_log_id_seq'::regclass);


--
-- Name: bhaoo_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bhaoo_profiles ALTER COLUMN id SET DEFAULT nextval('public.bhaoo_profiles_id_seq'::regclass);


--
-- Name: billing_disputes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_disputes ALTER COLUMN id SET DEFAULT nextval('public.billing_disputes_id_seq'::regclass);


--
-- Name: blacklist_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blacklist_rules ALTER COLUMN id SET DEFAULT nextval('public.blacklist_rules_id_seq'::regclass);


--
-- Name: branding_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branding_profiles ALTER COLUMN id SET DEFAULT nextval('public.branding_profiles_id_seq'::regclass);


--
-- Name: call_governance_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_governance_log ALTER COLUMN id SET DEFAULT nextval('public.call_governance_log_id_seq'::regclass);


--
-- Name: call_governance_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_governance_rules ALTER COLUMN id SET DEFAULT nextval('public.call_governance_rules_id_seq'::regclass);


--
-- Name: call_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_snapshots ALTER COLUMN id SET DEFAULT nextval('public.call_snapshots_id_seq'::regclass);


--
-- Name: call_test_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_test_logs ALTER COLUMN id SET DEFAULT nextval('public.call_test_logs_id_seq'::regclass);


--
-- Name: calls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls ALTER COLUMN id SET DEFAULT nextval('public.calls_id_seq'::regclass);


--
-- Name: canonical_vendors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_vendors ALTER COLUMN id SET DEFAULT nextval('public.canonical_vendors_id_seq'::regclass);


--
-- Name: cap_alert_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_events ALTER COLUMN id SET DEFAULT nextval('public.cap_alert_events_id_seq'::regclass);


--
-- Name: carrier_quality_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carrier_quality_scores ALTER COLUMN id SET DEFAULT nextval('public.carrier_quality_scores_id_seq'::regclass);


--
-- Name: carrier_reconciliations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carrier_reconciliations ALTER COLUMN id SET DEFAULT nextval('public.carrier_reconciliations_id_seq'::regclass);


--
-- Name: cdr_anomaly_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_anomaly_batches ALTER COLUMN id SET DEFAULT nextval('public.cdr_anomaly_batches_id_seq'::regclass);


--
-- Name: cdr_recon_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_recon_rows ALTER COLUMN id SET DEFAULT nextval('public.cdr_recon_rows_id_seq'::regclass);


--
-- Name: cdr_recon_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_recon_sessions ALTER COLUMN id SET DEFAULT nextval('public.cdr_recon_sessions_id_seq'::regclass);


--
-- Name: cdr_rerate_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_rerate_runs ALTER COLUMN id SET DEFAULT nextval('public.cdr_rerate_runs_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: chat_rooms id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms ALTER COLUMN id SET DEFAULT nextval('public.chat_rooms_id_seq'::regclass);


--
-- Name: client_branding_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_branding_profiles ALTER COLUMN id SET DEFAULT nextval('public.client_branding_profiles_id_seq'::regclass);


--
-- Name: client_identity_map id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_identity_map ALTER COLUMN id SET DEFAULT nextval('public.client_identity_map_id_seq'::regclass);


--
-- Name: client_ip_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_ip_requests ALTER COLUMN id SET DEFAULT nextval('public.client_ip_requests_id_seq'::regclass);


--
-- Name: client_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_profiles ALTER COLUMN id SET DEFAULT nextval('public.client_profiles_id_seq'::regclass);


--
-- Name: client_revenue_reconciliations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_revenue_reconciliations ALTER COLUMN id SET DEFAULT nextval('public.client_revenue_reconciliations_id_seq'::regclass);


--
-- Name: collection_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_events ALTER COLUMN id SET DEFAULT nextval('public.collection_events_id_seq'::regclass);


--
-- Name: commercial_notification_recipients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_notification_recipients ALTER COLUMN id SET DEFAULT nextval('public.commercial_notification_recipients_id_seq'::regclass);


--
-- Name: commercial_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_notifications ALTER COLUMN id SET DEFAULT nextval('public.commercial_notifications_id_seq'::regclass);


--
-- Name: communication_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_policies ALTER COLUMN id SET DEFAULT nextval('public.communication_policies_id_seq'::regclass);


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: company_bank_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_bank_accounts ALTER COLUMN id SET DEFAULT nextval('public.company_bank_accounts_id_seq'::regclass);


--
-- Name: company_contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_contacts ALTER COLUMN id SET DEFAULT nextval('public.company_contacts_id_seq'::regclass);


--
-- Name: concurrent_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concurrent_snapshots ALTER COLUMN id SET DEFAULT nextval('public.concurrent_snapshots_id_seq'::regclass);


--
-- Name: connection_vendor_cache2 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connection_vendor_cache2 ALTER COLUMN id SET DEFAULT nextval('public.connection_vendor_cache2_id_seq'::regclass);


--
-- Name: console_incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.console_incidents ALTER COLUMN id SET DEFAULT nextval('public.console_incidents_id_seq'::regclass);


--
-- Name: copilot_result_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_result_cache ALTER COLUMN id SET DEFAULT nextval('public.copilot_result_cache_id_seq'::regclass);


--
-- Name: credit_control_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_control_rules ALTER COLUMN id SET DEFAULT nextval('public.credit_control_rules_id_seq'::regclass);


--
-- Name: credit_notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes ALTER COLUMN id SET DEFAULT nextval('public.credit_notes_id_seq'::regclass);


--
-- Name: customer_product_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_product_assignments ALTER COLUMN id SET DEFAULT nextval('public.customer_product_assignments_id_seq'::regclass);


--
-- Name: daily_minutes_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_minutes_reports ALTER COLUMN id SET DEFAULT nextval('public.daily_minutes_reports_id_seq'::regclass);


--
-- Name: data_retention_policy id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_retention_policy ALTER COLUMN id SET DEFAULT nextval('public.data_retention_policy_id_seq'::regclass);


--
-- Name: deal_approvals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_approvals ALTER COLUMN id SET DEFAULT nextval('public.deal_approvals_id_seq'::regclass);


--
-- Name: deal_destinations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_destinations ALTER COLUMN id SET DEFAULT nextval('public.deal_destinations_id_seq'::regclass);


--
-- Name: deal_workspace id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_workspace ALTER COLUMN id SET DEFAULT nextval('public.deal_workspace_id_seq'::regclass);


--
-- Name: deals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals ALTER COLUMN id SET DEFAULT nextval('public.deals_id_seq'::regclass);


--
-- Name: deletion_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests ALTER COLUMN id SET DEFAULT nextval('public.deletion_requests_id_seq'::regclass);


--
-- Name: destination_product_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_product_rates ALTER COLUMN id SET DEFAULT nextval('public.destination_product_rates_id_seq'::regclass);


--
-- Name: destination_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_rates ALTER COLUMN id SET DEFAULT nextval('public.destination_rates_id_seq'::regclass);


--
-- Name: destination_sets_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_sets_cache ALTER COLUMN id SET DEFAULT nextval('public.destination_sets_cache_id_seq'::regclass);


--
-- Name: dispute_case_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_case_events ALTER COLUMN id SET DEFAULT nextval('public.dispute_case_events_id_seq'::regclass);


--
-- Name: dispute_cases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_cases ALTER COLUMN id SET DEFAULT nextval('public.dispute_cases_id_seq'::regclass);


--
-- Name: entity_presence_registry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_presence_registry ALTER COLUMN id SET DEFAULT nextval('public.entity_presence_registry_id_seq'::regclass);


--
-- Name: execution_health_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_health_log ALTER COLUMN id SET DEFAULT nextval('public.execution_health_log_id_seq'::regclass);


--
-- Name: failover_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failover_executions ALTER COLUMN id SET DEFAULT nextval('public.failover_executions_id_seq'::regclass);


--
-- Name: fas_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fas_events ALTER COLUMN id SET DEFAULT nextval('public.fas_events_id_seq'::regclass);


--
-- Name: fix_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fix_history ALTER COLUMN id SET DEFAULT nextval('public.fix_history_id_seq'::regclass);


--
-- Name: global_destinations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_destinations ALTER COLUMN id SET DEFAULT nextval('public.global_destinations_id_seq'::regclass);


--
-- Name: governed_calls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governed_calls ALTER COLUMN id SET DEFAULT nextval('public.governed_calls_id_seq'::regclass);


--
-- Name: host_outage_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.host_outage_log ALTER COLUMN id SET DEFAULT nextval('public.host_outage_log_id_seq'::regclass);


--
-- Name: incident_lifecycle_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_lifecycle_events ALTER COLUMN id SET DEFAULT nextval('public.incident_lifecycle_events_id_seq'::regclass);


--
-- Name: incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents ALTER COLUMN id SET DEFAULT nextval('public.incidents_id_seq'::regclass);


--
-- Name: intelligent_failover_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligent_failover_policies ALTER COLUMN id SET DEFAULT nextval('public.intelligent_failover_policies_id_seq'::regclass);


--
-- Name: invoice_cdr_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_cdr_snapshots ALTER COLUMN id SET DEFAULT nextval('public.invoice_cdr_snapshots_id_seq'::regclass);


--
-- Name: invoice_email_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_email_deliveries ALTER COLUMN id SET DEFAULT nextval('public.invoice_email_deliveries_id_seq'::regclass);


--
-- Name: invoice_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_jobs ALTER COLUMN id SET DEFAULT nextval('public.invoice_jobs_id_seq'::regclass);


--
-- Name: invoice_line_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_line_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_line_items_id_seq'::regclass);


--
-- Name: invoice_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_schedules ALTER COLUMN id SET DEFAULT nextval('public.invoice_schedules_id_seq'::regclass);


--
-- Name: invoice_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_templates ALTER COLUMN id SET DEFAULT nextval('public.invoice_templates_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: ip_restrictions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_restrictions ALTER COLUMN id SET DEFAULT nextval('public.ip_restrictions_id_seq'::regclass);


--
-- Name: ip_sharing_approvals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_sharing_approvals ALTER COLUMN id SET DEFAULT nextval('public.ip_sharing_approvals_id_seq'::regclass);


--
-- Name: irsf_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.irsf_events ALTER COLUMN id SET DEFAULT nextval('public.irsf_events_id_seq'::regclass);


--
-- Name: kam_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kam_accounts ALTER COLUMN id SET DEFAULT nextval('public.kam_accounts_id_seq'::regclass);


--
-- Name: kams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kams ALTER COLUMN id SET DEFAULT nextval('public.kams_id_seq'::regclass);


--
-- Name: margin_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margin_alerts ALTER COLUMN id SET DEFAULT nextval('public.margin_alerts_id_seq'::regclass);


--
-- Name: margin_analytics_daily id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margin_analytics_daily ALTER COLUMN id SET DEFAULT nextval('public.margin_analytics_daily_id_seq'::regclass);


--
-- Name: metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics ALTER COLUMN id SET DEFAULT nextval('public.metrics_id_seq'::regclass);


--
-- Name: mfa_secrets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_secrets ALTER COLUMN id SET DEFAULT nextval('public.mfa_secrets_id_seq'::regclass);


--
-- Name: monitored_hosts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitored_hosts ALTER COLUMN id SET DEFAULT nextval('public.monitored_hosts_id_seq'::regclass);


--
-- Name: mos_hourly id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mos_hourly ALTER COLUMN id SET DEFAULT nextval('public.mos_hourly_id_seq'::regclass);


--
-- Name: navigation_modules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navigation_modules ALTER COLUMN id SET DEFAULT nextval('public.navigation_modules_id_seq'::regclass);


--
-- Name: noc_incident_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noc_incident_assignments ALTER COLUMN id SET DEFAULT nextval('public.noc_incident_assignments_id_seq'::regclass);


--
-- Name: noc_incident_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noc_incident_events ALTER COLUMN id SET DEFAULT nextval('public.noc_incident_events_id_seq'::regclass);


--
-- Name: noc_incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noc_incidents ALTER COLUMN id SET DEFAULT nextval('public.noc_incidents_id_seq'::regclass);


--
-- Name: number_lookup_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_lookup_cache ALTER COLUMN id SET DEFAULT nextval('public.number_lookup_cache_id_seq'::regclass);


--
-- Name: outage_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outage_log ALTER COLUMN id SET DEFAULT nextval('public.outage_log_id_seq'::regclass);


--
-- Name: partner_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_profiles ALTER COLUMN id SET DEFAULT nextval('public.partner_profiles_id_seq'::regclass);


--
-- Name: payment_reminder_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_reminder_config ALTER COLUMN id SET DEFAULT nextval('public.payment_reminder_config_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: portal_access_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_access_tokens ALTER COLUMN id SET DEFAULT nextval('public.portal_access_tokens_id_seq'::regclass);


--
-- Name: portal_definitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_definitions ALTER COLUMN id SET DEFAULT nextval('public.portal_definitions_id_seq'::regclass);


--
-- Name: portal_module_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_module_assignments ALTER COLUMN id SET DEFAULT nextval('public.portal_module_assignments_id_seq'::regclass);


--
-- Name: portal_sections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sections ALTER COLUMN id SET DEFAULT nextval('public.portal_sections_id_seq'::regclass);


--
-- Name: portal_ticket_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_ticket_messages ALTER COLUMN id SET DEFAULT nextval('public.portal_ticket_messages_id_seq'::regclass);


--
-- Name: portal_tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_tickets ALTER COLUMN id SET DEFAULT nextval('public.portal_tickets_id_seq'::regclass);


--
-- Name: prefix_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prefix_audit_log ALTER COLUMN id SET DEFAULT nextval('public.prefix_audit_log_id_seq'::regclass);


--
-- Name: pricing_template_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_template_rates ALTER COLUMN id SET DEFAULT nextval('public.pricing_template_rates_id_seq'::regclass);


--
-- Name: pricing_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_templates ALTER COLUMN id SET DEFAULT nextval('public.pricing_templates_id_seq'::regclass);


--
-- Name: product_destination_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_destination_assignments ALTER COLUMN id SET DEFAULT nextval('public.product_destination_assignments_id_seq'::regclass);


--
-- Name: product_docs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_docs ALTER COLUMN id SET DEFAULT nextval('public.product_docs_id_seq'::regclass);


--
-- Name: product_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_history ALTER COLUMN id SET DEFAULT nextval('public.product_history_id_seq'::regclass);


--
-- Name: product_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_rates ALTER COLUMN id SET DEFAULT nextval('public.product_rates_id_seq'::regclass);


--
-- Name: product_registry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_registry ALTER COLUMN id SET DEFAULT nextval('public.product_registry_id_seq'::regclass);


--
-- Name: provisioning_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provisioning_jobs ALTER COLUMN id SET DEFAULT nextval('public.provisioning_jobs_id_seq'::regclass);


--
-- Name: quality_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_events ALTER COLUMN id SET DEFAULT nextval('public.quality_events_id_seq'::regclass);


--
-- Name: rate_card_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_card_entries ALTER COLUMN id SET DEFAULT nextval('public.rate_card_entries_id_seq'::regclass);


--
-- Name: rate_cards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_cards ALTER COLUMN id SET DEFAULT nextval('public.rate_cards_id_seq'::regclass);


--
-- Name: rate_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_notifications ALTER COLUMN id SET DEFAULT nextval('public.rate_notifications_id_seq'::regclass);


--
-- Name: rate_push_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_push_jobs ALTER COLUMN id SET DEFAULT nextval('public.rate_push_jobs_id_seq'::regclass);


--
-- Name: rating_verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_verifications ALTER COLUMN id SET DEFAULT nextval('public.rating_verifications_id_seq'::regclass);


--
-- Name: rbac_permission_audit_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permission_audit_events ALTER COLUMN id SET DEFAULT nextval('public.rbac_permission_audit_events_id_seq'::regclass);


--
-- Name: rbac_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permissions ALTER COLUMN id SET DEFAULT nextval('public.rbac_permissions_id_seq'::regclass);


--
-- Name: rbac_role_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions ALTER COLUMN id SET DEFAULT nextval('public.rbac_role_permissions_id_seq'::regclass);


--
-- Name: rbac_user_permission_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_permission_overrides ALTER COLUMN id SET DEFAULT nextval('public.rbac_user_permission_overrides_id_seq'::regclass);


--
-- Name: recommendation_outcomes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_outcomes ALTER COLUMN id SET DEFAULT nextval('public.recommendation_outcomes_id_seq'::regclass);


--
-- Name: reconciliation_email_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_email_log ALTER COLUMN id SET DEFAULT nextval('public.reconciliation_email_log_id_seq'::regclass);


--
-- Name: reconciliation_report_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_report_schedules ALTER COLUMN id SET DEFAULT nextval('public.reconciliation_report_schedules_id_seq'::regclass);


--
-- Name: report_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_jobs ALTER COLUMN id SET DEFAULT nextval('public.report_jobs_id_seq'::regclass);


--
-- Name: reseller_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reseller_profiles ALTER COLUMN id SET DEFAULT nextval('public.reseller_profiles_id_seq'::regclass);


--
-- Name: route_decision_traces id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_decision_traces ALTER COLUMN id SET DEFAULT nextval('public.route_decision_traces_id_seq'::regclass);


--
-- Name: route_health_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_health_scores ALTER COLUMN id SET DEFAULT nextval('public.route_health_scores_id_seq'::regclass);


--
-- Name: route_quality_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_quality_snapshots ALTER COLUMN id SET DEFAULT nextval('public.route_quality_snapshots_id_seq'::regclass);


--
-- Name: route_test_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_test_jobs ALTER COLUMN id SET DEFAULT nextval('public.route_test_jobs_id_seq'::regclass);


--
-- Name: route_test_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_test_results ALTER COLUMN id SET DEFAULT nextval('public.route_test_results_id_seq'::regclass);


--
-- Name: routing_cache_meta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_cache_meta ALTER COLUMN id SET DEFAULT nextval('public.routing_cache_meta_id_seq'::regclass);


--
-- Name: routing_groups_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_groups_cache ALTER COLUMN id SET DEFAULT nextval('public.routing_groups_cache_id_seq'::regclass);


--
-- Name: routing_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_rules ALTER COLUMN id SET DEFAULT nextval('public.routing_rules_id_seq'::regclass);


--
-- Name: routing_suggestions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_suggestions ALTER COLUMN id SET DEFAULT nextval('public.routing_suggestions_id_seq'::regclass);


--
-- Name: routing_template_vendors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_template_vendors ALTER COLUMN id SET DEFAULT nextval('public.routing_template_vendors_id_seq'::regclass);


--
-- Name: routing_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_templates ALTER COLUMN id SET DEFAULT nextval('public.routing_templates_id_seq'::regclass);


--
-- Name: rtp_quality_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtp_quality_history ALTER COLUMN id SET DEFAULT nextval('public.rtp_quality_history_id_seq'::regclass);


--
-- Name: rtp_quality_stats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtp_quality_stats ALTER COLUMN id SET DEFAULT nextval('public.rtp_quality_stats_id_seq'::regclass);


--
-- Name: sbc_hosts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sbc_hosts ALTER COLUMN id SET DEFAULT nextval('public.sbc_hosts_id_seq'::regclass);


--
-- Name: scheduled_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_reports ALTER COLUMN id SET DEFAULT nextval('public.scheduled_reports_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: simbox_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simbox_scores ALTER COLUMN id SET DEFAULT nextval('public.simbox_scores_id_seq'::regclass);


--
-- Name: sip_error_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sip_error_history ALTER COLUMN id SET DEFAULT nextval('public.sip_error_history_id_seq'::regclass);


--
-- Name: sip_error_stats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sip_error_stats ALTER COLUMN id SET DEFAULT nextval('public.sip_error_stats_id_seq'::regclass);


--
-- Name: sippy_change_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sippy_change_events ALTER COLUMN id SET DEFAULT nextval('public.sippy_change_events_id_seq'::regclass);


--
-- Name: sla_breach_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_breach_log ALTER COLUMN id SET DEFAULT nextval('public.sla_breach_log_id_seq'::regclass);


--
-- Name: sms_dlr_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_dlr_events ALTER COLUMN id SET DEFAULT nextval('public.sms_dlr_events_id_seq'::regclass);


--
-- Name: sms_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages ALTER COLUMN id SET DEFAULT nextval('public.sms_messages_id_seq'::regclass);


--
-- Name: sms_vendor_stats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_vendor_stats ALTER COLUMN id SET DEFAULT nextval('public.sms_vendor_stats_id_seq'::regclass);


--
-- Name: smtp_sender_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smtp_sender_profiles ALTER COLUMN id SET DEFAULT nextval('public.smtp_sender_profiles_id_seq'::regclass);


--
-- Name: switches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switches ALTER COLUMN id SET DEFAULT nextval('public.switches_id_seq'::regclass);


--
-- Name: synthetic_test_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_test_runs ALTER COLUMN id SET DEFAULT nextval('public.synthetic_test_runs_id_seq'::regclass);


--
-- Name: tariff_change_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_change_events ALTER COLUMN id SET DEFAULT nextval('public.tariff_change_events_id_seq'::regclass);


--
-- Name: tariff_profile_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_profile_templates ALTER COLUMN id SET DEFAULT nextval('public.tariff_profile_templates_id_seq'::regclass);


--
-- Name: tariff_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_profiles ALTER COLUMN id SET DEFAULT nextval('public.tariff_profiles_id_seq'::regclass);


--
-- Name: tariff_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_versions ALTER COLUMN id SET DEFAULT nextval('public.tariff_versions_id_seq'::regclass);


--
-- Name: termination_chains id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termination_chains ALTER COLUMN id SET DEFAULT nextval('public.termination_chains_id_seq'::regclass);


--
-- Name: test_campaign_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_campaign_results ALTER COLUMN id SET DEFAULT nextval('public.test_campaign_results_id_seq'::regclass);


--
-- Name: test_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_campaigns ALTER COLUMN id SET DEFAULT nextval('public.test_campaigns_id_seq'::regclass);


--
-- Name: traffic_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_alerts ALTER COLUMN id SET DEFAULT nextval('public.traffic_alerts_id_seq'::regclass);


--
-- Name: traffic_anomalies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_anomalies ALTER COLUMN id SET DEFAULT nextval('public.traffic_anomalies_id_seq'::regclass);


--
-- Name: traffic_baselines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_baselines ALTER COLUMN id SET DEFAULT nextval('public.traffic_baselines_id_seq'::regclass);


--
-- Name: traffic_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_snapshots ALTER COLUMN id SET DEFAULT nextval('public.traffic_snapshots_id_seq'::regclass);


--
-- Name: user_favorites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorites ALTER COLUMN id SET DEFAULT nextval('public.user_favorites_id_seq'::regclass);


--
-- Name: user_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions ALTER COLUMN id SET DEFAULT nextval('public.user_sessions_id_seq'::regclass);


--
-- Name: vendor_health_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_health_scores ALTER COLUMN id SET DEFAULT nextval('public.vendor_health_scores_id_seq'::regclass);


--
-- Name: vendor_metric_baselines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_metric_baselines ALTER COLUMN id SET DEFAULT nextval('public.vendor_metric_baselines_id_seq'::regclass);


--
-- Name: vendor_probe_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_probe_results ALTER COLUMN id SET DEFAULT nextval('public.vendor_probe_results_id_seq'::regclass);


--
-- Name: vendor_product_prefixes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_prefixes ALTER COLUMN id SET DEFAULT nextval('public.vendor_product_prefixes_id_seq'::regclass);


--
-- Name: vendor_stability_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_stability_snapshots ALTER COLUMN id SET DEFAULT nextval('public.vendor_stability_snapshots_id_seq'::regclass);


--
-- Name: voice_otp_calls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_otp_calls ALTER COLUMN id SET DEFAULT nextval('public.voice_otp_calls_id_seq'::regclass);


--
-- Name: watcher_recipients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watcher_recipients ALTER COLUMN id SET DEFAULT nextval('public.watcher_recipients_id_seq'::regclass);


--
-- Name: whatsapp_alert_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_alert_log ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_alert_log_id_seq'::regclass);


--
-- Name: workspace_definitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_definitions ALTER COLUMN id SET DEFAULT nextval('public.workspace_definitions_id_seq'::regclass);


--
-- Name: workspace_tab_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tab_items ALTER COLUMN id SET DEFAULT nextval('public.workspace_tab_items_id_seq'::regclass);


--
-- Name: workspace_tabs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tabs ALTER COLUMN id SET DEFAULT nextval('public.workspace_tabs_id_seq'::regclass);


--
-- Name: account_actions account_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_actions
    ADD CONSTRAINT account_actions_pkey PRIMARY KEY (id);


--
-- Name: account_caps account_caps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_caps
    ADD CONSTRAINT account_caps_pkey PRIMARY KEY (account_id);


--
-- Name: account_configs account_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_configs
    ADD CONSTRAINT account_configs_pkey PRIMARY KEY (i_account);


--
-- Name: account_state account_state_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_state
    ADD CONSTRAINT account_state_account_id_key UNIQUE (account_id);


--
-- Name: account_state_history account_state_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_state_history
    ADD CONSTRAINT account_state_history_pkey PRIMARY KEY (id);


--
-- Name: account_state account_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_state
    ADD CONSTRAINT account_state_pkey PRIMARY KEY (id);


--
-- Name: action_ledger action_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_ledger
    ADD CONSTRAINT action_ledger_pkey PRIMARY KEY (id);


--
-- Name: adjustment_ledger adjustment_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustment_ledger
    ADD CONSTRAINT adjustment_ledger_pkey PRIMARY KEY (id);


--
-- Name: ai_ops_events ai_ops_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_ops_events
    ADD CONSTRAINT ai_ops_events_pkey PRIMARY KEY (id);


--
-- Name: ai_ops_incidents ai_ops_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_ops_incidents
    ADD CONSTRAINT ai_ops_incidents_pkey PRIMARY KEY (id);


--
-- Name: ai_revenue_alerts ai_revenue_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_revenue_alerts
    ADD CONSTRAINT ai_revenue_alerts_pkey PRIMARY KEY (id);


--
-- Name: ai_scan_runs ai_scan_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scan_runs
    ADD CONSTRAINT ai_scan_runs_pkey PRIMARY KEY (id);


--
-- Name: alert_rules alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: anomaly_events anomaly_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anomaly_events
    ADD CONSTRAINT anomaly_events_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: approval_audit_log approval_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_audit_log
    ADD CONSTRAINT approval_audit_log_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: balance_alert_events balance_alert_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_alert_events
    ADD CONSTRAINT balance_alert_events_pkey PRIMARY KEY (id);


--
-- Name: balance_alert_notification_settings balance_alert_notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_alert_notification_settings
    ADD CONSTRAINT balance_alert_notification_settings_pkey PRIMARY KEY (id);


--
-- Name: balance_alert_thresholds balance_alert_thresholds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_alert_thresholds
    ADD CONSTRAINT balance_alert_thresholds_pkey PRIMARY KEY (id);


--
-- Name: bhaoo_balance_log bhaoo_balance_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bhaoo_balance_log
    ADD CONSTRAINT bhaoo_balance_log_pkey PRIMARY KEY (id);


--
-- Name: bhaoo_profiles bhaoo_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bhaoo_profiles
    ADD CONSTRAINT bhaoo_profiles_pkey PRIMARY KEY (id);


--
-- Name: billing_disputes billing_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_disputes
    ADD CONSTRAINT billing_disputes_pkey PRIMARY KEY (id);


--
-- Name: blacklist_rules blacklist_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blacklist_rules
    ADD CONSTRAINT blacklist_rules_pkey PRIMARY KEY (id);


--
-- Name: branding_profiles branding_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branding_profiles
    ADD CONSTRAINT branding_profiles_pkey PRIMARY KEY (id);


--
-- Name: call_governance_log call_governance_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_governance_log
    ADD CONSTRAINT call_governance_log_pkey PRIMARY KEY (id);


--
-- Name: call_governance_rules call_governance_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_governance_rules
    ADD CONSTRAINT call_governance_rules_pkey PRIMARY KEY (id);


--
-- Name: call_snapshots call_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_snapshots
    ADD CONSTRAINT call_snapshots_pkey PRIMARY KEY (id);


--
-- Name: call_snapshots call_snapshots_sippy_call_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_snapshots
    ADD CONSTRAINT call_snapshots_sippy_call_id_unique UNIQUE (sippy_call_id);


--
-- Name: call_test_logs call_test_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_test_logs
    ADD CONSTRAINT call_test_logs_pkey PRIMARY KEY (id);


--
-- Name: calls calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_pkey PRIMARY KEY (id);


--
-- Name: canonical_vendors canonical_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_vendors
    ADD CONSTRAINT canonical_vendors_pkey PRIMARY KEY (id);


--
-- Name: canonical_vendors canonical_vendors_vendor_prefix_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_vendors
    ADD CONSTRAINT canonical_vendors_vendor_prefix_unique UNIQUE (vendor_prefix);


--
-- Name: cap_alert_events cap_alert_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_events
    ADD CONSTRAINT cap_alert_events_pkey PRIMARY KEY (id);


--
-- Name: carrier_quality_scores carrier_quality_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carrier_quality_scores
    ADD CONSTRAINT carrier_quality_scores_pkey PRIMARY KEY (id);


--
-- Name: carrier_reconciliations carrier_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carrier_reconciliations
    ADD CONSTRAINT carrier_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: cdr_anomaly_batches cdr_anomaly_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_anomaly_batches
    ADD CONSTRAINT cdr_anomaly_batches_pkey PRIMARY KEY (id);


--
-- Name: cdr_recon_rows cdr_recon_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_recon_rows
    ADD CONSTRAINT cdr_recon_rows_pkey PRIMARY KEY (id);


--
-- Name: cdr_recon_sessions cdr_recon_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_recon_sessions
    ADD CONSTRAINT cdr_recon_sessions_pkey PRIMARY KEY (id);


--
-- Name: cdr_rerate_runs cdr_rerate_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_rerate_runs
    ADD CONSTRAINT cdr_rerate_runs_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_rooms chat_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_pkey PRIMARY KEY (id);


--
-- Name: chat_rooms chat_rooms_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_slug_unique UNIQUE (slug);


--
-- Name: client_branding_profiles client_branding_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_branding_profiles
    ADD CONSTRAINT client_branding_profiles_pkey PRIMARY KEY (id);


--
-- Name: client_identity_map client_identity_map_i_account_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_identity_map
    ADD CONSTRAINT client_identity_map_i_account_key UNIQUE (i_account);


--
-- Name: client_identity_map client_identity_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_identity_map
    ADD CONSTRAINT client_identity_map_pkey PRIMARY KEY (id);


--
-- Name: client_ip_requests client_ip_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_ip_requests
    ADD CONSTRAINT client_ip_requests_pkey PRIMARY KEY (id);


--
-- Name: client_profiles client_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_profiles
    ADD CONSTRAINT client_profiles_pkey PRIMARY KEY (id);


--
-- Name: client_revenue_reconciliations client_revenue_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_revenue_reconciliations
    ADD CONSTRAINT client_revenue_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: collection_events collection_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_events
    ADD CONSTRAINT collection_events_pkey PRIMARY KEY (id);


--
-- Name: commercial_notification_recipients commercial_notification_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_notification_recipients
    ADD CONSTRAINT commercial_notification_recipients_pkey PRIMARY KEY (id);


--
-- Name: commercial_notification_recipients commercial_notification_recipients_tracking_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_notification_recipients
    ADD CONSTRAINT commercial_notification_recipients_tracking_token_key UNIQUE (tracking_token);


--
-- Name: commercial_notifications commercial_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_notifications
    ADD CONSTRAINT commercial_notifications_pkey PRIMARY KEY (id);


--
-- Name: communication_policies communication_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_policies
    ADD CONSTRAINT communication_policies_pkey PRIMARY KEY (id);


--
-- Name: companies companies_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_name_key UNIQUE (name);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: companies companies_short_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_short_code_key UNIQUE (short_code);


--
-- Name: company_bank_accounts company_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_bank_accounts
    ADD CONSTRAINT company_bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: company_contacts company_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_contacts
    ADD CONSTRAINT company_contacts_pkey PRIMARY KEY (id);


--
-- Name: concurrent_snapshots concurrent_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concurrent_snapshots
    ADD CONSTRAINT concurrent_snapshots_pkey PRIMARY KEY (id);


--
-- Name: connection_vendor_cache2 connection_vendor_cache2_i_connection_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connection_vendor_cache2
    ADD CONSTRAINT connection_vendor_cache2_i_connection_key UNIQUE (i_connection);


--
-- Name: connection_vendor_cache2 connection_vendor_cache2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connection_vendor_cache2
    ADD CONSTRAINT connection_vendor_cache2_pkey PRIMARY KEY (id);


--
-- Name: console_incidents console_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.console_incidents
    ADD CONSTRAINT console_incidents_pkey PRIMARY KEY (id);


--
-- Name: console_incidents console_incidents_window_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.console_incidents
    ADD CONSTRAINT console_incidents_window_hash_key UNIQUE (window_hash);


--
-- Name: copilot_503_settings copilot_503_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_503_settings
    ADD CONSTRAINT copilot_503_settings_pkey PRIMARY KEY (id);


--
-- Name: copilot_result_cache copilot_result_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.copilot_result_cache
    ADD CONSTRAINT copilot_result_cache_pkey PRIMARY KEY (id);


--
-- Name: credit_control_rules credit_control_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_control_rules
    ADD CONSTRAINT credit_control_rules_pkey PRIMARY KEY (id);


--
-- Name: credit_notes credit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);


--
-- Name: credit_notes credit_notes_reference_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_reference_id_key UNIQUE (reference_id);


--
-- Name: customer_product_assignments customer_product_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_product_assignments
    ADD CONSTRAINT customer_product_assignments_pkey PRIMARY KEY (id);


--
-- Name: daily_minutes_reports daily_minutes_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_minutes_reports
    ADD CONSTRAINT daily_minutes_reports_pkey PRIMARY KEY (id);


--
-- Name: dashboard_widget_prefs dashboard_widget_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_widget_prefs
    ADD CONSTRAINT dashboard_widget_prefs_pkey PRIMARY KEY (user_id);


--
-- Name: data_retention_policy data_retention_policy_data_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_retention_policy
    ADD CONSTRAINT data_retention_policy_data_type_key UNIQUE (data_type);


--
-- Name: data_retention_policy data_retention_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_retention_policy
    ADD CONSTRAINT data_retention_policy_pkey PRIMARY KEY (id);


--
-- Name: deal_approvals deal_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_approvals
    ADD CONSTRAINT deal_approvals_pkey PRIMARY KEY (id);


--
-- Name: deal_destinations deal_destinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_destinations
    ADD CONSTRAINT deal_destinations_pkey PRIMARY KEY (id);


--
-- Name: deal_workspace deal_workspace_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_workspace
    ADD CONSTRAINT deal_workspace_pkey PRIMARY KEY (id);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: deletion_requests deletion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_pkey PRIMARY KEY (id);


--
-- Name: destination_product_rates destination_product_rates_destination_id_product_prefix_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_product_rates
    ADD CONSTRAINT destination_product_rates_destination_id_product_prefix_key UNIQUE (destination_id, product_prefix);


--
-- Name: destination_product_rates destination_product_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_product_rates
    ADD CONSTRAINT destination_product_rates_pkey PRIMARY KEY (id);


--
-- Name: destination_rates destination_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_rates
    ADD CONSTRAINT destination_rates_pkey PRIMARY KEY (id);


--
-- Name: destination_sets_cache destination_sets_cache_i_destination_set_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_sets_cache
    ADD CONSTRAINT destination_sets_cache_i_destination_set_key UNIQUE (i_destination_set);


--
-- Name: destination_sets_cache destination_sets_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_sets_cache
    ADD CONSTRAINT destination_sets_cache_pkey PRIMARY KEY (id);


--
-- Name: dispute_case_events dispute_case_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_case_events
    ADD CONSTRAINT dispute_case_events_pkey PRIMARY KEY (id);


--
-- Name: dispute_cases dispute_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_cases
    ADD CONSTRAINT dispute_cases_pkey PRIMARY KEY (id);


--
-- Name: dispute_cases dispute_cases_reference_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_cases
    ADD CONSTRAINT dispute_cases_reference_id_key UNIQUE (reference_id);


--
-- Name: entity_presence_registry entity_presence_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_presence_registry
    ADD CONSTRAINT entity_presence_registry_pkey PRIMARY KEY (id);


--
-- Name: execution_health_log execution_health_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_health_log
    ADD CONSTRAINT execution_health_log_pkey PRIMARY KEY (id);


--
-- Name: failover_executions failover_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failover_executions
    ADD CONSTRAINT failover_executions_pkey PRIMARY KEY (id);


--
-- Name: fas_events fas_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fas_events
    ADD CONSTRAINT fas_events_pkey PRIMARY KEY (id);


--
-- Name: fas_vendor_settings fas_vendor_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fas_vendor_settings
    ADD CONSTRAINT fas_vendor_settings_pkey PRIMARY KEY (vendor);


--
-- Name: fix_history fix_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fix_history
    ADD CONSTRAINT fix_history_pkey PRIMARY KEY (id);


--
-- Name: global_destinations global_destinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_destinations
    ADD CONSTRAINT global_destinations_pkey PRIMARY KEY (id);


--
-- Name: governed_calls governed_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governed_calls
    ADD CONSTRAINT governed_calls_pkey PRIMARY KEY (id);


--
-- Name: host_outage_log host_outage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.host_outage_log
    ADD CONSTRAINT host_outage_log_pkey PRIMARY KEY (id);


--
-- Name: incident_lifecycle_events incident_lifecycle_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_lifecycle_events
    ADD CONSTRAINT incident_lifecycle_events_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: intelligent_failover_policies intelligent_failover_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligent_failover_policies
    ADD CONSTRAINT intelligent_failover_policies_pkey PRIMARY KEY (id);


--
-- Name: invoice_cdr_snapshots invoice_cdr_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_cdr_snapshots
    ADD CONSTRAINT invoice_cdr_snapshots_pkey PRIMARY KEY (id);


--
-- Name: invoice_email_deliveries invoice_email_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_email_deliveries
    ADD CONSTRAINT invoice_email_deliveries_pkey PRIMARY KEY (id);


--
-- Name: invoice_jobs invoice_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_jobs
    ADD CONSTRAINT invoice_jobs_pkey PRIMARY KEY (id);


--
-- Name: invoice_line_items invoice_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_schedules invoice_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_schedules
    ADD CONSTRAINT invoice_schedules_pkey PRIMARY KEY (id);


--
-- Name: invoice_templates invoice_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_templates
    ADD CONSTRAINT invoice_templates_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: ip_restrictions ip_restrictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_restrictions
    ADD CONSTRAINT ip_restrictions_pkey PRIMARY KEY (id);


--
-- Name: ip_sharing_approvals ip_sharing_approvals_ip_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_sharing_approvals
    ADD CONSTRAINT ip_sharing_approvals_ip_address_key UNIQUE (ip_address);


--
-- Name: ip_sharing_approvals ip_sharing_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ip_sharing_approvals
    ADD CONSTRAINT ip_sharing_approvals_pkey PRIMARY KEY (id);


--
-- Name: irsf_events irsf_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.irsf_events
    ADD CONSTRAINT irsf_events_pkey PRIMARY KEY (id);


--
-- Name: kam_accounts kam_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kam_accounts
    ADD CONSTRAINT kam_accounts_pkey PRIMARY KEY (id);


--
-- Name: kams kams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kams
    ADD CONSTRAINT kams_pkey PRIMARY KEY (id);


--
-- Name: margin_alerts margin_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margin_alerts
    ADD CONSTRAINT margin_alerts_pkey PRIMARY KEY (id);


--
-- Name: margin_analytics_daily margin_analytics_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margin_analytics_daily
    ADD CONSTRAINT margin_analytics_daily_pkey PRIMARY KEY (id);


--
-- Name: metrics metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics
    ADD CONSTRAINT metrics_pkey PRIMARY KEY (id);


--
-- Name: mfa_secrets mfa_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_secrets
    ADD CONSTRAINT mfa_secrets_pkey PRIMARY KEY (id);


--
-- Name: mfa_secrets mfa_secrets_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_secrets
    ADD CONSTRAINT mfa_secrets_user_id_key UNIQUE (user_id);


--
-- Name: monitored_hosts monitored_hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitored_hosts
    ADD CONSTRAINT monitored_hosts_pkey PRIMARY KEY (id);


--
-- Name: monitoring_assignments monitoring_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitoring_assignments
    ADD CONSTRAINT monitoring_assignments_pkey PRIMARY KEY (user_id);


--
-- Name: mos_hourly mos_hourly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mos_hourly
    ADD CONSTRAINT mos_hourly_pkey PRIMARY KEY (id);


--
-- Name: navigation_modules navigation_modules_module_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navigation_modules
    ADD CONSTRAINT navigation_modules_module_key_key UNIQUE (module_key);


--
-- Name: navigation_modules navigation_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navigation_modules
    ADD CONSTRAINT navigation_modules_pkey PRIMARY KEY (id);


--
-- Name: noc_incident_assignments noc_incident_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noc_incident_assignments
    ADD CONSTRAINT noc_incident_assignments_pkey PRIMARY KEY (id);


--
-- Name: noc_incident_events noc_incident_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noc_incident_events
    ADD CONSTRAINT noc_incident_events_pkey PRIMARY KEY (id);


--
-- Name: noc_incidents noc_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noc_incidents
    ADD CONSTRAINT noc_incidents_pkey PRIMARY KEY (id);


--
-- Name: number_lookup_cache number_lookup_cache_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_lookup_cache
    ADD CONSTRAINT number_lookup_cache_number_key UNIQUE (number);


--
-- Name: number_lookup_cache number_lookup_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_lookup_cache
    ADD CONSTRAINT number_lookup_cache_pkey PRIMARY KEY (id);


--
-- Name: outage_log outage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outage_log
    ADD CONSTRAINT outage_log_pkey PRIMARY KEY (id);


--
-- Name: partner_profiles partner_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_profiles
    ADD CONSTRAINT partner_profiles_pkey PRIMARY KEY (id);


--
-- Name: payment_reminder_config payment_reminder_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_reminder_config
    ADD CONSTRAINT payment_reminder_config_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: platform_feature_flags platform_feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_feature_flags
    ADD CONSTRAINT platform_feature_flags_pkey PRIMARY KEY (key);


--
-- Name: portal_access_tokens portal_access_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_access_tokens
    ADD CONSTRAINT portal_access_tokens_pkey PRIMARY KEY (id);


--
-- Name: portal_access_tokens portal_access_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_access_tokens
    ADD CONSTRAINT portal_access_tokens_token_key UNIQUE (token);


--
-- Name: portal_definitions portal_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_definitions
    ADD CONSTRAINT portal_definitions_pkey PRIMARY KEY (id);


--
-- Name: portal_definitions portal_definitions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_definitions
    ADD CONSTRAINT portal_definitions_slug_key UNIQUE (slug);


--
-- Name: portal_module_assignments portal_module_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_module_assignments
    ADD CONSTRAINT portal_module_assignments_pkey PRIMARY KEY (id);


--
-- Name: portal_module_assignments portal_module_assignments_portal_id_module_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_module_assignments
    ADD CONSTRAINT portal_module_assignments_portal_id_module_id_key UNIQUE (portal_id, module_id);


--
-- Name: portal_sections portal_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sections
    ADD CONSTRAINT portal_sections_pkey PRIMARY KEY (id);


--
-- Name: portal_sections portal_sections_portal_id_section_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sections
    ADD CONSTRAINT portal_sections_portal_id_section_key_key UNIQUE (portal_id, section_key);


--
-- Name: portal_ticket_messages portal_ticket_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_ticket_messages
    ADD CONSTRAINT portal_ticket_messages_pkey PRIMARY KEY (id);


--
-- Name: portal_tickets portal_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_tickets
    ADD CONSTRAINT portal_tickets_pkey PRIMARY KEY (id);


--
-- Name: prefix_audit_log prefix_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prefix_audit_log
    ADD CONSTRAINT prefix_audit_log_pkey PRIMARY KEY (id);


--
-- Name: pricing_template_rates pricing_template_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_template_rates
    ADD CONSTRAINT pricing_template_rates_pkey PRIMARY KEY (id);


--
-- Name: pricing_templates pricing_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_templates
    ADD CONSTRAINT pricing_templates_pkey PRIMARY KEY (id);


--
-- Name: product_destination_assignments product_destination_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_destination_assignments
    ADD CONSTRAINT product_destination_assignments_pkey PRIMARY KEY (id);


--
-- Name: product_docs product_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_docs
    ADD CONSTRAINT product_docs_pkey PRIMARY KEY (id);


--
-- Name: product_history product_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_history
    ADD CONSTRAINT product_history_pkey PRIMARY KEY (id);


--
-- Name: product_prefixes product_prefixes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_prefixes
    ADD CONSTRAINT product_prefixes_pkey PRIMARY KEY (prefix);


--
-- Name: product_rates product_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_rates
    ADD CONSTRAINT product_rates_pkey PRIMARY KEY (id);


--
-- Name: product_registry product_registry_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_registry
    ADD CONSTRAINT product_registry_code_key UNIQUE (code);


--
-- Name: product_registry product_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_registry
    ADD CONSTRAINT product_registry_pkey PRIMARY KEY (id);


--
-- Name: provisioning_jobs provisioning_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provisioning_jobs
    ADD CONSTRAINT provisioning_jobs_pkey PRIMARY KEY (id);


--
-- Name: quality_events quality_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_events
    ADD CONSTRAINT quality_events_pkey PRIMARY KEY (id);


--
-- Name: rate_card_entries rate_card_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_card_entries
    ADD CONSTRAINT rate_card_entries_pkey PRIMARY KEY (id);


--
-- Name: rate_cards rate_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_cards
    ADD CONSTRAINT rate_cards_pkey PRIMARY KEY (id);


--
-- Name: rate_notifications rate_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_notifications
    ADD CONSTRAINT rate_notifications_pkey PRIMARY KEY (id);


--
-- Name: rate_push_jobs rate_push_jobs_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_push_jobs
    ADD CONSTRAINT rate_push_jobs_job_id_key UNIQUE (job_id);


--
-- Name: rate_push_jobs rate_push_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_push_jobs
    ADD CONSTRAINT rate_push_jobs_pkey PRIMARY KEY (id);


--
-- Name: rating_verifications rating_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_verifications
    ADD CONSTRAINT rating_verifications_pkey PRIMARY KEY (id);


--
-- Name: rbac_permission_audit_events rbac_permission_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permission_audit_events
    ADD CONSTRAINT rbac_permission_audit_events_pkey PRIMARY KEY (id);


--
-- Name: rbac_permissions rbac_permissions_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permissions
    ADD CONSTRAINT rbac_permissions_key_key UNIQUE (key);


--
-- Name: rbac_permissions rbac_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permissions
    ADD CONSTRAINT rbac_permissions_pkey PRIMARY KEY (id);


--
-- Name: rbac_role_permissions rbac_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_pkey PRIMARY KEY (id);


--
-- Name: rbac_role_permissions rbac_role_permissions_role_permission_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_role_permission_key_key UNIQUE (role, permission_key);


--
-- Name: rbac_user_permission_overrides rbac_user_permission_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_permission_overrides
    ADD CONSTRAINT rbac_user_permission_overrides_pkey PRIMARY KEY (id);


--
-- Name: rbac_user_permission_overrides rbac_user_permission_overrides_user_id_permission_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_permission_overrides
    ADD CONSTRAINT rbac_user_permission_overrides_user_id_permission_key_key UNIQUE (user_id, permission_key);


--
-- Name: recommendation_outcomes recommendation_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_outcomes
    ADD CONSTRAINT recommendation_outcomes_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_email_log reconciliation_email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_email_log
    ADD CONSTRAINT reconciliation_email_log_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_report_schedules reconciliation_report_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_report_schedules
    ADD CONSTRAINT reconciliation_report_schedules_pkey PRIMARY KEY (id);


--
-- Name: report_jobs report_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_jobs
    ADD CONSTRAINT report_jobs_pkey PRIMARY KEY (id);


--
-- Name: reseller_profiles reseller_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reseller_profiles
    ADD CONSTRAINT reseller_profiles_pkey PRIMARY KEY (id);


--
-- Name: route_decision_traces route_decision_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_decision_traces
    ADD CONSTRAINT route_decision_traces_pkey PRIMARY KEY (id);


--
-- Name: route_health_scores route_health_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_health_scores
    ADD CONSTRAINT route_health_scores_pkey PRIMARY KEY (id);


--
-- Name: route_quality_snapshots route_quality_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_quality_snapshots
    ADD CONSTRAINT route_quality_snapshots_pkey PRIMARY KEY (id);


--
-- Name: route_test_jobs route_test_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_test_jobs
    ADD CONSTRAINT route_test_jobs_pkey PRIMARY KEY (id);


--
-- Name: route_test_results route_test_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_test_results
    ADD CONSTRAINT route_test_results_pkey PRIMARY KEY (id);


--
-- Name: routing_cache_meta routing_cache_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_cache_meta
    ADD CONSTRAINT routing_cache_meta_pkey PRIMARY KEY (id);


--
-- Name: routing_groups_cache routing_groups_cache_i_routing_group_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_groups_cache
    ADD CONSTRAINT routing_groups_cache_i_routing_group_key UNIQUE (i_routing_group);


--
-- Name: routing_groups_cache routing_groups_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_groups_cache
    ADD CONSTRAINT routing_groups_cache_pkey PRIMARY KEY (id);


--
-- Name: routing_rules routing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_rules
    ADD CONSTRAINT routing_rules_pkey PRIMARY KEY (id);


--
-- Name: routing_suggestions routing_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_suggestions
    ADD CONSTRAINT routing_suggestions_pkey PRIMARY KEY (id);


--
-- Name: routing_template_vendors routing_template_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_template_vendors
    ADD CONSTRAINT routing_template_vendors_pkey PRIMARY KEY (id);


--
-- Name: routing_templates routing_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_templates
    ADD CONSTRAINT routing_templates_pkey PRIMARY KEY (id);


--
-- Name: rtp_quality_history rtp_quality_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtp_quality_history
    ADD CONSTRAINT rtp_quality_history_pkey PRIMARY KEY (id);


--
-- Name: rtp_quality_stats rtp_quality_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtp_quality_stats
    ADD CONSTRAINT rtp_quality_stats_pkey PRIMARY KEY (id);


--
-- Name: sbc_hosts sbc_hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sbc_hosts
    ADD CONSTRAINT sbc_hosts_pkey PRIMARY KEY (id);


--
-- Name: scheduled_reports scheduled_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_reports
    ADD CONSTRAINT scheduled_reports_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: simbox_scores simbox_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simbox_scores
    ADD CONSTRAINT simbox_scores_pkey PRIMARY KEY (id);


--
-- Name: sip_error_history sip_error_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sip_error_history
    ADD CONSTRAINT sip_error_history_pkey PRIMARY KEY (id);


--
-- Name: sip_error_stats sip_error_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sip_error_stats
    ADD CONSTRAINT sip_error_stats_pkey PRIMARY KEY (id);


--
-- Name: sippy_change_events sippy_change_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sippy_change_events
    ADD CONSTRAINT sippy_change_events_pkey PRIMARY KEY (id);


--
-- Name: sippy_snapshots sippy_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sippy_snapshots
    ADD CONSTRAINT sippy_snapshots_pkey PRIMARY KEY (key);


--
-- Name: sla_breach_log sla_breach_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_breach_log
    ADD CONSTRAINT sla_breach_log_pkey PRIMARY KEY (id);


--
-- Name: sms_dlr_events sms_dlr_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_dlr_events
    ADD CONSTRAINT sms_dlr_events_pkey PRIMARY KEY (id);


--
-- Name: sms_messages sms_messages_internal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_internal_id_key UNIQUE (internal_id);


--
-- Name: sms_messages sms_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_pkey PRIMARY KEY (id);


--
-- Name: sms_vendor_stats sms_vendor_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_vendor_stats
    ADD CONSTRAINT sms_vendor_stats_pkey PRIMARY KEY (id);


--
-- Name: smtp_sender_profiles smtp_sender_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smtp_sender_profiles
    ADD CONSTRAINT smtp_sender_profiles_pkey PRIMARY KEY (id);


--
-- Name: ssl_cert_status ssl_cert_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssl_cert_status
    ADD CONSTRAINT ssl_cert_status_pkey PRIMARY KEY (cert_id);


--
-- Name: switches switches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switches
    ADD CONSTRAINT switches_pkey PRIMARY KEY (id);


--
-- Name: synthetic_test_runs synthetic_test_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_test_runs
    ADD CONSTRAINT synthetic_test_runs_pkey PRIMARY KEY (id);


--
-- Name: tariff_change_events tariff_change_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_change_events
    ADD CONSTRAINT tariff_change_events_pkey PRIMARY KEY (id);


--
-- Name: tariff_profile_templates tariff_profile_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_profile_templates
    ADD CONSTRAINT tariff_profile_templates_pkey PRIMARY KEY (id);


--
-- Name: tariff_profiles tariff_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_profiles
    ADD CONSTRAINT tariff_profiles_pkey PRIMARY KEY (id);


--
-- Name: tariff_versions tariff_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_versions
    ADD CONSTRAINT tariff_versions_pkey PRIMARY KEY (id);


--
-- Name: termination_chains termination_chains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termination_chains
    ADD CONSTRAINT termination_chains_pkey PRIMARY KEY (id);


--
-- Name: test_campaign_results test_campaign_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_campaign_results
    ADD CONSTRAINT test_campaign_results_pkey PRIMARY KEY (id);


--
-- Name: test_campaigns test_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_campaigns
    ADD CONSTRAINT test_campaigns_pkey PRIMARY KEY (id);


--
-- Name: traffic_alerts traffic_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_alerts
    ADD CONSTRAINT traffic_alerts_pkey PRIMARY KEY (id);


--
-- Name: traffic_anomalies traffic_anomalies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_anomalies
    ADD CONSTRAINT traffic_anomalies_pkey PRIMARY KEY (id);


--
-- Name: traffic_baselines traffic_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_baselines
    ADD CONSTRAINT traffic_baselines_pkey PRIMARY KEY (id);


--
-- Name: traffic_snapshots traffic_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_snapshots
    ADD CONSTRAINT traffic_snapshots_pkey PRIMARY KEY (id);


--
-- Name: user_config user_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_config
    ADD CONSTRAINT user_config_pkey PRIMARY KEY (user_id);


--
-- Name: user_favorites user_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT user_favorites_pkey PRIMARY KEY (id);


--
-- Name: user_favorites user_favorites_user_id_module_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorites
    ADD CONSTRAINT user_favorites_user_id_module_key_key UNIQUE (user_id, module_key);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendor_health_scores vendor_health_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_health_scores
    ADD CONSTRAINT vendor_health_scores_pkey PRIMARY KEY (id);


--
-- Name: vendor_metric_baselines vendor_metric_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_metric_baselines
    ADD CONSTRAINT vendor_metric_baselines_pkey PRIMARY KEY (id);


--
-- Name: vendor_probe_results vendor_probe_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_probe_results
    ADD CONSTRAINT vendor_probe_results_pkey PRIMARY KEY (id);


--
-- Name: vendor_product_prefixes vendor_product_prefixes_full_prefix_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_prefixes
    ADD CONSTRAINT vendor_product_prefixes_full_prefix_unique UNIQUE (full_prefix);


--
-- Name: vendor_product_prefixes vendor_product_prefixes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_prefixes
    ADD CONSTRAINT vendor_product_prefixes_pkey PRIMARY KEY (id);


--
-- Name: vendor_stability_snapshots vendor_stability_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_stability_snapshots
    ADD CONSTRAINT vendor_stability_snapshots_pkey PRIMARY KEY (id);


--
-- Name: voice_otp_calls voice_otp_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_otp_calls
    ADD CONSTRAINT voice_otp_calls_pkey PRIMARY KEY (id);


--
-- Name: watcher_recipients watcher_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watcher_recipients
    ADD CONSTRAINT watcher_recipients_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_alert_log whatsapp_alert_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_alert_log
    ADD CONSTRAINT whatsapp_alert_log_pkey PRIMARY KEY (id);


--
-- Name: workspace_definitions workspace_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_definitions
    ADD CONSTRAINT workspace_definitions_pkey PRIMARY KEY (id);


--
-- Name: workspace_definitions workspace_definitions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_definitions
    ADD CONSTRAINT workspace_definitions_slug_key UNIQUE (slug);


--
-- Name: workspace_tab_items workspace_tab_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tab_items
    ADD CONSTRAINT workspace_tab_items_pkey PRIMARY KEY (id);


--
-- Name: workspace_tabs workspace_tabs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tabs
    ADD CONSTRAINT workspace_tabs_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.sessions USING btree (expire);


--
-- Name: audit_events_act_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_act_idx ON public.audit_events USING btree (actor);


--
-- Name: audit_events_cat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_cat_idx ON public.audit_events USING btree (category);


--
-- Name: audit_events_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_ts_idx ON public.audit_events USING btree ("timestamp" DESC);


--
-- Name: csnap_dim_name_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX csnap_dim_name_ts_idx ON public.concurrent_snapshots USING btree (dim, entity_name, ts);


--
-- Name: epr_dim_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX epr_dim_name_uidx ON public.entity_presence_registry USING btree (dim, entity_name);


--
-- Name: idx_account_actions_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_actions_account_id ON public.account_actions USING btree (account_id);


--
-- Name: idx_account_actions_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_account_actions_idempotency ON public.account_actions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_account_actions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_actions_status ON public.account_actions USING btree (status);


--
-- Name: idx_account_state_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_state_state ON public.account_state USING btree (state);


--
-- Name: idx_account_state_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_state_updated ON public.account_state USING btree (updated_at);


--
-- Name: idx_action_ledger_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_ledger_created_at ON public.action_ledger USING btree (created_at DESC);


--
-- Name: idx_action_ledger_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_ledger_entity ON public.action_ledger USING btree (entity_id);


--
-- Name: idx_action_ledger_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_ledger_event_type ON public.action_ledger USING btree (event_type);


--
-- Name: idx_action_ledger_ledger_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_ledger_ledger_id ON public.action_ledger USING btree (ledger_id);


--
-- Name: idx_action_ledger_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_ledger_scope ON public.action_ledger USING btree (scope);


--
-- Name: idx_action_ledger_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_ledger_source ON public.action_ledger USING btree (source_system);


--
-- Name: idx_al_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_al_client_name ON public.adjustment_ledger USING btree (client_name);


--
-- Name: idx_al_ref_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_al_ref_type_id ON public.adjustment_ledger USING btree (reference_type, reference_id);


--
-- Name: idx_ara_alert_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ara_alert_type ON public.ai_revenue_alerts USING btree (alert_type);


--
-- Name: idx_ara_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ara_client_name ON public.ai_revenue_alerts USING btree (client_name);


--
-- Name: idx_ara_detected_on; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ara_detected_on ON public.ai_revenue_alerts USING btree (detected_on);


--
-- Name: idx_ara_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ara_severity ON public.ai_revenue_alerts USING btree (severity);


--
-- Name: idx_ara_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ara_status ON public.ai_revenue_alerts USING btree (status);


--
-- Name: idx_ash_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ash_account_id ON public.account_state_history USING btree (account_id);


--
-- Name: idx_ash_snapshot_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ash_snapshot_at ON public.account_state_history USING btree (snapshot_at);


--
-- Name: idx_cap_alert_events_account_triggered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cap_alert_events_account_triggered ON public.cap_alert_events USING btree (account_id, triggered_at DESC);


--
-- Name: idx_cbp_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cbp_client_name ON public.client_branding_profiles USING btree (client_name);


--
-- Name: idx_ccr_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ccr_client_name ON public.credit_control_rules USING btree (client_name) WHERE (client_name IS NOT NULL);


--
-- Name: idx_ccr_global; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ccr_global ON public.credit_control_rules USING btree (is_global) WHERE (is_global = true);


--
-- Name: idx_cdr_recon_rows_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cdr_recon_rows_session_id ON public.cdr_recon_rows USING btree (session_id);


--
-- Name: idx_cdr_recon_rows_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cdr_recon_rows_status ON public.cdr_recon_rows USING btree (session_id, match_status);


--
-- Name: idx_ce_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_client_name ON public.collection_events USING btree (client_name);


--
-- Name: idx_ce_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_created_at ON public.collection_events USING btree (created_at);


--
-- Name: idx_ce_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ce_event_type ON public.collection_events USING btree (event_type);


--
-- Name: idx_cn_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cn_client_name ON public.credit_notes USING btree (client_name);


--
-- Name: idx_cn_dispute_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cn_dispute_id ON public.credit_notes USING btree (dispute_case_id);


--
-- Name: idx_cn_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cn_invoice_id ON public.credit_notes USING btree (invoice_id);


--
-- Name: idx_cn_policy_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cn_policy_id ON public.commercial_notifications USING btree (policy_id) WHERE (policy_id IS NOT NULL);


--
-- Name: idx_cn_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cn_status ON public.credit_notes USING btree (status);


--
-- Name: idx_cn_tariff_change_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cn_tariff_change_event_id ON public.commercial_notifications USING btree (tariff_change_event_id) WHERE (tariff_change_event_id IS NOT NULL);


--
-- Name: idx_cnr_tracking_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cnr_tracking_token ON public.commercial_notification_recipients USING btree (tracking_token) WHERE (tracking_token IS NOT NULL);


--
-- Name: idx_cp_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cp_enabled ON public.communication_policies USING btree (enabled);


--
-- Name: idx_cp_trigger_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cp_trigger_type ON public.communication_policies USING btree (trigger_type);


--
-- Name: idx_cpa_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpa_account ON public.customer_product_assignments USING btree (i_account);


--
-- Name: idx_cpa_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpa_product ON public.customer_product_assignments USING btree (product_id);


--
-- Name: idx_cr_carrier_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cr_carrier_name ON public.carrier_reconciliations USING btree (carrier_name);


--
-- Name: idx_cr_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cr_created_at ON public.carrier_reconciliations USING btree (created_at DESC);


--
-- Name: idx_cr_i_tariff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cr_i_tariff ON public.carrier_reconciliations USING btree (i_tariff);


--
-- Name: idx_cr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cr_status ON public.carrier_reconciliations USING btree (status);


--
-- Name: idx_crr_billing_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crr_billing_period ON public.client_revenue_reconciliations USING btree (billing_period);


--
-- Name: idx_crr_client_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crr_client_account ON public.client_revenue_reconciliations USING btree (client_account_id) WHERE (client_account_id IS NOT NULL);


--
-- Name: idx_crr_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crr_severity ON public.client_revenue_reconciliations USING btree (severity);


--
-- Name: idx_crr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crr_status ON public.client_revenue_reconciliations USING btree (status);


--
-- Name: idx_crr_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crr_version ON public.client_revenue_reconciliations USING btree (billing_period, version);


--
-- Name: idx_dc_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dc_assigned_to ON public.dispute_cases USING btree (assigned_to);


--
-- Name: idx_dc_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dc_client_name ON public.dispute_cases USING btree (client_name);


--
-- Name: idx_dc_opened_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dc_opened_at ON public.dispute_cases USING btree (opened_at);


--
-- Name: idx_dc_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dc_severity ON public.dispute_cases USING btree (severity);


--
-- Name: idx_dc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dc_status ON public.dispute_cases USING btree (status);


--
-- Name: idx_dce_case_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dce_case_id ON public.dispute_case_events USING btree (case_id);


--
-- Name: idx_deal_approvals_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_approvals_deal ON public.deal_approvals USING btree (deal_id);


--
-- Name: idx_deal_dest_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_dest_deal ON public.deal_destinations USING btree (deal_id);


--
-- Name: idx_deals_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_account ON public.deals USING btree (i_account);


--
-- Name: idx_deals_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_product ON public.deals USING btree (product_id);


--
-- Name: idx_deals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_status ON public.deals USING btree (status);


--
-- Name: idx_dmr_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmr_account_id ON public.daily_minutes_reports USING btree (account_id) WHERE (account_id IS NOT NULL);


--
-- Name: idx_dmr_discrepancy_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmr_discrepancy_type ON public.daily_minutes_reports USING btree (discrepancy_type);


--
-- Name: idx_dmr_report_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmr_report_date ON public.daily_minutes_reports USING btree (report_date);


--
-- Name: idx_dmr_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmr_verification_status ON public.daily_minutes_reports USING btree (verification_status);


--
-- Name: idx_dmr_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmr_version ON public.daily_minutes_reports USING btree (report_date, dmr_version);


--
-- Name: idx_dpr_dest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpr_dest_id ON public.destination_product_rates USING btree (destination_id);


--
-- Name: idx_dpr_prod_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpr_prod_prefix ON public.destination_product_rates USING btree (product_prefix);


--
-- Name: idx_dpr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpr_status ON public.destination_product_rates USING btree (approval_status);


--
-- Name: idx_ics_cdr_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ics_cdr_id ON public.invoice_cdr_snapshots USING btree (cdr_id) WHERE (cdr_id IS NOT NULL);


--
-- Name: idx_ics_delta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ics_delta ON public.invoice_cdr_snapshots USING btree (delta) WHERE ((delta IS NOT NULL) AND (abs(delta) > (0.0001)::double precision));


--
-- Name: idx_ics_i_tariff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ics_i_tariff ON public.invoice_cdr_snapshots USING btree (i_tariff);


--
-- Name: idx_ics_locked_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ics_locked_at ON public.invoice_cdr_snapshots USING btree (locked_at DESC);


--
-- Name: idx_ics_rating_verification_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ics_rating_verification_id ON public.invoice_cdr_snapshots USING btree (rating_verification_id);


--
-- Name: idx_ics_tariff_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ics_tariff_version_id ON public.invoice_cdr_snapshots USING btree (tariff_version_id);


--
-- Name: idx_ics_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ics_verification_status ON public.invoice_cdr_snapshots USING btree (verification_status);


--
-- Name: idx_ili_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ili_invoice_id ON public.invoice_line_items USING btree (invoice_id);


--
-- Name: idx_ili_snapshot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ili_snapshot_id ON public.invoice_line_items USING btree (snapshot_id);


--
-- Name: idx_incidents_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_entity ON public.incidents USING btree (entity_type, entity_id, incident_type, status);


--
-- Name: idx_inv_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_created_at ON public.invoices USING btree (created_at DESC);


--
-- Name: idx_inv_i_tariff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_i_tariff ON public.invoices USING btree (i_tariff);


--
-- Name: idx_inv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_status ON public.invoices USING btree (status);


--
-- Name: idx_invoice_cdr_snapshots_cdr_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_cdr_snapshots_cdr_id ON public.invoice_cdr_snapshots USING btree (cdr_id);


--
-- Name: idx_invoice_cdr_snapshots_i_tariff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_cdr_snapshots_i_tariff ON public.invoice_cdr_snapshots USING btree (i_tariff);


--
-- Name: idx_invoice_cdr_snapshots_locked_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_cdr_snapshots_locked_at ON public.invoice_cdr_snapshots USING btree (locked_at DESC);


--
-- Name: idx_invoice_jobs_billing_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_jobs_billing_period ON public.invoice_jobs USING btree (billing_period);


--
-- Name: idx_invoice_jobs_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_jobs_client_name ON public.invoice_jobs USING btree (client_name);


--
-- Name: idx_invoice_jobs_client_period; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_invoice_jobs_client_period ON public.invoice_jobs USING btree (client_name, billing_period) WHERE ((status)::text <> 'CANCELLED'::text);


--
-- Name: idx_invoice_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_jobs_status ON public.invoice_jobs USING btree (status);


--
-- Name: idx_it_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_it_client_name ON public.invoice_templates USING btree (client_name);


--
-- Name: idx_it_is_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_it_is_default ON public.invoice_templates USING btree (is_default);


--
-- Name: idx_mad_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mad_date ON public.margin_analytics_daily USING btree (date);


--
-- Name: idx_mad_date_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mad_date_type ON public.margin_analytics_daily USING btree (date, dimension_type);


--
-- Name: idx_mad_dimension_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mad_dimension_name ON public.margin_analytics_daily USING btree (dimension_name);


--
-- Name: idx_mad_dimension_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mad_dimension_type ON public.margin_analytics_daily USING btree (dimension_type);


--
-- Name: idx_malerts_acked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_malerts_acked ON public.margin_alerts USING btree (acknowledged);


--
-- Name: idx_malerts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_malerts_date ON public.margin_alerts USING btree (date);


--
-- Name: idx_malerts_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_malerts_severity ON public.margin_alerts USING btree (severity);


--
-- Name: idx_pp_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_active ON public.partner_profiles USING btree (active);


--
-- Name: idx_pp_client_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pp_client_name ON public.partner_profiles USING btree (client_name);


--
-- Name: idx_pp_contact_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_contact_email ON public.partner_profiles USING btree (contact_email);


--
-- Name: idx_rbac_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_audit_actor ON public.rbac_permission_audit_events USING btree (actor_id);


--
-- Name: idx_rbac_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_audit_created ON public.rbac_permission_audit_events USING btree (created_at DESC);


--
-- Name: idx_rbac_overrides_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_overrides_user ON public.rbac_user_permission_overrides USING btree (user_id);


--
-- Name: idx_rbac_role_perms_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_role_perms_role ON public.rbac_role_permissions USING btree (role);


--
-- Name: idx_rhs_group_scored; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rhs_group_scored ON public.route_health_scores USING btree (routing_group_id, scored_at DESC);


--
-- Name: idx_rj_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rj_created_at ON public.report_jobs USING btree (created_at DESC);


--
-- Name: idx_rj_delivery_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rj_delivery_status ON public.report_jobs USING btree (delivery_status);


--
-- Name: idx_rj_report_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rj_report_type ON public.report_jobs USING btree (report_type);


--
-- Name: idx_rqh_vendor_snapped; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rqh_vendor_snapped ON public.rtp_quality_history USING btree (vendor_id, snapped_at DESC);


--
-- Name: idx_rqs_computed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rqs_computed_at ON public.route_quality_snapshots USING btree (computed_at DESC);


--
-- Name: idx_rqs_vendor_prefix_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rqs_vendor_prefix_window ON public.route_quality_snapshots USING btree (vendor_id, prefix, window_hours, computed_at DESC);


--
-- Name: idx_rv_cdr_call_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rv_cdr_call_id ON public.rating_verifications USING btree (cdr_call_id);


--
-- Name: idx_rv_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rv_created_at ON public.rating_verifications USING btree (created_at DESC);


--
-- Name: idx_rv_discrepancy_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rv_discrepancy_type ON public.rating_verifications USING btree (discrepancy_type);


--
-- Name: idx_rv_i_tariff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rv_i_tariff ON public.rating_verifications USING btree (i_tariff);


--
-- Name: idx_rv_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rv_severity ON public.rating_verifications USING btree (severity);


--
-- Name: idx_rv_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rv_verification_status ON public.rating_verifications USING btree (verification_status);


--
-- Name: idx_sip_error_history_vendor_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sip_error_history_vendor_ts ON public.sip_error_history USING btree (vendor_name, snapshot_at DESC);


--
-- Name: idx_tariff_change_events_change_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tariff_change_events_change_type ON public.tariff_change_events USING btree (change_type);


--
-- Name: idx_tariff_change_events_i_tariff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tariff_change_events_i_tariff ON public.tariff_change_events USING btree (i_tariff);


--
-- Name: idx_tariff_change_events_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tariff_change_events_prefix ON public.tariff_change_events USING btree (prefix);


--
-- Name: idx_tariff_change_events_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tariff_change_events_version_id ON public.tariff_change_events USING btree (tariff_version_id);


--
-- Name: idx_tariff_versions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tariff_versions_created_at ON public.tariff_versions USING btree (created_at DESC);


--
-- Name: idx_tariff_versions_i_tariff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tariff_versions_i_tariff ON public.tariff_versions USING btree (i_tariff);


--
-- Name: idx_tariff_versions_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tariff_versions_source ON public.tariff_versions USING btree (source);


--
-- Name: idx_user_favorites_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_favorites_user ON public.user_favorites USING btree (user_id);


--
-- Name: idx_vhs_vendor_scored; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vhs_vendor_scored ON public.vendor_health_scores USING btree (vendor_name, scored_at DESC);


--
-- Name: noc_incident_events_incident_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX noc_incident_events_incident_idx ON public.noc_incident_events USING btree (incident_id, created_at DESC);


--
-- Name: rtp_quality_stats_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rtp_quality_stats_uidx ON public.rtp_quality_stats USING btree (vendor_id, destination_prefix, window_minutes);


--
-- Name: sip_error_stats_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sip_error_stats_uniq ON public.sip_error_stats USING btree (vendor_name, window_minutes, code, time_bucket, dest_prefix);


--
-- Name: traffic_baselines_day_hour_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX traffic_baselines_day_hour_idx ON public.traffic_baselines USING btree (day_of_week, hour);


--
-- Name: user_favorites_user_module_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_favorites_user_module_uidx ON public.user_favorites USING btree (user_id, module_key);


--
-- Name: vmb_vendor_metric_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vmb_vendor_metric_uidx ON public.vendor_metric_baselines USING btree (vendor, metric);


--
-- Name: vpr_vendor_probed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vpr_vendor_probed_idx ON public.vendor_probe_results USING btree (vendor_id, probed_at DESC);


--
-- Name: vsn_vendor_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vsn_vendor_ts_idx ON public.vendor_stability_snapshots USING btree (vendor, ts);


--
-- Name: call_governance_log call_governance_log_governed_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_governance_log
    ADD CONSTRAINT call_governance_log_governed_call_id_fkey FOREIGN KEY (governed_call_id) REFERENCES public.governed_calls(id);


--
-- Name: cdr_recon_rows cdr_recon_rows_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_recon_rows
    ADD CONSTRAINT cdr_recon_rows_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.cdr_recon_sessions(id) ON DELETE CASCADE;


--
-- Name: client_revenue_reconciliations client_revenue_reconciliations_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_revenue_reconciliations
    ADD CONSTRAINT client_revenue_reconciliations_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: client_revenue_reconciliations client_revenue_reconciliations_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_revenue_reconciliations
    ADD CONSTRAINT client_revenue_reconciliations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.client_revenue_reconciliations(id) ON DELETE SET NULL;


--
-- Name: commercial_notifications commercial_notifications_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_notifications
    ADD CONSTRAINT commercial_notifications_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.communication_policies(id) ON DELETE SET NULL;


--
-- Name: commercial_notifications commercial_notifications_tariff_change_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_notifications
    ADD CONSTRAINT commercial_notifications_tariff_change_event_id_fkey FOREIGN KEY (tariff_change_event_id) REFERENCES public.tariff_change_events(id) ON DELETE SET NULL;


--
-- Name: communication_policies communication_policies_sender_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_policies
    ADD CONSTRAINT communication_policies_sender_profile_id_fkey FOREIGN KEY (sender_profile_id) REFERENCES public.smtp_sender_profiles(id) ON DELETE SET NULL;


--
-- Name: daily_minutes_reports daily_minutes_reports_parent_dmr_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_minutes_reports
    ADD CONSTRAINT daily_minutes_reports_parent_dmr_id_fkey FOREIGN KEY (parent_dmr_id) REFERENCES public.daily_minutes_reports(id) ON DELETE SET NULL;


--
-- Name: daily_minutes_reports daily_minutes_reports_tariff_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_minutes_reports
    ADD CONSTRAINT daily_minutes_reports_tariff_version_id_fkey FOREIGN KEY (tariff_version_id) REFERENCES public.tariff_versions(id) ON DELETE SET NULL;


--
-- Name: destination_product_rates destination_product_rates_destination_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destination_product_rates
    ADD CONSTRAINT destination_product_rates_destination_id_fkey FOREIGN KEY (destination_id) REFERENCES public.global_destinations(id) ON DELETE CASCADE;


--
-- Name: dispute_case_events dispute_case_events_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_case_events
    ADD CONSTRAINT dispute_case_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.dispute_cases(id) ON DELETE CASCADE;


--
-- Name: failover_executions failover_executions_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failover_executions
    ADD CONSTRAINT failover_executions_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.intelligent_failover_policies(id) ON DELETE CASCADE;


--
-- Name: governed_calls governed_calls_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governed_calls
    ADD CONSTRAINT governed_calls_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.call_governance_rules(id);


--
-- Name: invoice_cdr_snapshots invoice_cdr_snapshots_rating_verification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_cdr_snapshots
    ADD CONSTRAINT invoice_cdr_snapshots_rating_verification_id_fkey FOREIGN KEY (rating_verification_id) REFERENCES public.rating_verifications(id) ON DELETE SET NULL;


--
-- Name: invoice_cdr_snapshots invoice_cdr_snapshots_tariff_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_cdr_snapshots
    ADD CONSTRAINT invoice_cdr_snapshots_tariff_version_id_fkey FOREIGN KEY (tariff_version_id) REFERENCES public.tariff_versions(id) ON DELETE SET NULL;


--
-- Name: invoice_line_items invoice_line_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_line_items invoice_line_items_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.invoice_cdr_snapshots(id) ON DELETE SET NULL;


--
-- Name: portal_module_assignments portal_module_assignments_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_module_assignments
    ADD CONSTRAINT portal_module_assignments_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.navigation_modules(id) ON DELETE CASCADE;


--
-- Name: portal_module_assignments portal_module_assignments_portal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_module_assignments
    ADD CONSTRAINT portal_module_assignments_portal_id_fkey FOREIGN KEY (portal_id) REFERENCES public.portal_definitions(slug) ON DELETE CASCADE;


--
-- Name: portal_sections portal_sections_portal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sections
    ADD CONSTRAINT portal_sections_portal_id_fkey FOREIGN KEY (portal_id) REFERENCES public.portal_definitions(slug) ON DELETE CASCADE;


--
-- Name: rating_verifications rating_verifications_tariff_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_verifications
    ADD CONSTRAINT rating_verifications_tariff_version_id_fkey FOREIGN KEY (tariff_version_id) REFERENCES public.tariff_versions(id) ON DELETE SET NULL;


--
-- Name: rbac_role_permissions rbac_role_permissions_permission_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_permission_key_fkey FOREIGN KEY (permission_key) REFERENCES public.rbac_permissions(key) ON DELETE CASCADE;


--
-- Name: rbac_user_permission_overrides rbac_user_permission_overrides_permission_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_permission_overrides
    ADD CONSTRAINT rbac_user_permission_overrides_permission_key_fkey FOREIGN KEY (permission_key) REFERENCES public.rbac_permissions(key) ON DELETE CASCADE;


--
-- Name: recommendation_outcomes recommendation_outcomes_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_outcomes
    ADD CONSTRAINT recommendation_outcomes_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.failover_executions(id) ON DELETE SET NULL;


--
-- Name: recommendation_outcomes recommendation_outcomes_recommendation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_outcomes
    ADD CONSTRAINT recommendation_outcomes_recommendation_id_fkey FOREIGN KEY (recommendation_id) REFERENCES public.routing_suggestions(id) ON DELETE SET NULL;


--
-- Name: route_test_results route_test_results_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_test_results
    ADD CONSTRAINT route_test_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.route_test_jobs(id) ON DELETE SET NULL;


--
-- Name: sms_messages sms_messages_fallback_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_fallback_from_fkey FOREIGN KEY (fallback_from) REFERENCES public.sms_messages(id);


--
-- Name: tariff_change_events tariff_change_events_tariff_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_change_events
    ADD CONSTRAINT tariff_change_events_tariff_version_id_fkey FOREIGN KEY (tariff_version_id) REFERENCES public.tariff_versions(id) ON DELETE CASCADE;


--
-- Name: termination_chains termination_chains_reve_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termination_chains
    ADD CONSTRAINT termination_chains_reve_profile_id_fkey FOREIGN KEY (reve_profile_id) REFERENCES public.bhaoo_profiles(id) ON DELETE SET NULL;


--
-- Name: vendor_product_prefixes vendor_product_prefixes_canonical_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_product_prefixes
    ADD CONSTRAINT vendor_product_prefixes_canonical_id_fkey FOREIGN KEY (canonical_id) REFERENCES public.canonical_vendors(id);


--
-- PostgreSQL database dump complete
--

\unrestrict wUz6qZB7kYzl6BU777NeaZl0EdrTNKYgtlGWMLNAA3jgO4Dptcil0qHyDpqc7gw


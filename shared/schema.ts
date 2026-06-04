
import { pgTable, text, serial, integer, boolean, timestamp, real, varchar, pgEnum, json, jsonb, uniqueIndex, bigint, index, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Trunk class classification
export type TrunkClass = 'first' | 'business' | 'charlie' | 'unknown';
// Call failure types
export type FailType = 'wrong_number' | 'switched_off' | 'untraceable' | 'invalid' | null;

export * from "./models/auth";

// === TABLE DEFINITIONS ===

// Calls: Represents a VoIP call session
export const calls = pgTable("calls", {
  id: serial("id").primaryKey(),
  caller: varchar("caller", { length: 50 }).notNull(), // e.g., +1234567890
  callee: varchar("callee", { length: 50 }).notNull(), // e.g., +1098765432
  status: varchar("status", { length: 20 }).notNull().default('active'), // active, completed, failed
  startTime: timestamp("start_time").defaultNow(),
  endTime: timestamp("end_time"),
  direction: varchar("direction", { length: 10 }).default('inbound'), // inbound, outbound
  pdd: real("pdd"), // Post-Dial Delay in seconds (time from dial to first ringback)
  failReason: varchar("fail_reason", { length: 30 }), // wrong_number | switched_off | untraceable | invalid
  // Enriched fields for monitoring
  originCountry: varchar("origin_country", { length: 64 }), // country from caller number
  termCountry: varchar("term_country", { length: 64 }),     // country from callee number
  trunkClass: varchar("trunk_class", { length: 20 }),       // first | business | charlie | unknown
  sipCode: integer("sip_code"),                             // SIP disconnect code e.g. 200, 404, 480
  billableSecs: integer("billable_secs"),                   // billed duration in seconds
  fasFlag: boolean("fas_flag").default(false),              // False Answer Supervision detected
  callbackFlag: boolean("callback_flag").default(false),    // call is a callback
});

// Metrics: Time-series data for call quality
export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  callId: integer("call_id").notNull(), //.references(() => calls.id), // Removing FK for simplicity in MVP simulation
  timestamp: timestamp("timestamp").defaultNow(),
  jitter: real("jitter").notNull(), // in ms
  latency: real("latency").notNull(), // in ms
  packetLoss: real("packet_loss").notNull(), // percentage 0-100
  mos: real("mos").notNull(), // Mean Opinion Score 1-5
});

// Alerts: System notifications for threshold breaches
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 50 }).notNull(), // 'high_jitter', 'packet_loss', 'poor_mos'
  severity: varchar("severity", { length: 20 }).notNull(), // warning, critical
  message: text("message").notNull(),
  vendor: varchar("vendor", { length: 128 }),       // originating vendor/carrier name
  connection: varchar("connection", { length: 128 }), // originating connection/trunk name
  resolved: boolean("resolved").default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: varchar("acknowledged_by", { length: 128 }),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Settings: Simulation and Threshold configurations
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  jitterThreshold: integer("jitter_threshold").default(30), // ms
  latencyThreshold: integer("latency_threshold").default(150), // ms
  packetLossThreshold: real("packet_loss_threshold").default(1.0), // %
  simulationEnabled: boolean("simulation_enabled").default(false),
  monitoredIp: varchar("monitored_ip", { length: 45 }).default('45.59.163.182'), // IP to probe for live calls
  // Management portal access
  switchType: varchar("switch_type", { length: 50 }).default('vos3000'), // 'vos3000' | 'sippy'
  portalUrl: varchar("portal_url", { length: 255 }), // e.g. http://45.59.163.182:8080
  portalUsername: varchar("portal_username", { length: 128 }),
  portalPassword: varchar("portal_password", { length: 255 }),
  // Persisted VOS3000 session (survives server restarts)
  portalSessionToken: varchar("portal_session_token", { length: 512 }),
  portalSessionUser: varchar("portal_session_user", { length: 128 }),
  portalSessionBase: varchar("portal_session_base", { length: 512 }),
  // Sippy XML-RPC Admin API credentials (separate from portal login — required for API operations)
  apiAdminUsername: varchar("api_admin_username", { length: 128 }),
  apiAdminPassword: varchar("api_admin_password", { length: 255 }),  // XML-RPC API password (My Preferences → Allow API Calls)
  adminWebPassword: varchar("admin_web_password", { length: 255 }),  // Web portal login password (may differ from API password)
  // SNMP monitoring (Sippy SNMP — docs: support.sippysoft.com/a/solutions/articles/81166)
  // SNMP runs on the Sippy switch host at UDP port 161 (snmpd with SIPPY-MIB).
  // Enterprise OID prefix: .1.3.6.1.4.1.36523
  snmpEnabled: boolean("snmp_enabled").default(false),
  snmpHost: varchar("snmp_host", { length: 255 }),       // Switch host to query (defaults to portalUrl host)
  snmpPort: integer("snmp_port").default(161),
  snmpCommunity: varchar("snmp_community", { length: 128 }).default('public'),
  snmpEnvironments: varchar("snmp_environments", { length: 255 }).default('1'), // comma-separated env IDs
  // Email alert configuration (Gmail)
  alertAdminEmail: varchar("alert_admin_email", { length: 255 }), // always-notified admin
  alertGmailUser: varchar("alert_gmail_user", { length: 255 }),   // Gmail "From" address
  alertGmailAppPass: varchar("alert_gmail_app_pass", { length: 255 }), // Gmail App Password
  alertEnabled: boolean("alert_enabled").default(false),
  // Alert thresholds
  balanceAlertThreshold: real("balance_alert_threshold").default(10), // alert if balance < this (USD)
  fasMinPddSecs: integer("fas_min_pdd_secs").default(10),        // PDD > this = FAS candidate
  fasMaxBillSecs: integer("fas_max_bill_secs").default(5),       // billed < this but answered = FAS
  fasEarlyAnswerSecs: integer("fas_early_answer_secs").default(2), // PDD < this = suspiciously fast answer
  fasShortCallSecs: integer("fas_short_call_secs").default(10),   // billed < this = short call (not FAS by itself)
  // Management Feature Permissions (JSON array of enabled feature keys for management role)
  mgmtFeaturePermissions: text("mgmt_feature_permissions").default('["alerts","server_monitoring","did_management","test_call","graphs","bitseye","reports","cdr_viewer","balance_monitor","fraud_fas","clients","tools","call_flow_simulator","lcr_analyser","vendor_sla","account_management"]'),
  // WhatsApp Push Alerts
  whatsappEnabled:     boolean("whatsapp_enabled").default(false),
  whatsappProvider:    varchar("whatsapp_provider",     { length: 20 }).default('callmebot'), // callmebot | ultramsg
  whatsappPhones:      text("whatsapp_phones"),           // comma-separated E.164 e.g. +923001234567,+441234567890
  whatsappApiKey:      varchar("whatsapp_api_key",     { length: 255 }), // CallMeBot apikey OR UltraMsg token
  whatsappInstanceId:  varchar("whatsapp_instance_id", { length: 128 }), // UltraMsg instance ID only
  whatsappAlertTypes:  text("whatsapp_alert_types").default('fas,balance,traffic,outage,auth'), // CSV
  // Call Recordings
  recordingServerUrl:  varchar("recording_server_url", { length: 512 }), // Base URL of recording server, e.g. https://rec.example.com
  // Grafana embed
  grafanaUrl:          varchar("grafana_url",           { length: 1024 }),  // panel or dashboard embed URL
  grafanaDefaultRange: varchar("grafana_default_range", { length: 20  }).default('1h'), // 1h|6h|24h|7d|30d
  grafanaPanelHeight:  integer("grafana_panel_height").default(480),        // iframe height in px
  // Configurable approval settings — JSON map of feature → { create, edit, delete } booleans
  approvalSettings: text("approval_settings"),
  // Dual-approval TTL — how long a pending_approval action stays open before auto-expiry (minutes)
  dualApprovalTtlMinutes: integer("dual_approval_ttl_minutes").default(30),
  // Sidebar visibility config — JSON array of hidden item hrefs (admin-controlled)
  sidebarHiddenItems: text("sidebar_hidden_items").default('[]'),
  // HLR / CNAM provider config
  hlrProvider:   varchar("hlr_provider",    { length: 20 }).default('none'),  // 'telnyx' | 'hlrlookup' | 'none'
  hlrApiKey:     varchar("hlr_api_key",     { length: 255 }),
  hlrApiSecret:  varchar("hlr_api_secret",  { length: 255 }),
  // OTP Channel Policy — JSON: { "primary": "voice"|"whatsapp"|"sms", "fallback": [] }
  otpChannelPolicy: text("otp_channel_policy").default('{"primary":"voice","fallback":[]}'),
  // Meta Cloud API — standard templates + WhatsApp Flows interactive OTP
  metaPhoneNumberId:       varchar("meta_phone_number_id",       { length: 64  }),
  metaAccessToken:         varchar("meta_access_token",          { length: 512 }),
  metaOtpTemplateName:     varchar("meta_otp_template_name",     { length: 128 }).default('otp_verification'),
  metaOtpTemplateLanguage: varchar("meta_otp_template_language", { length: 16  }).default('en_us'),
  metaUseOtpTemplate:      boolean("meta_use_otp_template").default(true),
  metaFlowId:              varchar("meta_flow_id",               { length: 64 }),
  metaWabaId:              varchar("meta_waba_id",               { length: 64 }),
  metaFlowsEnabled:        boolean("meta_flows_enabled").default(false),
  metaFlowsPublicKey:      text("meta_flows_public_key"),
  // Approval expiry out-of-band notifications
  approvalExpiryEmailEnabled:      boolean("approval_expiry_email_enabled").default(true),
  approvalExpirySlackWebhookUrl:   varchar("approval_expiry_slack_webhook_url", { length: 512 }),
  // Invoice email delivery SMTP — dedicated outbound channel for invoice sends
  invoiceSmtpHost:      varchar("invoice_smtp_host",       { length: 255 }),
  invoiceSmtpPort:      integer("invoice_smtp_port").default(587),
  invoiceSmtpSecure:    boolean("invoice_smtp_secure").default(false),
  invoiceSmtpUser:      varchar("invoice_smtp_user",       { length: 255 }),
  invoiceSmtpPass:      varchar("invoice_smtp_pass",       { length: 512 }),
  invoiceSmtpFromName:  varchar("invoice_smtp_from_name",  { length: 255 }).default('Bitsauto Finance'),
  invoiceSmtpFromEmail: varchar("invoice_smtp_from_email", { length: 255 }),
});

// Client & Vendor Profiles: named parties used to label CLI/CLD in reports
export const clientProfiles = pgTable("client_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  type: varchar("type", { length: 10 }).notNull().default('client'), // client | vendor
  prefix: varchar("prefix", { length: 50 }), // CLI prefix for clients, CLD prefix for vendors
  ipAddress: varchar("ip_address", { length: 45 }), // source IP for matching (IPv4 or IPv6)
  ratePerMin: real("rate_per_min").default(0.025), // billing rate per minute USD
  rateEffectiveFrom: timestamp("rate_effective_from"), // UTC — rate is active from this datetime
  rateEffectiveTo: timestamp("rate_effective_to"),   // UTC — rate expires at this datetime (null = no expiry)
  notes: text("notes"),
  switchSyncStatus: json("switch_sync_status").$type<{ vos3000?: string; sippy?: string; syncedAt?: string }>(),
  createdAt: timestamp("created_at").defaultNow(),

  // ── Sippy-specific account parameters ─────────────────────────────────────
  maxSessions: integer("max_sessions"),                       // Max concurrent sessions (e.g. 1000)
  maxCallsPerSecond: integer("max_calls_per_second"),         // CPS limit (e.g. 45)
  maxSessionTime: integer("max_session_time"),                // Max call duration in seconds (e.g. 7200)
  creditLimit: real("credit_limit"),                         // Prepaid credit limit in account currency
  routingGroup: varchar("routing_group", { length: 128 }),    // Routing Group (e.g. "Banglades IGW OR")
  preferredCodec: varchar("preferred_codec", { length: 32 }), // e.g. "G.729", "G.711u"
  cldTranslationRule: varchar("cld_translation_rule", { length: 128 }), // CLD Tr. Rule e.g. "s/^6043//"
  cliTranslationRule: varchar("cli_translation_rule", { length: 128 }), // CLI Tr. Rule e.g. "s/^[+]//"
  servicePlan: varchar("service_plan", { length: 128 }),      // Service Plan / tariff name
  sipClass: varchar("sip_class", { length: 128 }),            // SIP Class (e.g. "404 & 500 sip CC to")
  timezone: varchar("timezone", { length: 64 }).default('Etc/UTC'), // Account timezone
  language: varchar("language", { length: 32 }).default('English'), // Portal language
  companyName: varchar("company_name", { length: 128 }),      // Address Info: Company Name
  alertEmail: varchar("alert_email", { length: 255 }),        // per-client alert email (optional)
  costPerMin: real("cost_per_min"),                           // vendor cost per minute (override)
  revenuePerMin: real("revenue_per_min"),                     // client revenue per minute (override)
});

export type ClientProfile = typeof clientProfiles.$inferSelect;
export type InsertClientProfile = typeof clientProfiles.$inferInsert;
export const insertClientProfileSchema = createInsertSchema(clientProfiles).omit({ id: true, createdAt: true });

// Switches: multiple VOS3000 / Sippy softswitch instances for multi-switch sync
export const switches = pgTable("switches", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),              // friendly display name
  type: varchar("type", { length: 20 }).notNull().default('vos3000'), // vos3000 | sippy
  portalUrl: varchar("portal_url", { length: 512 }),
  portalUsername: varchar("portal_username", { length: 128 }),
  portalPassword: varchar("portal_password", { length: 255 }),
  apiAdminUsername: varchar("api_admin_username", { length: 128 }), // optional XML-RPC admin user
  apiAdminPassword: varchar("api_admin_password", { length: 255 }), // optional XML-RPC admin password
  adminWebPassword: varchar("admin_web_password", { length: 255 }), // web portal login password when it differs from API password
  loginType: integer("login_type").default(1),                   // VOS3000 loginType (1=gateway)
  enabled: boolean("enabled").default(true),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: varchar("last_sync_status", { length: 512 }),  // last push result summary
  createdAt: timestamp("created_at").defaultNow(),
});

export type Switch = typeof switches.$inferSelect;
export type InsertSwitch = typeof switches.$inferInsert;
export const insertSwitchSchema = createInsertSchema(switches).omit({ id: true, createdAt: true, lastSyncAt: true });

// FAS Events: records of False Answer Supervision fraud detections
export const fasEvents = pgTable("fas_events", {
  id: serial("id").primaryKey(),
  callId: varchar("call_id", { length: 64 }).notNull(), // CDR call-id from switch
  caller: varchar("caller", { length: 64 }),
  callee: varchar("callee", { length: 64 }),
  clientName: varchar("client_name", { length: 128 }), // originating account/customer name
  vendor: varchar("vendor", { length: 128 }),           // terminating carrier/vendor name
  pddSecs: real("pdd_secs"),
  billSecs: integer("bill_secs"),
  sipCode: integer("sip_code"),
  reason: varchar("reason", { length: 255 }),  // comma-sep: 'high_pdd' | 'short_billed' | 'zero_billed' | 'early_answer' | 'short_call'
  fraudScore: real("fraud_score"),             // composite score 0-100 (higher = more suspicious)
  detectedAt: timestamp("detected_at").defaultNow(),
  alertSent: boolean("alert_sent").default(false),
});

export type FasEvent = typeof fasEvents.$inferSelect;
export type InsertFasEvent = typeof fasEvents.$inferInsert;
export const insertFasEventSchema = createInsertSchema(fasEvents).omit({ id: true, detectedAt: true });

// FAS Vendor Settings: per-vendor suppression + alert threshold
export const fasVendorSettings = pgTable("fas_vendor_settings", {
  vendor:         varchar("vendor", { length: 255 }).primaryKey(),
  suppressed:     boolean("suppressed").default(false).notNull(),
  alertThreshold: integer("alert_threshold").default(30),  // FAS% at which to send alert
  updatedAt:      timestamp("updated_at").defaultNow(),
});
export type FasVendorSetting       = typeof fasVendorSettings.$inferSelect;
export type InsertFasVendorSetting = typeof fasVendorSettings.$inferInsert;

// Outage Log: records when the Sippy server goes down and recovers
export const outageLog = pgTable("outage_log", {
  id:           serial("id").primaryKey(),
  downAt:       timestamp("down_at").notNull(),
  recoveredAt:  timestamp("recovered_at"),
  durationSec:  integer("duration_sec"),
  cause:        varchar("cause", { length: 128 }),  // 'timeout' | 'auth_fail' | 'http_5xx' | 'connection_refused'
  checkedAt:    timestamp("checked_at").defaultNow(),
});

export type OutageEntry    = typeof outageLog.$inferSelect;
export type InsertOutageEntry = typeof outageLog.$inferInsert;

// Monitored Hosts: vendor IPs / carrier servers to ping-check
export const monitoredHosts = pgTable("monitored_hosts", {
  id:           serial("id").primaryKey(),
  label:        varchar("label", { length: 128 }).notNull(),         // Display name, e.g. "Callntalk Gateway"
  ip:           varchar("ip", { length: 128 }).notNull(),            // IP or hostname
  type:         varchar("type", { length: 32 }).notNull().default("vendor"), // 'vendor'|'carrier'|'server'
  ports:        text("ports"),                                        // comma-separated probe ports, null = defaults
  notifyEmail:  varchar("notify_email", { length: 256 }),            // Email to alert when down
  enabled:      boolean("enabled").notNull().default(true),
  createdAt:    timestamp("created_at").defaultNow(),
});
export type MonitoredHost       = typeof monitoredHosts.$inferSelect;
export type InsertMonitoredHost = typeof monitoredHosts.$inferInsert;

// Per-host outage log (linked to monitored_hosts)
export const hostOutageLog = pgTable("host_outage_log", {
  id:           serial("id").primaryKey(),
  hostId:       integer("host_id").notNull(),
  hostLabel:    varchar("host_label", { length: 128 }),              // denormalized for easy display
  hostIp:       varchar("host_ip", { length: 128 }),
  downAt:       timestamp("down_at").notNull(),
  recoveredAt:  timestamp("recovered_at"),
  durationSec:  integer("duration_sec"),
  cause:        varchar("cause", { length: 128 }),
  checkedAt:    timestamp("checked_at").defaultNow(),
});
export type HostOutageEntry       = typeof hostOutageLog.$inferSelect;
export type InsertHostOutageEntry = typeof hostOutageLog.$inferInsert;

// Alert Rules: configurable thresholds with email/webhook notification
export const alertRules = pgTable("alert_rules", {
  id:             serial("id").primaryKey(),
  metric:         varchar("metric", { length: 64 }).notNull(),  // 'server_down' | 'asr_drop' | 'cps_spike' | 'disk_full' | 'reg_storm' | 'bandwidth'
  label:          varchar("label", { length: 128 }),
  threshold:      real("threshold").notNull(),
  comparison:     varchar("comparison", { length: 10 }).notNull().default('lt'), // 'lt' | 'gt'
  carrier:        varchar("carrier", { length: 128 }),           // optional: scope to a specific carrier
  enabled:        boolean("enabled").default(true),
  emailEnabled:   boolean("email_enabled").default(false),
  webhookEnabled: boolean("webhook_enabled").default(false),
  webhookUrl:     varchar("webhook_url", { length: 512 }),
  createdAt:      timestamp("created_at").defaultNow(),
});

export type AlertRule       = typeof alertRules.$inferSelect;
export type InsertAlertRule = typeof alertRules.$inferInsert;
export const insertAlertRuleSchema = createInsertSchema(alertRules).omit({ id: true, createdAt: true });

// Call Snapshots: live call state persisted every 30 seconds, retained for 24 hours.
// One row per unique Sippy call ID (upserted on each poll).
// firstSeen = when the call first appeared; lastSeen = most recent active poll.
export const callSnapshots = pgTable("call_snapshots", {
  id:              serial("id").primaryKey(),
  sippyCallId:     varchar("sippy_call_id",    { length: 255 }).notNull().unique(),
  caller:          varchar("caller",            { length: 64 }),
  callee:          varchar("callee",            { length: 64 }),
  clientName:      varchar("client_name",       { length: 128 }),
  vendor:          varchar("vendor",            { length: 128 }),
  accountId:       varchar("account_id",        { length: 32 }),
  iCustomer:       varchar("i_customer",        { length: 32 }),
  iEnvironment:    varchar("i_environment",     { length: 32 }),
  direction:       varchar("direction",         { length: 32 }),
  codec:           varchar("codec",             { length: 32 }),
  ccState:         varchar("cc_state",          { length: 32 }),
  maxDurationSecs: real("max_duration_secs").default(0),
  pddMs:           integer("pdd_ms").default(0),
  mediaIpCaller:   varchar("media_ip_caller",   { length: 64 }),
  mediaIpCallee:   varchar("media_ip_callee",   { length: 64 }),
  connection:      varchar("connection",        { length: 255 }),
  firstSeen:       timestamp("first_seen").defaultNow(),
  lastSeen:        timestamp("last_seen").defaultNow(),
});

export type CallSnapshot = typeof callSnapshots.$inferSelect;
export type InsertCallSnapshot = typeof callSnapshots.$inferInsert;

// User Configuration: per-user personal settings beyond what Replit Auth provides
export const userConfig = pgTable("user_config", {
  userId: varchar("user_id").primaryKey(),
  displayName: varchar("display_name", { length: 128 }),         // override shown name
  phone: varchar("phone", { length: 30 }),                       // contact phone / extension
  department: varchar("department", { length: 128 }),            // e.g. NOC, Support, Finance
  timezone: varchar("timezone", { length: 64 }).default('UTC'),  // IANA timezone
  notificationEmail: varchar("notification_email", { length: 255 }), // alert email (if different)
  defaultReportRange: varchar("default_report_range", { length: 30 }).default('Last 3 hr'),
  bio: text("bio"),                                              // short notes / role description
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UserConfig = typeof userConfig.$inferSelect;
export type InsertUserConfig = typeof userConfig.$inferInsert;
export const insertUserConfigSchema = createInsertSchema(userConfig).omit({ userId: true, updatedAt: true });

// ── Organisational Hierarchy ──────────────────────────────────────────────────
export const ORG_ROLES = ['HOD', 'SVP', 'VP', 'Manager', 'TeamLead', 'KAM'] as const;
export type OrgRole = typeof ORG_ROLES[number];

// Rank mapping — higher = more authority (used for hierarchy validation)
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  HOD: 6, SVP: 5, VP: 4, Manager: 3, TeamLead: 2, KAM: 1,
};

// ── KAM (Key Account Manager) Management ─────────────────────────────────────
export const kams = pgTable("kams", {
  id:        serial("id").primaryKey(),
  name:      varchar("name",  { length: 128 }).notNull(),
  email:     varchar("email", { length: 255 }).notNull(),
  phone:     varchar("phone", { length: 32 }),
  title:     varchar("title", { length: 128 }),
  active:    boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  // Org hierarchy fields
  orgRole:   varchar("org_role",   { length: 20 }).default('KAM'),  // HOD|SVP|VP|Manager|TeamLead|KAM
  reportsTo: integer("reports_to"),                                   // parent KAM id (null = top of tree)
  userId:    varchar("user_id",    { length: 255 }),                  // links to auth users.id (optional)
});

export type Kam = typeof kams.$inferSelect;
export type InsertKam = typeof kams.$inferInsert;
export const insertKamSchema = createInsertSchema(kams).omit({ id: true, createdAt: true });

// KAM ↔ Sippy account assignments
export const kamAccounts = pgTable("kam_accounts", {
  id:            serial("id").primaryKey(),
  kamId:         integer("kam_id").notNull(),
  accountId:     varchar("account_id",  { length: 32 }).notNull(),  // Sippy iAccount
  clientName:    varchar("client_name", { length: 128 }),           // display name
  dropThreshold: integer("drop_threshold").default(0),              // alert when concurrent calls < this
  createdAt:     timestamp("created_at").defaultNow(),
});

export type KamAccount = typeof kamAccounts.$inferSelect;
export type InsertKamAccount = typeof kamAccounts.$inferInsert;
export const insertKamAccountSchema = createInsertSchema(kamAccounts).omit({ id: true, createdAt: true });

// Traffic alert history (one row per alert event)
export const trafficAlerts = pgTable("traffic_alerts", {
  id:          serial("id").primaryKey(),
  clientName:  varchar("client_name", { length: 128 }).notNull(),
  accountId:   varchar("account_id",  { length: 32 }),
  kamId:       integer("kam_id"),
  alertType:   varchar("alert_type",  { length: 32 }).notNull(), // traffic_gone | traffic_dropped | traffic_restored
  prevCalls:   integer("prev_calls").default(0),
  currCalls:   integer("curr_calls").default(0),
  emailSent:   boolean("email_sent").default(false),
  emailSentAt: timestamp("email_sent_at"),
  resolvedAt:  timestamp("resolved_at"),
  triggeredAt: timestamp("triggered_at").defaultNow(),
});

export type TrafficAlert = typeof trafficAlerts.$inferSelect;
export type InsertTrafficAlert = typeof trafficAlerts.$inferInsert;
export const insertTrafficAlertSchema = createInsertSchema(trafficAlerts).omit({ id: true, triggeredAt: true });

// WhatsApp Alert Delivery Log
export const whatsappAlertLog = pgTable("whatsapp_alert_log", {
  id:         serial("id").primaryKey(),
  alertType:  varchar("alert_type",  { length: 50 }).notNull(), // fas | balance | traffic | auth | outage | quality | test
  recipient:  varchar("recipient",   { length: 32 }).notNull(), // E.164 phone number
  message:    text("message").notNull(),
  status:     varchar("status",      { length: 20 }).notNull().default('pending'), // sent | failed
  errorMsg:   text("error_msg"),
  sentAt:     timestamp("sent_at").defaultNow(),
});
export type WhatsappAlertLog = typeof whatsappAlertLog.$inferSelect;
export type InsertWhatsappAlertLog = typeof whatsappAlertLog.$inferInsert;

// Monitoring Items — canonical list shared between frontend and backend
export const MONITORING_ITEMS = [
  { id: 'live_summary',        label: 'Live Calls – Summary',        group: 'Live Calls'  },
  { id: 'live_details',        label: 'Live Calls – Details',        group: 'Live Calls'  },
  { id: 'live_quality',        label: 'Live Calls – Quality',        group: 'Live Calls'  },
  { id: 'call_history',        label: 'Call History',                group: 'Live Calls'  },
  { id: 'balance_monitor',     label: 'Balance Monitor',             group: 'Finance'     },
  { id: 'rate_cards',          label: 'Rate Card Management',        group: 'Finance'     },
  { id: 'cost_optimisation',   label: 'Cost Optimisation Engine',    group: 'Finance'     },
  { id: 'alerts',              label: 'Alerts',                      group: 'Operations'  },
  { id: 'traffic_map',         label: 'Traffic Map',                 group: 'Operations'  },
  { id: 'server_monitoring',   label: 'Server Monitoring',           group: 'Operations'  },
  { id: 'did_management',      label: 'DID Management',              group: 'Operations'  },
  { id: 'multi_switch',        label: 'Multi-Switch View',           group: 'Operations'  },
  { id: 'test_call',           label: 'Test Call / Click-to-Call',   group: 'Operations'  },
  { id: 'call_flow_simulator', label: 'Call Flow Simulator',         group: 'Operations'  },
  { id: 'fraud_fas',           label: 'FAS / Fraud Detection',       group: 'Security'    },
  { id: 'vendor_sla',          label: 'Vendor SLA Scorecard',        group: 'Security'    },
  { id: 'graphs',              label: 'Graphs',                      group: 'Analytics'   },
  { id: 'bitseye',             label: 'BitsEye Live Graphs',         group: 'Analytics'   },
  { id: 'analytics',           label: 'Revenue & Margin Analytics',  group: 'Analytics'   },
  { id: 'lcr_analyser',        label: 'LCR Analyser',                group: 'Analytics'   },
  { id: 'cdr_viewer',          label: 'CDR Viewer',                  group: 'Reports'     },
  { id: 'reports',             label: 'ASR / ACD Reports',           group: 'Reports'     },
  { id: 'route_quality',       label: 'Route Quality Analysis',      group: 'Reports'     },
] as const;

export type MonitoringItemId = typeof MONITORING_ITEMS[number]['id'];

// Management Configurable Features — which features Admin can grant/revoke for Management role
// featureKey maps to mgmtFeaturePermissions JSON array; route is enforced in ProtectedRoute
export const MGMT_CONFIGURABLE_FEATURES = [
  // Operations
  { key: 'alerts',             label: 'Alerts',                     route: '/alerts'                 },
  { key: 'server_monitoring',  label: 'Server Monitoring',          route: '/server-monitoring'      },
  { key: 'did_management',     label: 'DID Management',             route: '/dids'                   },
  { key: 'test_call',          label: 'Test Call / Click-to-Call',  route: '/test-call'              },
  { key: 'traffic_map',        label: 'Traffic Map',                route: '/traffic-map'            },
  { key: 'multi_switch',       label: 'Multi-Switch View',          route: '/multi-switch'           },
  { key: 'call_flow_simulator',label: 'Call Flow Simulator',        route: '/call-flow-simulator'    },
  // Analytics & Reports
  { key: 'graphs',             label: 'Graphs',                     route: '/graphs'                 },
  { key: 'bitseye',            label: 'BitsEye Live Graphs',        route: '/bitseye'                },
  { key: 'reports',            label: 'ASR / ACD Reports',          route: '/reports'                },
  { key: 'cdr_viewer',         label: 'CDR Viewer',                 route: '/cdrs'                   },
  { key: 'analytics',          label: 'Revenue & Margin Analytics', route: '/analytics'              },
  { key: 'lcr_analyser',       label: 'LCR Analyser',               route: '/lcr-analyser'           },
  // Finance
  { key: 'balance_monitor',    label: 'Balance Monitor',            route: '/balance'                },
  { key: 'rate_cards',         label: 'Rate Card Management',       route: '/rate-cards'             },
  { key: 'cost_optimisation',  label: 'Cost Optimisation Engine',   route: '/cost-optimisation'      },
  // Security & Fraud
  { key: 'fraud_fas',          label: 'FAS / Fraud Detection',      route: '/fraud'                  },
  { key: 'vendor_sla',         label: 'Vendor SLA Scorecard',       route: '/vendor-sla-scorecard'   },
  { key: 'sla_breaches',       label: 'SLA Breach Log',             route: '/sla-breaches'           },
  // Finance
  { key: 'billing_disputes',   label: 'Billing Dispute Tracker',    route: '/billing-disputes'       },
  // Analytics
  { key: 'qos_heatmap',        label: 'Route QoS Heatmap',         route: '/qos-heatmap'            },
  // Operations
  { key: 'test_campaigns',     label: 'Test Call Campaigns',        route: '/test-campaigns'         },
  // Client & Vendor
  { key: 'clients',            label: 'Client & Vendor Profiles',   route: '/clients'                },
  { key: 'vendor_connections', label: 'Vendor Connections',         route: '/vendors'                },
  { key: 'tools',              label: 'Tools / Calculators',        route: '/tools'                  },
  { key: 'products',           label: 'Product Classification',     route: '/products'               },
  // Routing
  { key: 'routing_manager',    label: 'Routing Manager',            route: '/routing-manager'        },
  { key: 'approval_queue',     label: 'Approval Queue',             route: '/approvals'              },
  { key: 'routing_audit',      label: 'Routing Audit Trail',        route: '/routing-audit'          },
  { key: 'routing_intelligence',label: 'Routing Intelligence',      route: '/routing-intelligence'   },
  // Network & Security
  { key: 'firewall',           label: 'Firewall Manager',           route: '/firewall'               },
  { key: 'compliance',         label: 'Compliance',                 route: '/compliance'             },
  { key: 'sbc_monitor',        label: 'SBC Monitor',                route: '/sbc-monitor'            },
  // Intelligence
  { key: 'carrier_scoring',    label: 'Carrier Scoring',            route: '/carrier-scoring'        },
  { key: 'sip_trace',          label: 'SIP Trace Viewer',           route: '/sip-trace'              },
  { key: 'network_topology',   label: 'Network Topology',           route: '/network-topology'       },
  { key: 'replay',             label: 'Replay Engine',              route: '/replay'                 },
  { key: 'rtp_analytics',      label: 'RTP Analytics',              route: '/rtp-analytics'          },
  { key: 'number_intelligence',label: 'Number Intelligence',        route: '/number-intelligence'    },
  // AI & Operations
  { key: 'ai_ops',             label: 'AI Ops Center',              route: '/ai-ops'                 },
  { key: 'noc_command',        label: 'NOC Command View',           route: '/noc-command'            },
  // Platform
  { key: 'reseller',           label: 'Reseller Management',        route: '/reseller'               },
  { key: 'client_portal',      label: 'Client Portal',              route: '/client-portal'          },
  { key: 'company_profile',    label: 'Rate Plan',                  route: '/company-profile'        },
  { key: 'chat',               label: 'Team Chat',                  route: '/chat'                   },
  // Account Management
  { key: 'account_management', label: 'Account Management — Company List',    route: '/company/list'   },
  { key: 'account_management', label: 'Account Management — Create Company',  route: '/company/create' },
  { key: 'account_management', label: 'Account Management — New Client Wizard', route: '/client/wizard' },
] as const;

export type MgmtFeatureKey = typeof MGMT_CONFIGURABLE_FEATURES[number]['key'];

// Monitoring Assignments: which monitoring items each team member is responsible for
export const monitoringAssignments = pgTable("monitoring_assignments", {
  userId:     varchar("user_id").primaryKey(),
  items:      text("items").array().notNull().default([]),
  assignedBy: varchar("assigned_by"),
  updatedAt:  timestamp("updated_at").defaultNow(),
});

export type MonitoringAssignment = typeof monitoringAssignments.$inferSelect;

// Team Roles: maps each user to their access role
export const userRoles = pgTable("user_roles", {
  userId: varchar("user_id").primaryKey(), // references users.id
  role: varchar("role", { length: 20 }).default('viewer').notNull(), // super_admin | admin | noc_operator | team_lead | management | viewer
  teamId: varchar("team_id", { length: 64 }),  // used for team_lead scoping — users with matching teamId
  assignedAt: timestamp("assigned_at").defaultNow(),
  assignedBy: varchar("assigned_by"), // userId of admin who assigned (null = auto)
});

export type UserRole = typeof userRoles.$inferSelect;
export type InsertUserRole = typeof userRoles.$inferInsert;

// Platform roles — ordered from highest to lowest authority.
// destination_manager: routing decision authority (approve/reject failover, edit thresholds, manage vendor whitelist)
// routing_admin:       routing execution authority (execute approved changes, rollback, modify route order)
// HARD GOVERNANCE RULE: approver ≠ executor — destination_manager approves, routing_admin executes.
export type Role =
  | 'super_admin'
  | 'admin'
  | 'destination_manager'
  | 'routing_admin'
  | 'noc_operator'
  | 'team_lead'
  | 'management'
  | 'viewer';

// Approval Workflow RBAC policy (configurable — policy may be updated over time)
export const APPROVAL_POLICY: Record<Role, { canSubmit: boolean; approveScope: 'all' | 'team' | 'none'; selfApproval: boolean }> = {
  super_admin:          { canSubmit: true,  approveScope: 'all',  selfApproval: true  },
  admin:                { canSubmit: true,  approveScope: 'all',  selfApproval: false },
  destination_manager:  { canSubmit: true,  approveScope: 'all',  selfApproval: false }, // approves failover; cannot execute
  routing_admin:        { canSubmit: true,  approveScope: 'none', selfApproval: false }, // executes approved changes; cannot self-approve
  noc_operator:         { canSubmit: true,  approveScope: 'none', selfApproval: false },
  team_lead:            { canSubmit: false, approveScope: 'team', selfApproval: false },
  management:           { canSubmit: true,  approveScope: 'none', selfApproval: false },
  viewer:               { canSubmit: false, approveScope: 'none', selfApproval: false },
};

// Approval Requests: queued change requests awaiting admin review
export const approvalRequests = pgTable("approval_requests", {
  id:              serial("id").primaryKey(),
  operationType:   varchar("operation_type",    { length: 64  }).notNull(), // e.g. routing_group.create
  action:          varchar("action",            { length: 20  }).notNull(), // create | update | delete
  entityId:        varchar("entity_id",         { length: 64  }),           // Sippy ID of affected entity
  entityName:      varchar("entity_name",       { length: 255 }),           // human-readable name
  payloadBefore:   json("payload_before"),                                   // current state snapshot (null for creates)
  payloadAfter:    json("payload_after"),                                    // requested new state (null for deletes)
  requestedBy:     varchar("requested_by",      { length: 255 }).notNull(),
  requestedByName: varchar("requested_by_name", { length: 128 }),
  teamId:          varchar("team_id",           { length: 64  }),            // team of requester (for team_lead routing)
  status:          varchar("status",            { length: 20  }).notNull().default('pending'), // pending | approved | rejected
  reviewedBy:      varchar("reviewed_by",       { length: 255 }),
  reviewedByName:  varchar("reviewed_by_name",  { length: 128 }),
  reviewedAt:      timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  selfApproval:    boolean("self_approval").default(false),                  // true when Super Admin approves own request
  requestedAt:     timestamp("requested_at").defaultNow(),
  // ── Feature 3: Rule Execution Engine ──────────────────────────────────────
  source:          varchar("source",            { length: 32  }).default('manual'), // manual | rule_engine | rollback
  ruleId:          integer("rule_id"),                                       // FK → routing_rules.id (when fired by rule engine)
  rollbackOf:      integer("rollback_of"),                                   // FK → approval_requests.id (when this is a rollback)
  execResult:      json("exec_result"),                                      // Sippy XML-RPC result stored after execution
});

export type ApprovalRequest    = typeof approvalRequests.$inferSelect;
export type InsertApprovalRequest = typeof approvalRequests.$inferInsert;

// Approval Audit Log: immutable history of every approval decision
export const approvalAuditLog = pgTable("approval_audit_log", {
  id:        serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  action:    varchar("action",     { length: 32  }).notNull(), // submitted | approved | rejected
  actorId:   varchar("actor_id",   { length: 255 }).notNull(),
  actorName: varchar("actor_name", { length: 128 }),
  actorRole: varchar("actor_role", { length: 32  }),
  note:      text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ApprovalAuditEntry = typeof approvalAuditLog.$inferSelect;

// === SCHEMAS ===

export const insertCallSchema = createInsertSchema(calls).omit({ id: true, startTime: true, endTime: true });
export const insertMetricSchema = createInsertSchema(metrics).omit({ id: true, timestamp: true });
export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, createdAt: true });
export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });

// === TYPES ===

export type Call = typeof calls.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Settings = typeof settings.$inferSelect;

export type InsertCall = z.infer<typeof insertCallSchema>;
export type InsertMetric = z.infer<typeof insertMetricSchema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;

// Sippy state snapshots — persists across restarts for change detection
export const sippySnapshots = pgTable("sippy_snapshots", {
  key:       text("key").primaryKey(),
  data:      json("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Sippy change events — persistent audit trail for the watcher
// One row per detected change; surfaced as a click-through audit log in Settings
export const sippyChangeEvents = pgTable("sippy_change_events", {
  id:          serial("id").primaryKey(),
  category:    varchar("category",    { length: 32 }).notNull(),  // accounts | vendors | connections | authRules | seenClients
  changeType:  varchar("change_type", { length: 32 }).notNull(),  // account_added | ip_changed | new_traffic | …
  subject:     text("subject").notNull(),
  clientName:  varchar("client_name", { length: 255 }),
  vendorName:  varchar("vendor_name", { length: 255 }),
  oldValue:    text("old_value"),
  newValue:    text("new_value"),
  meta:        json("meta"),
  detectedAt:  timestamp("detected_at").defaultNow().notNull(),
});
export type SippyChangeEvent = typeof sippyChangeEvents.$inferSelect;
export type InsertSippyChangeEvent = typeof sippyChangeEvents.$inferInsert;

// ── IRSF Events: International Revenue Share Fraud detections ─────────────────
export const irsfEvents = pgTable("irsf_events", {
  id:          serial("id").primaryKey(),
  callId:      varchar("call_id",      { length: 64 }).notNull(),
  caller:      varchar("caller",       { length: 64 }),
  callee:      varchar("callee",       { length: 64 }),
  clientName:  varchar("client_name",  { length: 128 }),
  vendor:      varchar("vendor",       { length: 128 }),
  riskPrefix:  varchar("risk_prefix",  { length: 20 }),
  country:     varchar("country",      { length: 64 }),
  breakout:    varchar("breakout",     { length: 64 }),
  fraudScore:  real("fraud_score").default(100),
  blocked:     boolean("blocked").default(false),
  alertSent:   boolean("alert_sent").default(false),
  detectedAt:  timestamp("detected_at").defaultNow(),
});
export type IrsfEvent = typeof irsfEvents.$inferSelect;
export type InsertIrsfEvent = typeof irsfEvents.$inferInsert;
export const insertIrsfEventSchema = createInsertSchema(irsfEvents).omit({ id: true, detectedAt: true });

// ── Blacklist Rules: auto-block entries for callers, callees, or prefixes ────
export const blacklistRules = pgTable("blacklist_rules", {
  id:         serial("id").primaryKey(),
  type:       varchar("type",    { length: 20 }).notNull(),  // caller | callee | prefix
  value:      varchar("value",   { length: 64  }).notNull(), // the number / prefix to block
  reason:     text("reason"),
  source:     varchar("source",  { length: 32  }).default('manual'), // manual | irsf | fas | robocall
  active:     boolean("active").default(true),
  hitCount:   integer("hit_count").default(0),
  createdAt:  timestamp("created_at").defaultNow(),
});
export type BlacklistRule = typeof blacklistRules.$inferSelect;
export type InsertBlacklistRule = typeof blacklistRules.$inferInsert;
export const insertBlacklistRuleSchema = createInsertSchema(blacklistRules).omit({ id: true, createdAt: true, hitCount: true });

// ── Rate Cards: carrier buy-rate sheets ──────────────────────────────────────
export const rateCards = pgTable("rate_cards", {
  id:             serial("id").primaryKey(),
  vendorName:     varchar("vendor_name",  { length: 128 }).notNull(),
  name:           varchar("name",         { length: 128 }).notNull(),
  cardType:       varchar("card_type",    { length: 10  }).default('vendor').notNull(), // 'client' | 'vendor'
  currency:       varchar("currency",     { length: 8   }).default('USD'),
  effectiveDate:  timestamp("effective_date"),
  entryCount:     integer("entry_count").default(0),
  createdAt:      timestamp("created_at").defaultNow(),
  sippyTariffId:  integer("sippy_tariff_id"),  // linked Sippy tariff — populated when created from Sippy dropdown
});
export type RateCard = typeof rateCards.$inferSelect;
export type InsertRateCard = typeof rateCards.$inferInsert;
export const insertRateCardSchema = createInsertSchema(rateCards).omit({ id: true, createdAt: true, entryCount: true });

// ── Rate Card Entries: individual prefix → rate mappings ─────────────────────
export const rateCardEntries = pgTable("rate_card_entries", {
  id:            serial("id").primaryKey(),
  rateCardId:    integer("rate_card_id").notNull(),
  prefix:        varchar("prefix",        { length: 20  }).notNull(),
  country:       varchar("country",       { length: 255 }),
  breakout:      varchar("breakout",      { length: 255 }),
  ratePerMin:    real("rate_per_min").notNull(),
  originPrefix:  varchar("origin_prefix", { length: 20  }),  // origin-based rate: originating prefix (optional)
});
export type RateCardEntry = typeof rateCardEntries.$inferSelect;
export type InsertRateCardEntry = typeof rateCardEntries.$inferInsert;

// ── MOS Hourly Snapshots: hourly quality aggregates for trend charts ──────────
export const mosHourly = pgTable("mos_hourly", {
  id:         serial("id").primaryKey(),
  hour:       timestamp("hour").notNull(),           // truncated to hour boundary
  vendor:     varchar("vendor", { length: 128 }),    // null = system-wide
  avgMos:     real("avg_mos"),
  minMos:     real("min_mos"),
  maxMos:     real("max_mos"),
  callCount:  integer("call_count").default(0),
  createdAt:  timestamp("created_at").defaultNow(),
});
export type MosHourly = typeof mosHourly.$inferSelect;

// Watcher alert recipients — team members / emails that receive Sippy change alerts
export const watcherRecipients = pgTable("watcher_recipients", {
  id:                   serial("id").primaryKey(),
  email:                varchar("email",        { length: 255 }).notNull(),
  displayName:          varchar("display_name", { length: 255 }),
  userId:               varchar("user_id",      { length: 255 }),  // optional link to a system user
  active:               boolean("active").default(true).notNull(),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  // Per-operator notification preference — when false this operator won't receive approval expiry emails
  notifyApprovalExpiry: boolean("notify_approval_expiry").default(true).notNull(),
});

export const insertWatcherRecipientSchema = createInsertSchema(watcherRecipients).omit({ id: true, createdAt: true });
export type InsertWatcherRecipient = z.infer<typeof insertWatcherRecipientSchema>;
export type WatcherRecipient = typeof watcherRecipients.$inferSelect;

// ── API Keys (Tier 5 — #24) ──────────────────────────────────────────────────
export const apiKeys = pgTable("api_keys", {
  id:          serial("id").primaryKey(),
  userId:      varchar("user_id").notNull(),
  name:        varchar("name", { length: 128 }).notNull(),
  keyHash:     varchar("key_hash", { length: 64 }).notNull(),   // SHA-256 hex of the raw key
  keyPrefix:   varchar("key_prefix", { length: 12 }).notNull(), // first 12 chars shown in UI
  permissions: text("permissions").array().notNull().default([]),
  active:      boolean("active").notNull().default(true),
  lastUsedAt:  timestamp("last_used_at"),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true, createdAt: true, lastUsedAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;

// ── Dashboard Widget Prefs (Tier 5 — #20) ────────────────────────────────────
export const dashboardWidgetPrefs = pgTable("dashboard_widget_prefs", {
  userId:        varchar("user_id").primaryKey(),
  hiddenWidgets: text("hidden_widgets").array().notNull().default([]),
  widgetOrder:   text("widget_order").array().notNull().default([]),
  updatedAt:     timestamp("updated_at").defaultNow(),
});

export type DashboardWidgetPrefs = typeof dashboardWidgetPrefs.$inferSelect;

// ── Call Test Logs — stores test-call history ─────────────────────────────────
export const callTestLogs = pgTable("call_test_logs", {
  id:          serial("id").primaryKey(),
  userId:      varchar("user_id").notNull(),
  cli:         varchar("cli", { length: 64 }).notNull(),
  cld:         varchar("cld", { length: 64 }).notNull(),
  iAccount:    integer("i_account"),
  callId:      varchar("call_id", { length: 128 }),
  status:      varchar("status", { length: 16 }).notNull().default('pending'), // pending | success | error
  message:     text("message"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const insertCallTestLogSchema = createInsertSchema(callTestLogs).omit({ id: true, createdAt: true });
export type InsertCallTestLog = z.infer<typeof insertCallTestLogSchema>;
export type CallTestLog = typeof callTestLogs.$inferSelect;

// Fix History — Phase 3 (tracks every diagnostic run + fix attempt for learning)
export const fixHistory = pgTable("fix_history", {
  id:             serial("id").primaryKey(),
  page:           varchar("page",           { length: 200 }),
  issueType:      varchar("issue_type",     { length: 50  }).notNull(),
  component:      varchar("component",      { length: 100 }),
  fixAction:      varchar("fix_action",     { length: 100 }),
  outcome:        varchar("outcome",        { length: 20  }).notNull(), // 'success' | 'failure' | 'auto' | 'skipped'
  outcomeMessage: text("outcome_message"),
  triggeredBy:    varchar("triggered_by",   { length: 20  }).notNull().default('manual'), // 'manual' | 'auto'
  performedBy:    varchar("performed_by",   { length: 200 }),
  screenshot:     text("screenshot"),       // base64 JPEG captured at fix time (nullable)
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export const insertFixHistorySchema = createInsertSchema(fixHistory).omit({ id: true, createdAt: true });
export type InsertFixHistory = z.infer<typeof insertFixHistorySchema>;
export type FixHistory = typeof fixHistory.$inferSelect;

// ── SIMbox Risk Scores — per-vendor detection window scores ──────────────────
export const simboxScores = pgTable("simbox_scores", {
  id:              serial("id").primaryKey(),
  vendorId:        varchar("vendor_id",   { length: 64 }).notNull(),
  vendorName:      varchar("vendor_name", { length: 128 }).notNull(),
  windowStart:     timestamp("window_start").notNull(),
  windowEnd:       timestamp("window_end").notNull(),
  riskScore:       real("risk_score").notNull().default(0),   // 0–100
  riskLevel:       varchar("risk_level",  { length: 10 }).notNull().default('low'), // low|medium|high|critical
  totalCalls:      integer("total_calls").notNull().default(0),
  shortCalls:      integer("short_calls").notNull().default(0),        // < 8s
  earlyDisconnect: integer("early_disconnect").notNull().default(0),   // < 4s
  repeatedRoutes:  integer("repeated_routes").notNull().default(0),    // same CLI→CLD combos
  uniqueCli:       integer("unique_cli").notNull().default(0),
  uniqueCld:       integer("unique_cld").notNull().default(0),
  avgDurationSec:  real("avg_duration_sec").notNull().default(0),
  signalDetails:   text("signal_details"),                            // JSON array of triggered signals
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type SimboxScore = typeof simboxScores.$inferSelect;
export type InsertSimboxScore = typeof simboxScores.$inferInsert;

// ── Billing Disputes — carrier CDR mismatch tracker ─────────────────────────
export const billingDisputes = pgTable("billing_disputes", {
  id:             serial("id").primaryKey(),
  vendorName:     varchar("vendor_name",    { length: 128 }).notNull(),
  periodStart:    timestamp("period_start").notNull(),
  periodEnd:      timestamp("period_end").notNull(),
  ourAmount:      real("our_amount").notNull().default(0),       // USD — what our Sippy says
  vendorAmount:   real("vendor_amount").notNull().default(0),    // USD — what vendor invoice says
  discrepancy:    real("discrepancy").notNull().default(0),       // ourAmount - vendorAmount
  currency:       varchar("currency",       { length: 8  }).default('USD'),
  status:         varchar("status",         { length: 20 }).notNull().default('open'), // open|under_review|resolved
  resolution:     real("resolution"),           // agreed settlement amount
  notes:          text("notes"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
});
export type BillingDispute = typeof billingDisputes.$inferSelect;
export type InsertBillingDispute = typeof billingDisputes.$inferInsert;
export const insertBillingDisputeSchema = createInsertSchema(billingDisputes).omit({ id: true, createdAt: true, updatedAt: true });

// ── SLA Breach Log — automatic threshold violation events ────────────────────
export const slaBreachLog = pgTable("sla_breach_log", {
  id:              serial("id").primaryKey(),
  vendorId:        varchar("vendor_id",   { length: 64 }).notNull(),
  vendorName:      varchar("vendor_name", { length: 128 }).notNull(),
  metric:          varchar("metric",      { length: 20 }).notNull(), // asr|acd|pdd|ner
  threshold:       real("threshold").notNull(),
  actualValue:     real("actual_value").notNull(),
  breachStart:     timestamp("breach_start").notNull(),
  breachEnd:       timestamp("breach_end"),   // null = still ongoing
  durationMinutes: real("duration_minutes"),
  resolved:        boolean("resolved").default(false),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type SlaBreachEntry = typeof slaBreachLog.$inferSelect;
export type InsertSlaBreachEntry = typeof slaBreachLog.$inferInsert;

// ── Test Campaigns — scheduled test call batches ─────────────────────────────
export const testCampaigns = pgTable("test_campaigns", {
  id:              serial("id").primaryKey(),
  name:            varchar("name",         { length: 128 }).notNull(),
  destinations:    text("destinations").notNull(),   // JSON: [{cld, cli, label}]
  scheduleType:    varchar("schedule_type", { length: 20 }).notNull().default('once'), // once|interval|daily|hourly
  scheduledAt:     timestamp("scheduled_at"),         // for 'once' — when to run
  cronHour:        integer("cron_hour"),               // for 'daily' — hour UTC (0-23)
  intervalMinutes: integer("interval_minutes"),        // for 'interval' — repeat every N minutes
  nextRunAt:       timestamp("next_run_at"),           // computed: when scheduler fires next
  enabled:         boolean("enabled").notNull().default(true),
  baselineAsr:     real("baseline_asr"),              // rolling average ASR across last 10 runs (0–100)
  baselinePdd:     real("baseline_pdd"),              // rolling average PDD ms
  status:          varchar("status",       { length: 20 }).notNull().default('pending'), // pending|running|done|failed
  lastRunAt:       timestamp("last_run_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type TestCampaign = typeof testCampaigns.$inferSelect;
export type InsertTestCampaign = typeof testCampaigns.$inferInsert;
export const insertTestCampaignSchema = createInsertSchema(testCampaigns).omit({ id: true, createdAt: true, lastRunAt: true, nextRunAt: true, baselineAsr: true, baselinePdd: true });

// ── Synthetic Test Runs — one record per scheduled campaign execution ─────────
export const syntheticTestRuns = pgTable("synthetic_test_runs", {
  id:               serial("id").primaryKey(),
  campaignId:       integer("campaign_id").notNull(),
  startedAt:        timestamp("started_at").defaultNow().notNull(),
  completedAt:      timestamp("completed_at"),
  totalCalls:       integer("total_calls").notNull().default(0),
  connectedCalls:   integer("connected_calls").notNull().default(0),
  failedCalls:      integer("failed_calls").notNull().default(0),
  infraFailures:    integer("infra_failures").notNull().default(0),   // excluded from ASR
  carrierFailures:  integer("carrier_failures").notNull().default(0),
  asr:              real("asr"),                   // % connected for this run (excl. infra)
  avgPddMs:         real("avg_pdd_ms"),
  baselineAsrAtRun: real("baseline_asr_at_run"),  // snapshot of baseline when run fired
  anomalyFired:        boolean("anomaly_fired").notNull().default(false),
  degradedVsLastRun:   boolean("degraded_vs_last_run").notNull().default(false),
  triggeredBy:         varchar("triggered_by", { length: 20 }).notNull().default('scheduler'), // scheduler|manual
});
export type SyntheticTestRun = typeof syntheticTestRuns.$inferSelect;
export type InsertSyntheticTestRun = typeof syntheticTestRuns.$inferInsert;

// ── Test Campaign Results — individual call outcomes per campaign run ─────────
export const testCampaignResults = pgTable("test_campaign_results", {
  id:           serial("id").primaryKey(),
  campaignId:   integer("campaign_id").notNull(),
  runAt:        timestamp("run_at").defaultNow().notNull(),
  cld:          varchar("cld", { length: 64 }).notNull(),
  cli:          varchar("cli", { length: 64 }),
  label:        varchar("label", { length: 128 }),
  outcome:      varchar("outcome",  { length: 20 }).notNull().default('pending'), // pending|connected|failed|timeout
  sipCode:      integer("sip_code"),
  durationSec:  real("duration_sec"),
  pddMs:        real("pdd_ms"),
  fasDetected:  boolean("fas_detected").default(false),
  notes:        text("notes"),
});
export type TestCampaignResult = typeof testCampaignResults.$inferSelect;
export type InsertTestCampaignResult = typeof testCampaignResults.$inferInsert;

// ── Route Decision Traces — per-call routing resolution log ──────────────────
export const routeDecisionTraces = pgTable("route_decision_traces", {
  id:                   serial("id").primaryKey(),
  campaignId:           integer("campaign_id"),
  runId:                integer("run_id"),
  cld:                  varchar("cld",    { length: 64 }).notNull(),
  cli:                  varchar("cli",    { length: 64 }),
  selectedCarrier:      varchar("selected_carrier",   { length: 128 }),
  selectedCarrierId:    integer("selected_carrier_id"),
  candidateRoutes:      text("candidate_routes"),       // JSON: [{groupId, groupName, carrierId, carrierName, priority}]
  decisionReason:       varchar("decision_reason",      { length: 255 }),
  outcome:              varchar("outcome",              { length: 20 }),
  sipCode:              integer("sip_code"),
  pddMs:                real("pdd_ms"),
  durationSec:          real("duration_sec"),
  failureCategory:      varchar("failure_category",     { length: 64 }),  // user_not_found|no_route|timeout|network|fas|other
  // ── Phase 1 + Phase 5 additions ──────────────────────────────────────────
  failureType:          varchar("failure_type",         { length: 32  }),  // carrier_failure | infra_failure
  carrierScoresSnapshot: text("carrier_scores_snapshot"),                   // JSON: {carrierName: stabilityScore} at execution time
  createdAt:            timestamp("created_at").defaultNow().notNull(),
});

// ── Execution Health Log — infra noise stream (separate from carrier failures) ─
export const executionHealthLog = pgTable("execution_health_log", {
  id:           serial("id").primaryKey(),
  campaignId:   integer("campaign_id"),
  runId:        integer("run_id"),
  cld:          varchar("cld",           { length: 64 }),
  cli:          varchar("cli",           { length: 64 }),
  errorType:    varchar("error_type",    { length: 32 }),  // timeout|auth|xmlrpc|network|null_result
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(1),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});
export type ExecutionHealthEntry    = typeof executionHealthLog.$inferSelect;
export type InsertExecutionHealthEntry = typeof executionHealthLog.$inferInsert;
export type RouteDecisionTrace    = typeof routeDecisionTraces.$inferSelect;
export type InsertRouteDecisionTrace = typeof routeDecisionTraces.$inferInsert;

// ── Carrier Quality Scores — rolling metric aggregation per carrier ───────────
export const carrierQualityScores = pgTable("carrier_quality_scores", {
  id:             serial("id").primaryKey(),
  carrierId:      varchar("carrier_id",   { length: 64  }).notNull(),
  carrierName:    varchar("carrier_name", { length: 128 }).notNull(),
  windowHours:    integer("window_hours").notNull().default(24),
  sampleCount:    integer("sample_count").notNull().default(0),
  connectedCount: integer("connected_count").notNull().default(0),
  failedCount:    integer("failed_count").notNull().default(0),
  rollingAsr:     real("rolling_asr"),
  avgPddMs:       real("avg_pdd_ms"),
  p95PddMs:       real("p95_pdd_ms"),
  failureRate:    real("failure_rate"),
  stabilityScore: real("stability_score"),   // 0–100 composite
  trend:          varchar("trend", { length: 16 }),  // improving|stable|degrading
  lastComputedAt: timestamp("last_computed_at").defaultNow().notNull(),
});
export type CarrierQualityScore    = typeof carrierQualityScores.$inferSelect;
export type InsertCarrierQualityScore = typeof carrierQualityScores.$inferInsert;

// ── Scheduled Reports — auto-email report configurations ─────────────────────
export const scheduledReports = pgTable("scheduled_reports", {
  id:          serial("id").primaryKey(),
  name:        varchar("name",       { length: 128 }).notNull(),
  metrics:     text("metrics").notNull().default('["asr","acd","ner"]'), // JSON array of metric keys
  timeWindow:  varchar("time_window", { length: 20 }).notNull().default('24h'), // 1h|24h|7d|30d
  frequency:   varchar("frequency",  { length: 20 }).notNull().default('daily'), // hourly|daily|weekly
  recipients:  text("recipients").notNull(),    // comma-separated emails
  enabled:     boolean("enabled").notNull().default(true),
  lastSentAt:  timestamp("last_sent_at"),
  nextDueAt:   timestamp("next_due_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
export type ScheduledReport = typeof scheduledReports.$inferSelect;
export type InsertScheduledReport = typeof scheduledReports.$inferInsert;
export const insertScheduledReportSchema = createInsertSchema(scheduledReports).omit({ id: true, createdAt: true, lastSentAt: true, nextDueAt: true });

// API Request Types
export type UpdateSettingsRequest = Partial<InsertSettings>;

// API Response Types
export type DashboardStats = {
  activeCalls: number;
  avgMos: number;
  alertsToday: number;
  systemHealth: 'Healthy' | 'Degraded' | 'Critical';
  asr: number;   // Answer-Seizure Ratio (%)
  acd: number;   // Average Call Duration (seconds)
  pdd: number;   // Post-Dial Delay (seconds)
  ckRatio: number;  // Connection Rate (%) — confirmed connected vs total attempted
  ckBreakdown: {
    connected: number;
    wrongNumber: number;
    switchedOff: number;
    untraceable: number;
    total: number;
  };
};

export type CallWithLatestMetric = Call & {
  latestMetric?: Metric;
};

// ASR/ACD Report row — one row per caller (CLI)
export type AsrAcdReportRow = {
  caller: string;
  totalCalls: number;
  billableCalls: number;
  billedDurationSeconds: number; // total answered duration in seconds
  acdSeconds: number;            // avg call duration in seconds
  asr: number;                   // answer-seizure ratio %
  avgPdd: number;                // average post-dial delay seconds
  revenueUsd: number;            // estimated revenue
  // ── NER + FAS overlay fields (populated by CDR-cache path; portal path approximates) ──
  nerPct?: number;    // Network Effectiveness Ratio % = (answered + RNA) / total × 100
  fasRate?: number;   // FAS risk rate % = short-billed answered calls (≤5 s) / billable × 100
  rnaCount?: number;  // Ring No Answer count (XML-RPC CDRs only; 0 for portal CDRs)
};

export type AsrAcdReportFilters = {
  cliFilter?: string;
  cldFilter?: string;
  startTime?: string;
  endTime?: string;
  highlightAsrBelow?: number;
  groupBy?: 'caller' | 'callee';
  sortBy?: 'totalCalls' | 'asr' | 'billableCalls' | 'revenueUsd';
  hideEmpty?: boolean;
};

// ── Routing Cache (local snapshot of Sippy routing data) ───────────────────────

export const routingGroupsCache = pgTable("routing_groups_cache", {
  id:            serial("id").primaryKey(),
  iRoutingGroup: integer("i_routing_group").notNull().unique(),
  name:          varchar("name", { length: 255 }).notNull(),
  policy:        varchar("policy", { length: 64 }),          // least_cost | prefix | preference | order | weighted
  mediaRelay:    varchar("media_relay", { length: 64 }),
  onNet:         boolean("on_net").default(false),
  membersCount:  integer("members_count").default(0),
  rawJson:       text("raw_json"),                            // full JSON from Sippy for reference
  cachedAt:      timestamp("cached_at").defaultNow(),
});
export type RoutingGroupCache = typeof routingGroupsCache.$inferSelect;

export const destinationSetsCache = pgTable("destination_sets_cache", {
  id:               serial("id").primaryKey(),
  iDestinationSet:  integer("i_destination_set").notNull().unique(),
  name:             varchar("name", { length: 255 }).notNull(),
  routeCount:       integer("route_count").default(0),
  cldTranslation:   varchar("cld_translation", { length: 255 }),
  cliTranslation:   varchar("cli_translation", { length: 255 }),
  rawJson:          text("raw_json"),
  cachedAt:         timestamp("cached_at").defaultNow(),
});
export type DestinationSetCache = typeof destinationSetsCache.$inferSelect;

export const connectionVendorCache2 = pgTable("connection_vendor_cache2", {
  id:          serial("id").primaryKey(),
  iConnection: integer("i_connection").notNull().unique(),
  name:        varchar("name", { length: 255 }).notNull(),
  iVendor:     integer("i_vendor"),
  vendorName:  varchar("vendor_name", { length: 255 }),
  host:        varchar("host", { length: 255 }),
  protocol:    varchar("protocol", { length: 32 }),
  blocked:     boolean("blocked").default(false),
  rawJson:     text("raw_json"),
  cachedAt:    timestamp("cached_at").defaultNow(),
});
export type ConnectionVendorCache2 = typeof connectionVendorCache2.$inferSelect;

export const routingCacheMeta = pgTable("routing_cache_meta", {
  id:             serial("id").primaryKey(),
  lastSyncAt:     timestamp("last_sync_at"),
  lastSyncStatus: varchar("last_sync_status", { length: 32 }).default('pending'), // ok | error | syncing
  lastSyncError:  text("last_sync_error"),
  rgCount:        integer("rg_count").default(0),
  dsCount:        integer("ds_count").default(0),
  connCount:      integer("conn_count").default(0),
});

// ── Internal Team Chat ─────────────────────────────────────────────────────────

export const chatRooms = pgTable("chat_rooms", {
  id:        serial("id").primaryKey(),
  name:      varchar("name",   { length: 128 }).notNull(),
  type:      varchar("type",   { length: 16 }).notNull().default('group'), // 'group' | 'direct'
  slug:      varchar("slug",   { length: 128 }).notNull().unique(), // e.g. 'general', 'dm_uid1_uid2'
  createdAt: timestamp("created_at").defaultNow(),
});

export type ChatRoom = typeof chatRooms.$inferSelect;
export type InsertChatRoom = typeof chatRooms.$inferInsert;
export const insertChatRoomSchema = createInsertSchema(chatRooms).omit({ id: true, createdAt: true });

export const chatMessages = pgTable("chat_messages", {
  id:          serial("id").primaryKey(),
  roomId:      integer("room_id").notNull(),
  senderId:    varchar("sender_id",   { length: 255 }).notNull(),
  senderName:  varchar("sender_name", { length: 128 }).notNull(),
  senderRole:  varchar("sender_role", { length: 32 }).notNull().default('viewer'),
  content:     text("content").notNull(),
  createdAt:   timestamp("created_at").defaultNow(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });

// Product Documents — per-product-class wiki/spec documents
export const productDocs = pgTable("product_docs", {
  id:            serial("id").primaryKey(),
  productPrefix: varchar("product_prefix", { length: 16 }).notNull(), // '1' | '2' | '6' | '7'
  title:         varchar("title", { length: 255 }).notNull(),
  section:       varchar("section", { length: 64 }).notNull().default('General'),
  content:       text("content").notNull().default(''),
  sortOrder:     integer("sort_order").notNull().default(0),
  updatedBy:     varchar("updated_by", { length: 255 }),
  updatedAt:     timestamp("updated_at").defaultNow(),
  createdAt:     timestamp("created_at").defaultNow(),
});

export type ProductDoc = typeof productDocs.$inferSelect;
export type InsertProductDoc = typeof productDocs.$inferInsert;
export const insertProductDocSchema = createInsertSchema(productDocs).omit({ id: true, createdAt: true, updatedAt: true });
export const updateProductDocSchema = insertProductDocSchema.partial();

// ── Routing Intelligence — automated rule engine ───────────────────────────────

export const routingRules = pgTable("routing_rules", {
  id:                   serial("id").primaryKey(),
  name:                 varchar("name",                 { length: 128 }).notNull(),
  enabled:              boolean("enabled").notNull().default(true),
  conditionMetric:      varchar("condition_metric",      { length: 64 }).notNull(),  // asr|acd|concurrent_calls|cost_per_min|mos|pdd|packet_loss
  conditionOperator:    varchar("condition_operator",    { length: 16 }).notNull(),  // lt|gt|lte|gte
  conditionThreshold:   real("condition_threshold").notNull(),
  conditionDurationMin: integer("condition_duration_min").notNull().default(5),
  scopeVendor:          varchar("scope_vendor",          { length: 128 }),
  scopeDestination:     varchar("scope_destination",     { length: 64 }),
  actionType:           varchar("action_type",           { length: 64 }).notNull(),  // alert|deprioritise|flag_approval|block
  actionPayload:        text("action_payload"),
  lastTriggeredAt:      timestamp("last_triggered_at"),
  triggerCount:         integer("trigger_count").notNull().default(0),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
});
export type RoutingRule = typeof routingRules.$inferSelect;
export type InsertRoutingRule = typeof routingRules.$inferInsert;
export const insertRoutingRuleSchema = createInsertSchema(routingRules).omit({ id: true, lastTriggeredAt: true, triggerCount: true, createdAt: true });

// ── Number Intelligence — lookup cache ────────────────────────────────────────

export const numberLookupCache = pgTable("number_lookup_cache", {
  id:              serial("id").primaryKey(),
  number:          varchar("number",       { length: 32  }).notNull().unique(),
  country:         varchar("country",      { length: 64  }),
  countryCode:     varchar("country_code", { length: 4   }),
  carrier:         varchar("carrier",      { length: 128 }),
  lineType:        varchar("line_type",    { length: 32  }),  // mobile|fixed|voip|toll_free|unknown
  ported:          boolean("ported"),
  active:          boolean("active"),
  roaming:         boolean("roaming"),
  cnam:            varchar("cnam",         { length: 128 }),
  stirShaken:      varchar("stir_shaken",  { length: 8   }),  // A|B|C|unsigned|unknown
  reputationScore: integer("reputation_score"),               // 0–100
  rawJson:         text("raw_json"),
  lookedUpAt:      timestamp("looked_up_at").defaultNow(),
});
export type NumberLookup = typeof numberLookupCache.$inferSelect;

// ── GDPR / Compliance — Data Retention Policy ─────────────────────────────────

export const dataRetentionPolicy = pgTable("data_retention_policy", {
  id:            serial("id").primaryKey(),
  dataType:      varchar("data_type",  { length: 64  }).notNull().unique(), // fas_events|number_lookup|cdrs
  label:         varchar("label",      { length: 128 }).notNull(),
  retentionDays: integer("retention_days").notNull().default(90),
  enabled:       boolean("enabled").notNull().default(true),
  lastPurgedAt:  timestamp("last_purged_at"),
  purgedCount:   integer("purged_count").default(0),
  updatedAt:     timestamp("updated_at").defaultNow(),
});
export type DataRetentionPolicy = typeof dataRetentionPolicy.$inferSelect;

// ── GDPR / Compliance — Deletion Requests ─────────────────────────────────────

export const deletionRequests = pgTable("deletion_requests", {
  id:             serial("id").primaryKey(),
  requestedBy:    varchar("requested_by",  { length: 128 }).notNull(),
  dataSubject:    varchar("data_subject",  { length: 255 }).notNull(),
  dataType:       varchar("data_type",     { length: 64  }).notNull(), // fas_events|number_lookup|cdrs|all
  reason:         text("reason"),
  status:         varchar("status",        { length: 20  }).notNull().default('pending'), // pending|in_progress|completed|rejected|failed
  requestedAt:    timestamp("requested_at").defaultNow().notNull(),
  completedAt:    timestamp("completed_at"),
  executedBy:     varchar("executed_by",   { length: 128 }),
  recordsDeleted: integer("records_deleted").default(0),
  auditNote:      text("audit_note"),
});
export type DeletionRequest = typeof deletionRequests.$inferSelect;
export type InsertDeletionRequest = typeof deletionRequests.$inferInsert;

// ── SBC Monitor — session border controller hosts ─────────────────────────────

export const sbcHosts = pgTable("sbc_hosts", {
  id:             serial("id").primaryKey(),
  name:           varchar("name",           { length: 128 }).notNull(),
  host:           varchar("host",           { length: 255 }).notNull(),
  port:           integer("port").notNull().default(5060),
  vendor:         varchar("vendor",         { length: 64  }).notNull().default('generic'),
  snmpCommunity:  varchar("snmp_community", { length: 64  }),
  apiUrl:         varchar("api_url",        { length: 255 }),
  apiKey:         varchar("api_key",        { length: 255 }),
  enabled:        boolean("enabled").notNull().default(true),
  lastStatus:     varchar("last_status",    { length: 32  }).default('unknown'),  // ok|degraded|down|unknown
  lastCheckedAt:  timestamp("last_checked_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
export type SbcHost = typeof sbcHosts.$inferSelect;
export type InsertSbcHost = typeof sbcHosts.$inferInsert;
export const insertSbcHostSchema = createInsertSchema(sbcHosts).omit({ id: true, lastStatus: true, lastCheckedAt: true, createdAt: true });

// ── Reseller Management ───────────────────────────────────────────────────────

export const resellerProfiles = pgTable("reseller_profiles", {
  id:            serial("id").primaryKey(),
  name:          varchar("name",          { length: 128 }).notNull(),
  contactEmail:  varchar("contact_email", { length: 255 }),
  markupPercent: real("markup_percent").notNull().default(0),
  iCustomer:     integer("i_customer"),
  brandName:     varchar("brand_name",    { length: 128 }),
  active:        boolean("active").notNull().default(true),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
export type ResellerProfile = typeof resellerProfiles.$inferSelect;
export type InsertResellerProfile = typeof resellerProfiles.$inferInsert;
export const insertResellerProfileSchema = createInsertSchema(resellerProfiles).omit({ id: true, createdAt: true });

// ── Statistical Anomaly Engine ────────────────────────────────────────────────

// Rolling per-vendor per-metric baseline statistics (computed from CDR cache)
export const vendorMetricBaselines = pgTable("vendor_metric_baselines", {
  id:          serial("id").primaryKey(),
  vendor:      varchar("vendor",  { length: 128 }).notNull(),
  metric:      varchar("metric",  { length: 32  }).notNull(),  // asr | acd | cps
  mean:        real("mean").notNull(),
  stddev:      real("stddev").notNull(),
  sampleCount: integer("sample_count").notNull(),
  windowHours: integer("window_hours").notNull().default(72),
  computedAt:  timestamp("computed_at").defaultNow().notNull(),
});
export type VendorMetricBaseline = typeof vendorMetricBaselines.$inferSelect;

// Detected anomaly events written by the statistical engine
export const anomalyEvents = pgTable("anomaly_events", {
  id:               serial("id").primaryKey(),
  vendor:           varchar("vendor",     { length: 128 }),
  metric:           varchar("metric",     { length: 32  }).notNull(),  // asr | acd | cps
  severity:         varchar("severity",   { length: 16  }).notNull(),  // critical | high | medium | low
  title:            text("title").notNull(),
  description:      text("description").notNull(),
  rootCause:        text("root_cause").notNull(),
  recommendation:   text("recommendation").notNull(),
  affectedEntities: text("affected_entities").array().notNull(),
  currentValue:     real("current_value").notNull(),
  baselineMean:     real("baseline_mean").notNull(),
  baselineStddev:   real("baseline_stddev").notNull(),
  deviationSigma:   real("deviation_sigma").notNull(),
  resolved:         boolean("resolved").notNull().default(false),
  resolvedAt:       timestamp("resolved_at"),
  detectedAt:       timestamp("detected_at").defaultNow().notNull(),
});
export type AnomalyEvent = typeof anomalyEvents.$inferSelect;
export type InsertAnomalyEvent = typeof anomalyEvents.$inferInsert;

// AI Ops execution-derived control-plane signals
export const aiOpsEvents = pgTable("ai_ops_events", {
  id:             serial("id").primaryKey(),
  type:           text("type").notNull(),                        // ROUTING_FAILURE | EXECUTION_LATENCY_HIGH | VENDOR_DEGRADATION_SIGNAL
  severity:       varchar("severity",       { length: 16  }).notNull(), // high | medium | low
  message:        text("message").notNull(),
  entity:         text("entity"),                                // operationType that produced the signal
  value:          text("value"),                                 // e.g. durationMs as string
  linkedExecId:   text("linked_exec_id"),                        // approval request ID that triggered this signal
  source:         text("source").notNull().default('execution'),
  // ── Truth layer (Phase 2) ──────────────────────────────────────────────────
  confidence:     real("confidence"),                            // 0–1 evidence strength
  signalSource:   varchar("signal_source",  { length: 32  }),   // synthetic | live_traffic | manual_test
  dedupeKey:      varchar("dedupe_key",     { length: 128 }),   // carrier+type+15min-bucket for dedup
  classification: varchar("classification", { length: 32  }),   // carrier_failure | infra_failure | success
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
export type AiOpsEvent = typeof aiOpsEvents.$inferSelect;
export type InsertAiOpsEvent = typeof aiOpsEvents.$inferInsert;

// AI Ops incident grouping layer — correlates signals + anomalies into root-cause events
export const aiOpsIncidents = pgTable("ai_ops_incidents", {
  id:             serial("id").primaryKey(),
  title:          text("title").notNull(),
  entity:         text("entity"),
  severity:       varchar("severity", { length: 16 }).notNull(),
  startTime:      timestamp("start_time").notNull(),
  lastSeen:       timestamp("last_seen").notNull(),
  signalsCount:   integer("signals_count").notNull().default(0),
  anomaliesCount: integer("anomalies_count").notNull().default(0),
  status:         text("status").notNull().default('active'),
  narrative:      text("narrative"),
  timelineJson:   text("timeline_json"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
export type AiOpsIncident = typeof aiOpsIncidents.$inferSelect;
export type InsertAiOpsIncident = typeof aiOpsIncidents.$inferInsert;

// ── Routing Suggestions — operator-facing recommendations ─────────────────────
export const routingSuggestions = pgTable("routing_suggestions", {
  id:              serial("id").primaryKey(),
  carrierName:     varchar("carrier_name", { length: 256 }).notNull(),
  entity:          varchar("entity",       { length: 256 }),
  currentScore:    real("current_score"),
  suggestedAction: text("suggested_action").notNull(),
  reason:          text("reason").notNull(),
  confidence:      real("confidence").notNull().default(0.5),
  status:          varchar("status", { length: 32 }).notNull().default('pending'),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  resolvedAt:      timestamp("resolved_at"),
  simulationValidatedAt: timestamp("simulation_validated_at"),
  simulationScenario:    json("simulation_scenario").$type<{
    fromCarrier: string; toCarrier: string; shiftPercent: number;
    delta: { asr: number; stability: number; fasRate: number; margin: number };
  }>(),
});
export type RoutingSuggestion = typeof routingSuggestions.$inferSelect;
export type InsertRoutingSuggestion = typeof routingSuggestions.$inferInsert;

// ── Portal Access Tokens — shareable links for client self-service view ────────
export const portalAccessTokens = pgTable("portal_access_tokens", {
  id:              serial("id").primaryKey(),
  token:           varchar("token",        { length: 64  }).notNull().unique(),
  accountId:       varchar("account_id",   { length: 32  }).notNull(),
  accountName:     varchar("account_name", { length: 128 }).notNull(),
  label:           varchar("label",        { length: 128 }),
  createdBy:       varchar("created_by",   { length: 255 }),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  expiresAt:       timestamp("expires_at"),
  lastUsedAt:      timestamp("last_used_at"),
  permissions:     text("permissions").default('["cdrs","usage","billing"]'),
  clientProfileId: integer("client_profile_id"),
});
export type PortalToken = typeof portalAccessTokens.$inferSelect;
export type InsertPortalToken = typeof portalAccessTokens.$inferInsert;
export const insertPortalTokenSchema = createInsertSchema(portalAccessTokens).omit({ id: true, createdAt: true });

// ── Account Management — Companies ────────────────────────────────────────────
export const companies = pgTable("companies", {
  id:              serial("id").primaryKey(),
  name:            varchar("name",       { length: 256 }).notNull().unique(),
  shortCode:       varchar("short_code", { length: 32  }).notNull().unique(),
  country:         varchar("country",    { length: 64  }),
  kam:             varchar("kam",        { length: 128 }),
  status:          varchar("status",     { length: 16  }).notNull().default('active'),
  companyType:     varchar("company_type",{ length: 32 }).notNull().default('retail'),
  contractType:    varchar("contract_type",{ length: 32}).notNull().default('bilateral'),
  department:      varchar("department", { length: 64  }),
  team:            varchar("team",       { length: 64  }),
  clientTimezone:  varchar("client_timezone", { length: 64 }),
  vendorTimezone:  varchar("vendor_timezone", { length: 64 }),
  currency:        varchar("currency",   { length: 8   }).notNull().default('USD'),
  vendorBillingCycle:  varchar("vendor_billing_cycle",  { length: 32 }).default('weekly_cutoff'),
  vendorGracePeriod:   integer("vendor_grace_period").default(3),
  vendorCreditLimit:   real("vendor_credit_limit").default(0),
  disputeOverPct:      real("dispute_over_pct").default(0),
  clientBillingCycle:  varchar("client_billing_cycle",  { length: 32 }).default('weekly_cutoff'),
  clientGracePeriod:   integer("client_grace_period").default(3),
  clientCreditLimit:   real("client_credit_limit").default(0),
  disputeOverVal:      real("dispute_over_val").default(0),
  paymentTerm:         varchar("payment_term", { length: 32 }).default('prepaid'),
  legalNameCi:         varchar("legal_name_ci",  { length: 256 }),
  legalNameVen:        varchar("legal_name_ven", { length: 256 }),
  invoiceEmail:        varchar("invoice_email",  { length: 256 }),
  notes:               text("notes"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  createdBy:           varchar("created_by",           { length: 255 }),
  provisioningStatus:  varchar("provisioning_status",  { length: 32 }).notNull().default('draft'),
  provisionedAt:       timestamp("provisioned_at"),
  provisionedBy:       varchar("provisioned_by",       { length: 255 }),
  sippyIAccount:       integer("sippy_i_account"),
  wizardDraft:         text("wizard_draft"),
});
export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });

export const companyContacts = pgTable("company_contacts", {
  id:          serial("id").primaryKey(),
  companyId:   integer("company_id").notNull(),
  contactType: varchar("contact_type", { length: 32 }).notNull(),
  firstName:   varchar("first_name",   { length: 128 }).notNull(),
  lastName:    varchar("last_name",    { length: 128 }),
  email:       varchar("email",        { length: 256 }).notNull(),
  phone:       varchar("phone",        { length: 64  }),
  fax:         varchar("fax",          { length: 64  }),
});
export type CompanyContact = typeof companyContacts.$inferSelect;
export type InsertCompanyContact = typeof companyContacts.$inferInsert;

export const companyBankAccounts = pgTable("company_bank_accounts", {
  id:            serial("id").primaryKey(),
  companyId:     integer("company_id").notNull(),
  bankName:      varchar("bank_name",      { length: 256 }).notNull(),
  accountTitle:  varchar("account_title",  { length: 256 }).notNull(),
  accountNo:     varchar("account_no",     { length: 128 }).notNull(),
  iban:          varchar("iban",           { length: 64  }),
  swiftCode:     varchar("swift_code",     { length: 32  }).notNull(),
  currency:      varchar("currency",       { length: 8   }).notNull().default('USD'),
  country:       varchar("country",        { length: 64  }).notNull(),
  address:       text("address"),
  remarks:       text("remarks"),
  status:        varchar("status",         { length: 16  }).notNull().default('active'),
});
export type CompanyBankAccount = typeof companyBankAccounts.$inferSelect;
export type InsertCompanyBankAccount = typeof companyBankAccounts.$inferInsert;

// ── Account Management — Client IP Approval Requests ─────────────────────────
export const clientIpRequests = pgTable("client_ip_requests", {
  id:           serial("id").primaryKey(),
  companyId:    integer("company_id"),
  clientName:   varchar("client_name",   { length: 256 }).notNull(),
  ipAddress:    varchar("ip_address",    { length: 64  }).notNull(),
  trunk:        varchar("trunk",         { length: 128 }),
  description:  text("description"),
  status:       varchar("status",        { length: 16  }).notNull().default('pending'),
  submittedBy:  varchar("submitted_by",  { length: 255 }),
  reviewedBy:   varchar("reviewed_by",   { length: 255 }),
  rejectionReason: text("rejection_reason"),
  submittedAt:  timestamp("submitted_at").defaultNow().notNull(),
  reviewedAt:   timestamp("reviewed_at"),
});
export type ClientIpRequest = typeof clientIpRequests.$inferSelect;
export type InsertClientIpRequest = typeof clientIpRequests.$inferInsert;
export const insertClientIpRequestSchema = createInsertSchema(clientIpRequests).omit({ id: true, submittedAt: true });

// ── Per-account local config (email, rate sheet, rules, email format) ──────────
export const accountConfigs = pgTable("account_configs", {
  iAccount:   integer("i_account").primaryKey(),
  configJson: text("config_json").notNull().default('{}'),
  updatedAt:  timestamp("updated_at").defaultNow().notNull(),
});
export type AccountConfig = typeof accountConfigs.$inferSelect;

// ── CDR Anomaly Batches: nightly per-account statistical deviation results ─────
export const cdrAnomalyBatches = pgTable("cdr_anomaly_batches", {
  id:             serial("id").primaryKey(),
  runDate:        varchar("run_date", { length: 12 }).notNull(),   // YYYY-MM-DD of the analysed day
  account:        varchar("account", { length: 128 }).notNull(),   // clientName / iAccount
  metric:         varchar("metric", { length: 32 }).notNull(),     // avg_duration | cost_per_min | dest_entropy
  baseline:       real("baseline").notNull(),
  observed:       real("observed").notNull(),
  deviationSigma: real("deviation_sigma").notNull(),
  severity:       varchar("severity", { length: 16 }).notNull(),   // critical | high | medium
  createdAt:      timestamp("created_at").defaultNow(),
});
export type CdrAnomalyBatch = typeof cdrAnomalyBatches.$inferSelect;
export type InsertCdrAnomalyBatch = typeof cdrAnomalyBatches.$inferInsert;

// ── Quality Events: 15-min windows where avg MOS drops below 3.5 ─────────────
export const qualityEvents = pgTable("quality_events", {
  id:          serial("id").primaryKey(),
  windowStart: timestamp("window_start").notNull(),
  windowEnd:   timestamp("window_end").notNull(),
  avgMos:      real("avg_mos").notNull(),
  carrier:     varchar("carrier", { length: 128 }),
  sampleCount: integer("sample_count").default(0),
  alertSent:   boolean("alert_sent").default(false),
  resolvedAt:  timestamp("resolved_at"),
  createdAt:   timestamp("created_at").defaultNow(),
});
export type QualityEvent = typeof qualityEvents.$inferSelect;
export type InsertQualityEvent = typeof qualityEvents.$inferInsert;
export const insertQualityEventSchema = createInsertSchema(qualityEvents).omit({ id: true, createdAt: true });

// ── Traffic Snapshots: 5-min concurrent call count log for baseline building ──
export const trafficSnapshots = pgTable("traffic_snapshots", {
  id:          serial("id").primaryKey(),
  timestamp:   timestamp("timestamp").defaultNow(),
  concurrent:  integer("concurrent").notNull(),
  dayOfWeek:   integer("day_of_week").notNull(), // 0=Sun … 6=Sat
  hour:        integer("hour").notNull(),         // 0–23
});
export type TrafficSnapshot = typeof trafficSnapshots.$inferSelect;

// ── Traffic Baselines: 14-day per-hour statistical model (rebuilt nightly) ────
export const trafficBaselines = pgTable("traffic_baselines", {
  id:             serial("id").primaryKey(),
  dayOfWeek:      integer("day_of_week").notNull(),
  hour:           integer("hour").notNull(),
  avgConcurrent:  real("avg_concurrent").default(0),
  stdDev:         real("std_dev").default(0),
  sampleCount:    integer("sample_count").default(0),
  updatedAt:      timestamp("updated_at").defaultNow(),
});
export type TrafficBaseline = typeof trafficBaselines.$inferSelect;

// ── Traffic Anomalies: statistical anomalies detected against baseline ─────────
export const trafficAnomalies = pgTable("traffic_anomalies", {
  id:              serial("id").primaryKey(),
  detectedAt:      timestamp("detected_at").defaultNow(),
  concurrent:      integer("concurrent").notNull(),
  baselineAvg:     real("baseline_avg").notNull(),
  baselineStdDev:  real("baseline_std_dev").notNull(),
  sigmaMultiple:   real("sigma_multiple").notNull(),
  isBusinessHours: boolean("is_business_hours").default(false),
  resolvedAt:      timestamp("resolved_at"),
  alertSent:       boolean("alert_sent").default(false),
  notes:           text("notes"),
});
export type TrafficAnomaly = typeof trafficAnomalies.$inferSelect;
export type InsertTrafficAnomaly = typeof trafficAnomalies.$inferInsert;

// ── Audit Events: append-only system memory layer ─────────────────────────────
// Never updated — only inserted. Captures every meaningful action in the system.
export const auditEvents = pgTable("audit_events", {
  id:         serial("id").primaryKey(),
  timestamp:  timestamp("timestamp").defaultNow().notNull(),
  category:   varchar("category",    { length: 32  }).notNull(), // user | system | sippy | fraud | financial
  action:     varchar("action",      { length: 64  }).notNull(), // e.g. ROLE_CHANGED, ACCOUNT_BLOCKED
  actor:      varchar("actor",       { length: 255 }).notNull().default('system'),
  actorType:  varchar("actor_type",  { length: 16  }).notNull().default('system'), // user | system | automation
  targetType: varchar("target_type", { length: 32  }),           // account | carrier | switch | user | route
  targetId:   varchar("target_id",   { length: 128 }),
  targetName: varchar("target_name", { length: 255 }),
  severity:   varchar("severity",    { length: 16  }).notNull().default('info'), // info | warning | critical
  metadata:   json("metadata"),
  ip:         varchar("ip",          { length: 64  }),
});
export type AuditEvent      = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;

// Account State: persistent operational health per Sippy account
export const accountState = pgTable("account_state", {
  id:                 serial("id").primaryKey(),
  accountId:          varchar("account_id",   { length: 64  }).notNull().unique(),
  accountName:        varchar("account_name", { length: 255 }),
  healthScore:        integer("health_score").notNull().default(100),
  fraudRisk:          integer("fraud_risk").notNull().default(0),
  anomalyScore:       integer("anomaly_score").notNull().default(0),
  qualityScore:       integer("quality_score").notNull().default(100),
  balanceTrend:       varchar("balance_trend", { length: 20 }).notNull().default('stable'),
  activeIncidentCount:integer("active_incident_count").notNull().default(0),
  state:              varchar("state", { length: 20 }).notNull().default('healthy'),
  reasons:            json("reasons").$type<string[]>().default([]),
  lastIncidentAt:     timestamp("last_incident_at"),
  // Trend tracking (populated after first two cycles)
  previousHealthScore:integer("previous_health_score"),
  previousState:      varchar("previous_state",     { length: 20 }),
  trendDirection:     varchar("trend_direction",     { length: 20 }).notNull().default('stable'),
  scoreDelta24h:      integer("score_delta_24h").notNull().default(0),
  // Auth exposure scoring (B2 — structural vulnerability layer)
  authExposureScore:   integer("auth_exposure_score").notNull().default(0),
  exposureRiskLevel:   varchar("exposure_risk_level", { length: 20 }).notNull().default('low'),
  authExposureSignals: json("auth_exposure_signals").$type<{ ipRisk: number; authWeakness: number; accessBreadth: number; configMisalignment: number; signals: string[] }>(),
  // C1 Recommendation Engine — per-account ranked action output
  recommendation: json("recommendation").$type<{
    riskScore: number;
    priority: number;
    urgency: 'immediate' | 'today' | 'monitor';
    dominantSignal: 'exposure' | 'fraud' | 'health' | 'anomaly';
    primaryAction: string;
    actionReason: string[];
    confidence: number;
    signalSummary: { healthScore: number; fraudRisk: number; authExposureScore: number; anomalyScore: number; activeIncidents: number };
    computedAt: string;
  }>(),
  // Composite ACCOUNT_RISK_INDEX (0–100) — mirrors riskScore from recommendation engine.
  // Stored here so every system (routing, blacklist, approval priority) reads one value.
  riskIndex:          integer("risk_index").notNull().default(0),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
});
export type AccountState       = typeof accountState.$inferSelect;
export type InsertAccountState = typeof accountState.$inferInsert;

// Account State History: one snapshot per engine cycle per account (kept 30 days)
export const accountStateHistory = pgTable("account_state_history", {
  id:          serial("id").primaryKey(),
  accountId:   varchar("account_id",   { length: 64  }).notNull(),
  accountName: varchar("account_name", { length: 255 }),
  healthScore: integer("health_score").notNull(),
  fraudRisk:   integer("fraud_risk").notNull(),
  anomalyScore:integer("anomaly_score").notNull(),
  qualityScore:integer("quality_score").notNull(),
  state:       varchar("state", { length: 20 }).notNull(),
  reasons:     json("reasons").$type<string[]>().default([]),
  snapshotAt:  timestamp("snapshot_at").defaultNow().notNull(),
});
export type AccountStateHistory       = typeof accountStateHistory.$inferSelect;
export type InsertAccountStateHistory = typeof accountStateHistory.$inferInsert;

// Unified Incidents: normalized operational incidents from all signal sources
export const incidents = pgTable("incidents", {
  id:              serial("id").primaryKey(),
  entityType:      varchar("entity_type",    { length: 32  }).notNull(),
  entityId:        varchar("entity_id",      { length: 128 }).notNull(),
  entityName:      varchar("entity_name",    { length: 255 }),
  incidentType:    varchar("incident_type",  { length: 64  }).notNull(),
  severity:        varchar("severity",       { length: 20  }).notNull().default('medium'),
  confidence:      integer("confidence").notNull().default(70),
  title:           text("title").notNull(),
  summary:         text("summary"),
  reasons:         json("reasons").$type<string[]>().default([]),
  suggestedAction: text("suggested_action"),
  status:          varchar("status",         { length: 20  }).notNull().default('active'),
  source:          varchar("source",         { length: 64  }).notNull(),
  openedAt:        timestamp("opened_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
  resolvedAt:      timestamp("resolved_at"),
});
export type Incident       = typeof incidents.$inferSelect;
export type InsertIncident = typeof incidents.$inferInsert;

// ── Unified Action Ledger — append-only cross-system audit spine ─────────────
// One row per event (not per action). Every mutation system writes here.
// Source systems (account_actions, approval_requests) remain domain sources of truth.
// This table is the correlated audit view across all mutation domains.
export const actionLedger = pgTable("action_ledger", {
  id:                  serial("id").primaryKey(),
  // Groups all events for a single action lifecycle (UUID set at creation, shared across events)
  ledgerId:            varchar("ledger_id",            { length: 64 }).notNull(),
  // Mutation domain classification
  scope:               varchar("scope",               { length: 20 }).notNull(), // 'account' | 'routing' | 'system'
  sourceSystem:        varchar("source_system",        { length: 20 }).notNull(), // 'C2' | 'ROUTING' | 'MANUAL'
  // Action identity
  actionType:          varchar("action_type",          { length: 64 }).notNull(),
  entityId:            varchar("entity_id",            { length: 128 }),
  entityName:          varchar("entity_name",          { length: 255 }),
  // Event payload (what changed)
  payload:             json("payload").$type<Record<string, unknown>>(),
  // Idempotency key — shared with the source system's key when available
  idempotencyKey:      varchar("idempotency_key",      { length: 128 }),
  // Risk context snapshot at event time
  riskIndexSnapshot:   integer("risk_index_snapshot"),
  // State at the time of this event (point-in-time snapshot, not mutable)
  approvalState:       varchar("approval_state",       { length: 30 }).notNull().default('pending'),
  executionState:      varchar("execution_state",      { length: 30 }).notNull().default('not_executed'),
  verificationState:   varchar("verification_state",   { length: 30 }).notNull().default('not_applicable'),
  // Back-reference to the source record (not FK — keeps ledger decoupled)
  sourceRecordId:      varchar("source_record_id",     { length: 64 }),
  // Event classification (the append-only dimension)
  eventType:           varchar("event_type",           { length: 30 }).notNull(), // 'created' | 'approved' | 'rejected' | 'snoozed' | 'executed' | 'rolled_back' | 'submitted' | 'failed'
  // Actor
  requestedBy:         varchar("requested_by",         { length: 255 }),
  requestedByName:     varchar("requested_by_name",    { length: 255 }),
  actorId:             varchar("actor_id",             { length: 255 }),
  actorName:           varchar("actor_name",           { length: 255 }),
  // Freeform audit note for this event
  note:                text("note"),
  // Business-level grouping — one intent_id spans multiple ledger_ids when they
  // represent the same operational objective (e.g. "carrier-failure-mitigation").
  // Higher-order than ledger_id (which is the technical action thread).
  intentId:            varchar("intent_id",    { length: 64 }),
  intentLabel:         varchar("intent_label", { length: 128 }),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
});
export type ActionLedgerEntry       = typeof actionLedger.$inferSelect;
export type InsertActionLedgerEntry = typeof actionLedger.$inferInsert;

// ── C2 Action Execution Layer — governed mutation ledger ─────────────────────
export const accountActions = pgTable("account_actions", {
  id:                serial("id").primaryKey(),
  accountId:         varchar("account_id",        { length: 64  }).notNull(),
  accountName:       varchar("account_name",       { length: 255 }),
  recommendationRef: json("recommendation_ref").$type<{
    priority:       number;
    riskScore:      number;
    urgency:        'immediate' | 'today' | 'monitor';
    dominantSignal: string;
    computedAt:     string;
  }>(),
  actionType:        varchar("action_type",        { length: 50  }).notNull(),
  status:            varchar("status",             { length: 30  }).notNull().default('pending'),
  executionMode:     varchar("execution_mode",     { length: 20  }).notNull().default('dry_run'),
  primaryAction:     text("primary_action"),
  sippyParams:       json("sippy_params").$type<Record<string, unknown>>(),
  sippyResult:       json("sippy_result").$type<Record<string, unknown>>(),
  requestedBy:       varchar("requested_by",       { length: 255 }),
  requestedByName:   varchar("requested_by_name",  { length: 255 }),
  approvedBy:        varchar("approved_by",        { length: 255 }),
  approvedByName:    varchar("approved_by_name",   { length: 255 }),
  rejectedBy:        varchar("rejected_by",        { length: 255 }),
  rejectionReason:   text("rejection_reason"),
  snoozedUntil:      timestamp("snoozed_until"),
  notes:             text("notes"),
  auditTrail:        json("audit_trail").$type<Array<{
    timestamp: string;
    event:     string;
    userId?:   string;
    userName?: string;
    details?:  string;
  }>>(),
  // Idempotency — prevents double-execution on retry. Key = SHA-256(accountId+actionType+params+hourBucket).
  idempotencyKey:    varchar("idempotency_key",   { length: 128 }),
  // 3-state execution certainty model (critical for XML-RPC write reliability)
  verificationState: varchar("verification_state", { length: 30 }).notNull().default('not_applicable'),
  createdAt:         timestamp("created_at").defaultNow(),
  updatedAt:         timestamp("updated_at").defaultNow(),
});
export type AccountAction       = typeof accountActions.$inferSelect;
export type InsertAccountAction = typeof accountActions.$inferInsert;

// ── Portal Ticket System (V1.1) ───────────────────────────────────────────────
export const portalTickets = pgTable("portal_tickets", {
  id:          serial("id").primaryKey(),
  tokenId:     integer("token_id").notNull(),
  accountId:   integer("account_id").notNull(),
  accountName: varchar("account_name", { length: 255 }),
  category:    varchar("category",     { length: 50  }).notNull(), // traffic|quality|billing|routing|other
  subject:     varchar("subject",      { length: 255 }).notNull(),
  status:      varchar("status",       { length: 30  }).notNull().default("open"), // open|in_progress|waiting_client|resolved
  severity:    varchar("severity",     { length: 20  }).notNull().default("medium"), // low|medium|high
  createdAt:   timestamp("created_at").defaultNow(),
  updatedAt:   timestamp("updated_at").defaultNow(),
});
export const insertPortalTicketSchema = createInsertSchema(portalTickets).omit({ id: true, createdAt: true, updatedAt: true });
export type PortalTicket       = typeof portalTickets.$inferSelect;
export type InsertPortalTicket = z.infer<typeof insertPortalTicketSchema>;

export const portalTicketMessages = pgTable("portal_ticket_messages", {
  id:        serial("id").primaryKey(),
  ticketId:  integer("ticket_id").notNull(),
  author:    varchar("author", { length: 20 }).notNull(), // "client" | "operator"
  body:      text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertPortalTicketMessageSchema = createInsertSchema(portalTicketMessages).omit({ id: true, createdAt: true });
export type PortalTicketMessage       = typeof portalTicketMessages.$inferSelect;
export type InsertPortalTicketMessage = z.infer<typeof insertPortalTicketMessageSchema>;

// ── Unified Console — Persistent Incidents (Phase 2) ─────────────────────────

export const consoleIncidents = pgTable("console_incidents", {
  id:                   serial("id").primaryKey(),
  entityKey:            varchar("entity_key",   { length: 255 }).notNull(),
  entityLabel:          varchar("entity_label", { length: 255 }).notNull(),
  windowHash:           varchar("window_hash",  { length: 64  }).notNull().unique(), // entity + 10-min bucket
  severity:             varchar("severity",     { length: 16  }).notNull(),
  state:                varchar("state",        { length: 24  }).notNull().default("active"),
  title:                varchar("title",        { length: 500 }).notNull(),
  alertsJson:           text("alerts_json").notNull().default("[]"),
  rootCauseJson:        text("root_cause_json"),
  timelineJson:         text("timeline_json").notNull().default("[]"),
  actionsJson:          text("actions_json").notNull().default("[]"),
  metricsJson:          text("metrics_json"),
  estimatedImpactPerHr: real("estimated_impact_per_hr"),
  linkedTicketId:       integer("linked_ticket_id"),
  startedAt:            timestamp("started_at").notNull(),
  lastSeenAt:           timestamp("last_seen_at").notNull(),
  resolvedAt:           timestamp("resolved_at"),
  acknowledgedBy:         varchar("acknowledged_by",          { length: 128 }),
  acknowledgedAt:         timestamp("acknowledged_at"),
  acknowledgeNote:        text("acknowledge_note"),
  resolvedBy:             varchar("resolved_by",               { length: 128 }),
  resolutionNote:         text("resolution_note"),
  assignedTo:             varchar("assigned_to",               { length: 128 }),
  assignmentHistoryJson:  text("assignment_history_json").notNull().default("[]"),
  createdAt:              timestamp("created_at").defaultNow(),
  updatedAt:            timestamp("updated_at").defaultNow(),
});
export type ConsoleIncident = typeof consoleIncidents.$inferSelect;

export const incidentLifecycleEvents = pgTable("incident_lifecycle_events", {
  id:         serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull(),
  fromState:  varchar("from_state", { length: 24 }),
  toState:    varchar("to_state",   { length: 24 }).notNull(),
  actor:      varchar("actor",      { length: 128 }),
  note:       text("note"),
  createdAt:  timestamp("created_at").defaultNow(),
});
export type IncidentLifecycleEvent = typeof incidentLifecycleEvents.$inferSelect;

// ── Concurrent Snapshot History — persists concurrent session telemetry for DAILY/WEEKLY graphs ──
// Written every 45s poll cycle. MAX(active) per bucket gives true concurrency peak.
// Retention: 7 days. Indexed for fast bucket-range queries.
export const concurrentSnapshots = pgTable("concurrent_snapshots", {
  id:         serial("id").primaryKey(),
  dim:        varchar("dim",         { length: 32  }).notNull(),
  entityName: varchar("entity_name", { length: 256 }).notNull(),
  ts:         bigint("ts",           { mode: "number" }).notNull(),
  active:     integer("active").notNull().default(0),
  connected:  integer("connected").notNull().default(0),
  routing:    integer("routing").notNull().default(0),
}, (t) => [
  index("csnap_dim_name_ts_idx").on(t.dim, t.entityName, t.ts),
]);
export type ConcurrentSnapshot = typeof concurrentSnapshots.$inferSelect;

// ── Entity Presence Registry — persists across server restarts ────────────────
// Stores idle entity state for all 4 dimensions (client, vendor, country, destination)
// so the BitsEye 2 sidebar remains populated after a restart without waiting for calls.
export const entityPresenceRegistry = pgTable("entity_presence_registry", {
  id:         serial("id").primaryKey(),
  dim:        varchar("dim",         { length: 32  }).notNull(),
  entityName: varchar("entity_name", { length: 256 }).notNull(),
  lastSeen:   bigint("last_seen",    { mode: "number" }).notNull().default(0),
  firstSeen:  bigint("first_seen",   { mode: "number" }).notNull().default(0),
  peakToday:  integer("peak_today").notNull().default(0),
  peakTs:     bigint("peak_ts",      { mode: "number" }).notNull().default(0),
  updatedAt:  timestamp("updated_at").defaultNow(),
}, (t) => [uniqueIndex("epr_dim_name_uidx").on(t.dim, t.entityName)]);
export type EntityPresenceRow = typeof entityPresenceRegistry.$inferSelect;

// ── Intelligent Failover Policies — per-route-group auto-heal configuration ───
// Owned by Destination Manager. Governs policy-based conditional failover
// for STANDARD routes only. Human-curated approved failover vendor whitelist.
export const intelligentFailoverPolicies = pgTable("intelligent_failover_policies", {
  id:                     serial("id").primaryKey(),
  routeGroupId:           varchar("route_group_id",      { length: 128 }),
  destinationPrefix:      varchar("destination_prefix",  { length: 32 }),
  label:                  varchar("label",               { length: 128 }).notNull(),
  routeClass:             varchar("route_class",         { length: 32 }).notNull().default('STANDARD'),
  enabled:                boolean("enabled").notNull().default(false),
  minimumAsr:             real("minimum_asr").notNull().default(38),
  maximumFas:             real("maximum_fas").notNull().default(5),
  minimumStability:       real("minimum_stability").notNull().default(55),
  maxTrafficShift:        integer("max_traffic_shift").notNull().default(20),
  maxDurationMinutes:     integer("max_duration_minutes").notNull().default(30),
  rollbackWindowMinutes:  integer("rollback_window_minutes").notNull().default(30),
  notificationRequired:   boolean("notification_required").notNull().default(true),
  approvedFailoverVendors: text("approved_failover_vendors").array().notNull().default([]),
  updatedBy:              varchar("updated_by", { length: 128 }),
  updatedAt:              timestamp("updated_at").defaultNow().notNull(),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
  // ── Stage 2E: Simulation-Gated Arming ─────────────────────────────────────
  simulationValidatedAt:  timestamp("simulation_validated_at"),
  simulationScenario:     json("simulation_scenario").$type<{
    fromCarrier: string; toCarrier: string; shiftPercent: number;
    delta: { asr: number; stability: number; fasRate: number; margin: number };
  }>(),
  armingStatus:           varchar("arming_status", { length: 32 }).notNull().default('disarmed'),
  armedAt:                timestamp("armed_at"),
  armedBy:                varchar("armed_by", { length: 128 }),
});
export type IntelligentFailoverPolicy    = typeof intelligentFailoverPolicies.$inferSelect;
export type InsertIntelligentFailoverPolicy = typeof intelligentFailoverPolicies.$inferInsert;

// ── Failover Executions — audit trail for each policy execution ──────────────
export const failoverExecutions = pgTable("failover_executions", {
  id:            serial("id").primaryKey(),
  policyId:      integer("policy_id").notNull(),
  status:        varchar("status",         { length: 32  }).notNull().default('active'),
  fromCarrier:   varchar("from_carrier",   { length: 256 }).notNull(),
  toCarrier:     varchar("to_carrier",     { length: 256 }).notNull(),
  shiftPercent:  integer("shift_percent").notNull(),
  executedAt:    timestamp("executed_at").defaultNow().notNull(),
  executedBy:    varchar("executed_by",    { length: 128 }).notNull(),
  rollbackAt:    timestamp("rollback_at"),
  rolledBackAt:  timestamp("rolled_back_at"),
  rolledBackBy:  varchar("rolled_back_by", { length: 128 }),
  auditLog:      json("audit_log").$type<{ ts: string; event: string; actor: string; detail?: string }[]>().notNull().default([]),
});
export type FailoverExecution       = typeof failoverExecutions.$inferSelect;
export type InsertFailoverExecution = typeof failoverExecutions.$inferInsert;

// ── Recommendation Outcomes — passive telemetry only ─────────────────────────
// Append-only. No routes or dashboards until sufficient telemetry exists.
// Purpose: correlate projected simulation deltas against actual carrier outcomes
// to create empirical confidence calibration for the future Trust Analytics layer.
// DO NOT add scoring, weighting, or ML hooks until Phase 1 trust telemetry matures.
export const recommendationOutcomes = pgTable("recommendation_outcomes", {
  id:                      serial("id").primaryKey(),
  recommendationId:        integer("recommendation_id"),
  executionId:             integer("execution_id"),
  projectedAsrDelta:       real("projected_asr_delta"),
  actualAsrDelta:          real("actual_asr_delta"),
  projectedMarginDelta:    real("projected_margin_delta"),
  actualMarginDelta:       real("actual_margin_delta"),
  projectedFasDelta:       real("projected_fas_delta"),
  actualFasDelta:          real("actual_fas_delta"),
  projectedStabilityDelta: real("projected_stability_delta"),
  actualStabilityDelta:    real("actual_stability_delta"),
  evaluatedAt:             timestamp("evaluated_at").defaultNow().notNull(),
  rollbackTriggered:       boolean("rollback_triggered").notNull().default(false),
  rollbackReason:          varchar("rollback_reason", { length: 512 }),
});
export type RecommendationOutcome       = typeof recommendationOutcomes.$inferSelect;
export type InsertRecommendationOutcome = typeof recommendationOutcomes.$inferInsert;

// ── Vendor Stability Snapshots — persists Q-score history per vendor ──────────
// Written every 30 min by snapshotVendorStability(). Retention: 7 days.
// Powers the Vendor Stability Timeline page and future risk scoring.
export const vendorStabilitySnapshots = pgTable("vendor_stability_snapshots", {
  id:        serial("id").primaryKey(),
  vendor:    varchar("vendor",    { length: 128 }).notNull(),
  ts:        timestamp("ts").defaultNow().notNull(),
  qScore:    integer("q_score").notNull(),
  asr:       real("asr"),
  ner:       real("ner"),
  avgPdd:    real("avg_pdd"),
  fasRate:   real("fas_rate"),
  callCount: integer("call_count").notNull().default(0),
  stability: varchar("stability", { length: 20 }).notNull().default('unknown'),
  // 'stable' | 'oscillating' | 'degrading' | 'recovering' | 'insufficient' | 'unknown'
}, (t) => [
  index("vsn_vendor_ts_idx").on(t.vendor, t.ts),
]);
export type VendorStabilitySnapshot = typeof vendorStabilitySnapshots.$inferSelect;

// ── Platform Feature Flags — progressive activation of automation layers ──────
// Each flag has an ownerRole (who can toggle it) and creates an audit log entry
// on every state change. Flags control activation of 2C→2E pipeline stages.
// IMPORTANT: flags are advisory — they never override backend governance checks.
export const platformFeatureFlags = pgTable("platform_feature_flags", {
  key:          varchar("key",           { length: 64  }).primaryKey(),
  enabled:      boolean("enabled").notNull().default(false),
  ownerRole:    varchar("owner_role",    { length: 32  }).notNull(),
  changedBy:    varchar("changed_by",    { length: 255 }),
  changedByName:varchar("changed_by_name",{ length: 128 }),
  changedAt:    timestamp("changed_at").defaultNow(),
  reason:       text("reason"),
  prevState:    boolean("prev_state"),
});
export type PlatformFeatureFlag    = typeof platformFeatureFlags.$inferSelect;
export type InsertPlatformFeatureFlag = typeof platformFeatureFlags.$inferInsert;

// ── Commercial Notifications — tariff change and operational announcements ─────
// Standalone module: compose → audience → dispatch → audit.
// Types: interval_change | rate_change | surcharge_added | qos_advisory |
//        maintenance_notice | fraud_advisory | routing_advisory
// ── Daily Minutes Report — telecom operational economics ───────────────────────
// Append-only. Recalculation creates a new version row (parent_dmr_id → previous).
// Never mutate historical economics silently.
// source: 'daily_summary' | 'client_cdr' | 'vendor_cdr' | 'manual'
// discrepancy_type: 'exact_match' | 'duration_drift' | 'amount_drift' | 'tariff_mismatch' | 'missing_cdr' | 'duplicate_cdr'
// verification_status: 'pending' | 'generating' | 'generated' | 'verified' | 'drifted' | 'critical' | 'corrected' | 'locked'
// GOVERNANCE: window_start_gmt / window_end_gmt are ALWAYS UTC. Timezone conversion
//             is display-only. All invoicing, recon, and AI assurance must use
//             these fields as the deterministic truth boundary.
// INVOICE GATE: invoice generation requires verification_status = 'verified' for the period.
export const dailyMinutesReports = pgTable("daily_minutes_reports", {
  id:                serial("id").primaryKey(),
  reportDate:        date("report_date").notNull(),
  dmrVersion:        integer("dmr_version").notNull().default(1),
  parentDmrId:       integer("parent_dmr_id"),

  // ── Explicit UTC window (immutable, set at generation time) ───────────────
  windowStartGmt:    timestamp("window_start_gmt"),
  windowEndGmt:      timestamp("window_end_gmt"),
  timezone:          varchar("timezone", { length: 8 }).notNull().default('UTC'),

  accountId:         varchar("account_id",   { length: 64 }),
  accountName:       varchar("account_name", { length: 256 }),
  vendorId:          varchar("vendor_id",    { length: 64 }),
  vendorName:        varchar("vendor_name",  { length: 256 }),
  destination:       varchar("destination",  { length: 256 }),
  prefix:            varchar("prefix",       { length: 32 }),

  sippyDuration:     real("sippy_duration"),
  sippyAmount:       real("sippy_amount"),
  sippyCalls:        integer("sippy_calls"),

  platformDuration:  real("platform_duration"),
  platformAmount:    real("platform_amount"),
  platformCalls:     integer("platform_calls"),

  buyAmount:         real("buy_amount"),
  sellAmount:        real("sell_amount"),
  marginAmount:      real("margin_amount"),
  marginPct:         real("margin_pct"),

  driftDuration:     real("drift_duration"),
  driftAmount:       real("drift_amount"),

  totalCalls:        integer("total_calls"),
  asr:               real("asr"),
  acd:               real("acd"),
  pdd:               real("pdd"),

  tariffVersionId:   integer("tariff_version_id"),
  discrepancyType:   varchar("discrepancy_type",  { length: 32 }).notNull().default('exact_match'),
  verificationStatus:varchar("verification_status",{ length: 32 }).notNull().default('pending'),
  source:            varchar("source",            { length: 32 }).notNull().default('daily_summary'),
  notes:             text("notes"),

  recalculatedAt:    timestamp("recalculated_at"),
  generatedAt:       timestamp("generated_at").defaultNow().notNull(),
});
export type DailyMinutesReport       = typeof dailyMinutesReports.$inferSelect;
export type InsertDailyMinutesReport = typeof dailyMinutesReports.$inferInsert;
export const insertDailyMinutesReportSchema = createInsertSchema(dailyMinutesReports).omit({ id: true, generatedAt: true });

// ── Multi-Template Invoice Rendering ─────────────────────────────────────────
// invoice_templates: per-client or global rendering rules for invoice delivery
// template_type: standard | prefix_breakdown | destination_summary | summary_only | white_label
// detail_level: full | summary | minimal
export const invoiceTemplates = pgTable("invoice_templates", {
  id:                     serial("id").primaryKey(),
  templateName:           varchar("template_name",            { length: 256 }).notNull(),
  templateType:           varchar("template_type",            { length: 32  }).notNull().default('standard'),
  detailLevel:            varchar("detail_level",             { length: 32  }).notNull().default('full'),
  clientName:             varchar("client_name",              { length: 256 }),  // null = global/default
  showPrefixBreakdown:    boolean("show_prefix_breakdown").notNull().default(false),
  showDestinationSummary: boolean("show_destination_summary").notNull().default(false),
  showCallLevelDetails:   boolean("show_call_level_details").notNull().default(false),
  headerOverride:         text("header_override"),
  footerOverride:         text("footer_override"),
  filenamePattern:        varchar("filename_pattern",         { length: 256 }),  // e.g. INV_{PERIOD}_{CLIENT}
  subjectLinePattern:     varchar("subject_line_pattern",     { length: 512 }),
  attachPdfEnabled:       boolean("attach_pdf_enabled").notNull().default(true),
  isDefault:              boolean("is_default").notNull().default(false),
  brandingProfileId:      integer("branding_profile_id"),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
  updatedAt:              timestamp("updated_at").defaultNow().notNull(),
});
export type InvoiceTemplate       = typeof invoiceTemplates.$inferSelect;
export type InsertInvoiceTemplate = typeof invoiceTemplates.$inferInsert;

// client_branding_profiles: per-client branding for invoice rendering
// Used by invoice_templates to customize logo, colors, banking info, payment terms
export const clientBrandingProfiles = pgTable("client_branding_profiles", {
  id:                  serial("id").primaryKey(),
  clientName:          varchar("client_name",        { length: 256 }),  // null = global default
  companyName:         varchar("company_name",       { length: 256 }),
  logoUrl:             text("logo_url"),
  primaryColor:        varchar("primary_color",      { length: 7  }),   // hex #RRGGBB
  secondaryColor:      varchar("secondary_color",    { length: 7  }),
  bankingDetails:      text("banking_details"),   // free-text banking info block
  bankName:            varchar("bank_name",          { length: 256 }),
  accountNumber:       varchar("account_number",     { length: 128 }),
  iban:                varchar("iban",               { length: 64  }),
  swift:               varchar("swift",              { length: 16  }),
  paymentTermsDays:    integer("payment_terms_days").notNull().default(30),
  paymentInstructions: text("payment_instructions"),
  invoiceFooterText:   text("invoice_footer_text"),
  taxId:               varchar("tax_id",             { length: 64  }),
  addressLine1:        varchar("address_line1",      { length: 256 }),
  addressLine2:        varchar("address_line2",      { length: 256 }),
  city:                varchar("city",               { length: 128 }),
  country:             varchar("country",            { length: 64  }),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
});
export type ClientBrandingProfile       = typeof clientBrandingProfiles.$inferSelect;
export type InsertClientBrandingProfile = typeof clientBrandingProfiles.$inferInsert;

// ── Credit Notes & Settlement Engine ─────────────────────────────────────────
// credit_type: partial_credit | full_credit | adjustment | write_off | carry_forward
// status: DRAFT → APPROVED → APPLIED | VOID
export const creditNotes = pgTable("credit_notes", {
  id:               serial("id").primaryKey(),
  referenceId:      varchar("reference_id",    { length: 32  }).notNull().unique(),  // CRN-YYYY-NNN
  creditType:       varchar("credit_type",     { length: 32  }).notNull(),
  clientName:       varchar("client_name",     { length: 256 }).notNull(),
  clientId:         varchar("client_id",       { length: 128 }),
  invoiceId:        integer("invoice_id"),
  disputeCaseId:    integer("dispute_case_id"),
  billingPeriod:    varchar("billing_period",  { length: 7   }),
  amountUsd:        real("amount_usd").notNull(),
  appliedAmountUsd: real("applied_amount_usd"),
  reason:           varchar("reason",          { length: 512 }).notNull(),
  description:      text("description"),
  status:           varchar("status",          { length: 32  }).notNull().default('DRAFT'),
  approvedBy:       varchar("approved_by",     { length: 128 }),
  approvedAt:       timestamp("approved_at"),
  appliedAt:        timestamp("applied_at"),
  voidedAt:         timestamp("voided_at"),
  voidedReason:     text("voided_reason"),
  createdBy:        varchar("created_by",      { length: 128 }),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});
export type CreditNote       = typeof creditNotes.$inferSelect;
export type InsertCreditNote = typeof creditNotes.$inferInsert;

// ── Collections & Credit Control ─────────────────────────────────────────────
// credit_control_rules: per-client or global threshold configuration
export const creditControlRules = pgTable("credit_control_rules", {
  id:                    serial("id").primaryKey(),
  clientName:            varchar("client_name",         { length: 256 }),  // null = global
  clientId:              varchar("client_id",           { length: 128 }),
  isGlobal:              boolean("is_global").notNull().default(false),
  warningThresholdUsd:   real("warning_threshold_usd"),   // outstanding balance threshold for warning
  suspendThresholdUsd:   real("suspend_threshold_usd"),   // outstanding balance threshold for suspension
  gracePeriodDays:       integer("grace_period_days").notNull().default(3),
  autoSuspend:           boolean("auto_suspend").notNull().default(false),
  notifyOnWarning:       boolean("notify_on_warning").notNull().default(true),
  creditLimitUsd:        real("credit_limit_usd"),
  riskScore:             integer("risk_score"),           // 0-100
  notes:                 text("notes"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().notNull(),
});
export type CreditControlRule       = typeof creditControlRules.$inferSelect;
export type InsertCreditControlRule = typeof creditControlRules.$inferInsert;

// collection_events: immutable timeline of all credit control and collection actions
// event_type: warning | suspension | grace_start | grace_end | recovery | write_off | threshold_set | reinstated
export const collectionEvents = pgTable("collection_events", {
  id:                    serial("id").primaryKey(),
  clientName:            varchar("client_name",         { length: 256 }).notNull(),
  clientId:              varchar("client_id",           { length: 128 }),
  eventType:             varchar("event_type",          { length: 32  }).notNull(),
  outstandingAmountUsd:  real("outstanding_amount_usd"),
  thresholdBreached:     varchar("threshold_breached",  { length: 32  }),  // warning | suspend
  actionTaken:           text("action_taken"),
  resolvedAt:            timestamp("resolved_at"),
  actorName:             varchar("actor_name",          { length: 128 }),
  notes:                 text("notes"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
});
export type CollectionEvent       = typeof collectionEvents.$inferSelect;
export type InsertCollectionEvent = typeof collectionEvents.$inferInsert;

// ── Partner Operations Portal ─────────────────────────────────────────────────
// partner_profiles: maps hashed access codes to a clientName for read-only portal access
// active: false immediately revokes access
export const partnerProfiles = pgTable("partner_profiles", {
  id:                 serial("id").primaryKey(),
  clientName:         varchar("client_name",          { length: 256 }).notNull(),
  companyDisplayName: varchar("company_display_name", { length: 256 }),
  contactEmail:       varchar("contact_email",        { length: 256 }),
  accessCodeHash:     varchar("access_code_hash",     { length: 256 }).notNull(),
  accessCodePrefix:   varchar("access_code_prefix",   { length: 8   }).notNull(),
  logoUrl:            text("logo_url"),
  welcomeMessage:     text("welcome_message"),
  active:             boolean("active").notNull().default(true),
  lastLoginAt:        timestamp("last_login_at"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
});
export type PartnerProfile       = typeof partnerProfiles.$inferSelect;
export type InsertPartnerProfile = typeof partnerProfiles.$inferInsert;

// ── AI Revenue Assurance Layer ────────────────────────────────────────────────
// advisory-only anomaly detection — AI suggests, humans approve, platform acts
// alert_type: margin_collapse | asr_drop | revenue_drop | reconciliation_drift | credit_note_clustering
// severity: low | medium | high | critical
// status: OPEN → REVIEWING → RESOLVED | DISMISSED
export const aiRevenueAlerts = pgTable("ai_revenue_alerts", {
  id:                serial("id").primaryKey(),
  alertType:         varchar("alert_type",      { length: 64  }).notNull(),
  severity:          varchar("severity",         { length: 16  }).notNull().default('medium'),
  anomalyScore:      integer("anomaly_score").notNull().default(0),
  clientName:        varchar("client_name",      { length: 256 }),
  vendorName:        varchar("vendor_name",      { length: 256 }),
  billingPeriod:     varchar("billing_period",   { length: 7   }),
  baselineValue:     real("baseline_value"),
  currentValue:      real("current_value"),
  deviationPct:      real("deviation_pct"),
  evidence:          jsonb("evidence"),
  recommendedAction: text("recommended_action"),
  status:            varchar("status",           { length: 32  }).notNull().default('OPEN'),
  reviewedBy:        varchar("reviewed_by",      { length: 128 }),
  reviewedAt:        timestamp("reviewed_at"),
  resolvedAt:        timestamp("resolved_at"),
  dismissedReason:   text("dismissed_reason"),
  detectedOn:        timestamp("detected_on").defaultNow().notNull(),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
});
export type AiRevenueAlert       = typeof aiRevenueAlerts.$inferSelect;
export type InsertAiRevenueAlert = typeof aiRevenueAlerts.$inferInsert;

// ai_scan_runs: audit log of every assurance scan execution
export const aiScanRuns = pgTable("ai_scan_runs", {
  id:            serial("id").primaryKey(),
  triggeredBy:   varchar("triggered_by",  { length: 128 }),
  alertsCreated: integer("alerts_created").notNull().default(0),
  detectorsRan:  integer("detectors_ran").notNull().default(0),
  durationMs:    integer("duration_ms"),
  status:        varchar("status",        { length: 32  }).notNull().default('running'),
  error:         text("error"),
  startedAt:     timestamp("started_at").defaultNow().notNull(),
  completedAt:   timestamp("completed_at"),
});
export type AiScanRun       = typeof aiScanRuns.$inferSelect;
export type InsertAiScanRun = typeof aiScanRuns.$inferInsert;

// adjustment_ledger: double-entry style ledger for all credit/debit adjustments
// reference_type: credit_note | invoice | dispute | manual | write_off | carry_forward
export const adjustmentLedger = pgTable("adjustment_ledger", {
  id:              serial("id").primaryKey(),
  clientName:      varchar("client_name",    { length: 256 }).notNull(),
  referenceType:   varchar("reference_type", { length: 32  }).notNull(),
  referenceId:     varchar("reference_id",   { length: 64  }).notNull(),
  debitUsd:        real("debit_usd"),
  creditUsd:       real("credit_usd"),
  balanceAfterUsd: real("balance_after_usd"),
  description:     text("description"),
  actorName:       varchar("actor_name",     { length: 128 }),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type AdjustmentLedgerEntry       = typeof adjustmentLedger.$inferSelect;
export type InsertAdjustmentLedgerEntry = typeof adjustmentLedger.$inferInsert;

// ── Invoice Delivery Automation — finance workflow governance ─────────────────
// invoice_jobs orchestrates the full lifecycle: draft → review → approve → send
// status: PENDING | GENERATED | REVIEW | APPROVED | SENT | FAILED | RETRYING | CANCELLED
export const invoiceJobs = pgTable("invoice_jobs", {
  id:            serial("id").primaryKey(),
  clientId:      varchar("client_id",      { length: 128 }),
  clientName:    varchar("client_name",    { length: 256 }).notNull(),
  billingPeriod: varchar("billing_period", { length: 7   }).notNull(),   // YYYY-MM
  invoiceId:     integer("invoice_id"),
  status:        varchar("status",         { length: 32  }).notNull().default('PENDING'),
  scheduledAt:   timestamp("scheduled_at"),
  generatedAt:   timestamp("generated_at"),
  approvedAt:    timestamp("approved_at"),
  approvedBy:    varchar("approved_by",    { length: 128 }),
  sentAt:        timestamp("sent_at"),
  failedAt:      timestamp("failed_at"),
  retryCount:    integer("retry_count").notNull().default(0),
  lastError:     text("last_error"),
  notes:         text("notes"),
  createdBy:     varchar("created_by",     { length: 128 }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
export type InvoiceJob       = typeof invoiceJobs.$inferSelect;
export type InsertInvoiceJob = typeof invoiceJobs.$inferInsert;

// ── Formal Dispute Workflow — governed dispute lifecycle ──────────────────────
// dispute_type: billing_dispute | rate_dispute | qos_dispute | routing_dispute | reconciliation_dispute
// status: OPEN | INVESTIGATING | CUSTOMER_PENDING | RESOLVED | CREDIT_ISSUED | REJECTED | CLOSED
export const disputeCases = pgTable("dispute_cases", {
  id:               serial("id").primaryKey(),
  referenceId:      varchar("reference_id",   { length: 32  }).notNull().unique(), // DSP-YYYY-NNN
  disputeType:      varchar("dispute_type",   { length: 32  }).notNull(),
  clientId:         varchar("client_id",      { length: 128 }),
  clientName:       varchar("client_name",    { length: 256 }).notNull(),
  billingPeriod:    varchar("billing_period", { length: 7   }),
  invoiceId:        integer("invoice_id"),
  reconciliationId: integer("reconciliation_id"),
  assignedTo:       varchar("assigned_to",    { length: 128 }),
  severity:         varchar("severity",       { length: 16  }).notNull().default('medium'),
  status:           varchar("status",         { length: 32  }).notNull().default('OPEN'),
  disputedAmount:   real("disputed_amount"),
  resolvedAmount:   real("resolved_amount"),
  description:      text("description"),
  internalNotes:    text("internal_notes"),
  slaHours:         integer("sla_hours").notNull().default(72),
  slaDueAt:         timestamp("sla_due_at"),
  openedAt:         timestamp("opened_at").defaultNow().notNull(),
  resolvedAt:       timestamp("resolved_at"),
  closedAt:         timestamp("closed_at"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});
export type DisputeCase       = typeof disputeCases.$inferSelect;
export type InsertDisputeCase = typeof disputeCases.$inferInsert;

// Dispute case timeline events — immutable audit trail of all case activity
// event_type: status_change | note | assignment | escalation
export const disputeCaseEvents = pgTable("dispute_case_events", {
  id:         serial("id").primaryKey(),
  caseId:     integer("case_id").notNull(),
  eventType:  varchar("event_type",  { length: 32  }).notNull(),
  fromStatus: varchar("from_status", { length: 32  }),
  toStatus:   varchar("to_status",   { length: 32  }),
  message:    text("message"),
  actorName:  varchar("actor_name",  { length: 128 }),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});
export type DisputeCaseEvent       = typeof disputeCaseEvents.$inferSelect;
export type InsertDisputeCaseEvent = typeof disputeCaseEvents.$inferInsert;

// ── Margin Intelligence — telecom commercial profitability analytics ───────────
// Materialized from DMR + reconciliation data. Pre-computed for fast querying.
// dimension_type: 'client' | 'vendor' | 'aggregate'
// source: 'dmr' | 'recon' | 'computed'
export const marginAnalyticsDaily = pgTable("margin_analytics_daily", {
  id:             serial("id").primaryKey(),
  date:           date("date").notNull(),
  dimensionType:  varchar("dimension_type", { length: 16 }).notNull(),
  dimensionId:    varchar("dimension_id",   { length: 64 }),
  dimensionName:  varchar("dimension_name", { length: 256 }).notNull(),

  revenueUsd:     real("revenue_usd"),
  costUsd:        real("cost_usd"),
  marginUsd:      real("margin_usd"),
  marginPct:      real("margin_pct"),

  durationSec:    real("duration_sec"),
  calls:          integer("calls"),
  asr:            real("asr"),
  acd:            real("acd"),

  source:         varchar("source", { length: 32 }).notNull().default('dmr'),
  computedAt:     timestamp("computed_at").defaultNow().notNull(),
});
export type MarginAnalyticsDaily       = typeof marginAnalyticsDaily.$inferSelect;
export type InsertMarginAnalyticsDaily = typeof marginAnalyticsDaily.$inferInsert;

// Margin alerts — threshold breaches detected during materialization
// alert_type: 'negative_margin' | 'margin_drop' | 'threshold_breach' | 'vendor_cost_spike'
export const marginAlerts = pgTable("margin_alerts", {
  id:              serial("id").primaryKey(),
  alertType:       varchar("alert_type",     { length: 32 }).notNull(),
  dimensionType:   varchar("dimension_type", { length: 16 }).notNull(),
  dimensionName:   varchar("dimension_name", { length: 256 }).notNull(),
  date:            date("date").notNull(),

  thresholdPct:    real("threshold_pct"),
  actualPct:       real("actual_pct"),
  deltaPct:        real("delta_pct"),
  amountUsd:       real("amount_usd"),

  severity:        varchar("severity", { length: 16 }).notNull().default('medium'),
  message:         text("message"),

  acknowledged:    boolean("acknowledged").notNull().default(false),
  acknowledgedBy:  varchar("acknowledged_by", { length: 128 }),
  acknowledgedAt:  timestamp("acknowledged_at"),
  triggeredAt:     timestamp("triggered_at").defaultNow().notNull(),
});
export type MarginAlert       = typeof marginAlerts.$inferSelect;
export type InsertMarginAlert = typeof marginAlerts.$inferInsert;

// ── Client Revenue Reconciliation — bilateral telecom finance truth ────────────
// Compares client-submitted billing data against BitsAuto invoice + DMR.
// Append-only version pattern: recalculate creates v2, v3… preserving history.
// status: 'pending' | 'in_review' | 'reconciled' | 'disputed' | 'approved'
// severity: 'clean' | 'low' | 'medium' | 'high' | 'critical'
// discrepancy_type: 'exact_match' | 'duration_drift' | 'amount_drift' | 'both_drift' | 'no_client_data' | 'no_bitsauto_data'
export const clientRevenueReconciliations = pgTable("client_revenue_reconciliations", {
  id:                    serial("id").primaryKey(),
  billingPeriod:         varchar("billing_period", { length: 7 }).notNull(),   // YYYY-MM
  version:               integer("version").notNull().default(1),
  parentId:              integer("parent_id"),

  clientAccountId:       varchar("client_account_id", { length: 64 }),
  clientName:            varchar("client_name",       { length: 256 }).notNull(),

  clientDurationSec:     real("client_duration_sec"),
  clientAmountUsd:       real("client_amount_usd"),
  clientCalls:           integer("client_calls"),

  bitsautoDurationSec:   real("bitsauto_duration_sec"),
  bitsautoAmountUsd:     real("bitsauto_amount_usd"),
  bitsautoCalls:         integer("bitsauto_calls"),

  dmrDurationSec:        real("dmr_duration_sec"),
  dmrAmountUsd:          real("dmr_amount_usd"),

  deltaDurationSec:      real("delta_duration_sec"),
  deltaAmountUsd:        real("delta_amount_usd"),
  deltaPct:              real("delta_pct"),

  discrepancyType:       varchar("discrepancy_type", { length: 32 }).notNull().default('no_client_data'),
  severity:              varchar("severity",          { length: 16 }).notNull().default('clean'),
  status:                varchar("status",            { length: 32 }).notNull().default('pending'),

  invoiceId:             integer("invoice_id"),
  source:                varchar("source", { length: 32 }).notNull().default('manual'),
  rawImport:             jsonb("raw_import"),
  notes:                 text("notes"),

  reviewedBy:            varchar("reviewed_by", { length: 128 }),
  reviewedAt:            timestamp("reviewed_at"),
  reconciledAt:          timestamp("reconciled_at"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
});
export type ClientRevenueReconciliation       = typeof clientRevenueReconciliations.$inferSelect;
export type InsertClientRevenueReconciliation = typeof clientRevenueReconciliations.$inferInsert;
export const insertClientRevenueReconciliationSchema = createInsertSchema(clientRevenueReconciliations).omit({ id: true, createdAt: true });

export const communicationPolicies = pgTable("communication_policies", {
  id:               serial("id").primaryKey(),
  triggerType:      varchar("trigger_type",    { length: 64  }).notNull(),
  severityFilter:   varchar("severity_filter", { length: 32  }).notNull().default('all'),
  // 'all' | 'minor' | 'major' | 'critical'
  senderProfileId:  integer("sender_profile_id"),
  templateType:     varchar("template_type",   { length: 64  }),
  // maps to commercial_notification.type
  recipientGroup:   varchar("recipient_group", { length: 64  }).notNull().default('all_clients'),
  // 'all_clients' | 'management' | 'finance' | 'noc' | 'internal_team'
  channelType:      varchar("channel_type",    { length: 32  }).notNull().default('email'),
  // 'email' | 'whatsapp' | 'email+whatsapp'
  autoDraft:        boolean("auto_draft").notNull().default(true),
  cooldownMinutes:  integer("cooldown_minutes").notNull().default(0),
  approvalRequired: boolean("approval_required").notNull().default(true),
  enabled:          boolean("enabled").notNull().default(true),
  description:      text("description"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});
export type CommunicationPolicy       = typeof communicationPolicies.$inferSelect;
export type InsertCommunicationPolicy = typeof communicationPolicies.$inferInsert;
export const insertCommunicationPolicySchema = createInsertSchema(communicationPolicies).omit({ id: true, createdAt: true });

export const commercialNotifications = pgTable("commercial_notifications", {
  id:            serial("id").primaryKey(),
  type:          varchar("type",          { length: 64  }).notNull(),
  destination:   varchar("destination",   { length: 128 }),
  prefix:        varchar("prefix",        { length: 32  }),
  oldValue:      varchar("old_value",     { length: 128 }),
  newValue:      varchar("new_value",     { length: 128 }),
  effectiveDate: varchar("effective_date",{ length: 32  }),
  subject:       varchar("subject",       { length: 512 }).notNull(),
  body:          text("body").notNull(),
  audienceType:      varchar("audience_type",      { length: 64  }).notNull().default('all_clients'),
  // 'all_clients' | 'manual' | 'internal_team' | 'vendors'
  senderProfileId:   integer("sender_profile_id"),
  // New: traceability columns
  tariffChangeEventId: integer("tariff_change_event_id"),
  policyId:            integer("policy_id"),
  createdBy:     varchar("created_by",    { length: 128 }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  status:        varchar("status",        { length: 32  }).notNull().default('draft'),
  // 'draft' | 'dispatched' | 'partial'
  sentCount:     integer("sent_count").default(0),
  failedCount:   integer("failed_count").default(0),
  dispatchedAt:  timestamp("dispatched_at"),
});
export type CommercialNotification       = typeof commercialNotifications.$inferSelect;
export type InsertCommercialNotification = typeof commercialNotifications.$inferInsert;
export const insertCommercialNotificationSchema = createInsertSchema(commercialNotifications).omit({ id: true, createdAt: true });

export const commercialNotificationRecipients = pgTable("commercial_notification_recipients", {
  id:             serial("id").primaryKey(),
  notificationId: integer("notification_id").notNull(),
  companyId:      integer("company_id"),
  email:          varchar("email",          { length: 256 }).notNull(),
  recipientName:  varchar("recipient_name", { length: 256 }),
  deliveryStatus: varchar("delivery_status",{ length: 32  }).notNull().default('pending'),
  // 'pending' | 'sent' | 'failed' | 'skipped'
  sentAt:         timestamp("sent_at"),
  failedReason:   varchar("failed_reason",  { length: 512 }),
  // ── Acknowledgement tracking (migration 012) ──────────────────────────────
  trackingToken:  varchar("tracking_token", { length: 64 }),
  openedAt:       timestamp("opened_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  openCount:      integer("open_count").notNull().default(0),
});
export type CommercialNotificationRecipient       = typeof commercialNotificationRecipients.$inferSelect;
export type InsertCommercialNotificationRecipient = typeof commercialNotificationRecipients.$inferInsert;

// ── SMTP Sender Profiles — named sending identities per communication type ────
// Operators configure separate identities for billing, rates, pricing, NOC etc.
// The dispatch engine picks the profile matching the notification type.
// smtp_pass is stored encrypted-at-rest via DB; never returned to frontend.
export const smtpSenderProfiles = pgTable("smtp_sender_profiles", {
  id:                serial("id").primaryKey(),
  name:              varchar("name",              { length: 128 }).notNull(),
  emailAddress:      varchar("email_address",     { length: 256 }).notNull(),
  replyTo:           varchar("reply_to",          { length: 256 }),
  communicationType: varchar("communication_type",{ length: 64  }).notNull().default('general'),
  // 'billing' | 'rates' | 'pricing' | 'support' | 'noc' | 'general'
  isDefault:         boolean("is_default").default(false),
  smtpHost:          varchar("smtp_host",         { length: 256 }).notNull().default('smtp.gmail.com'),
  smtpPort:          integer("smtp_port").notNull().default(587),
  smtpUser:          varchar("smtp_user",         { length: 256 }).notNull(),
  smtpPass:          varchar("smtp_pass",         { length: 512 }).notNull(),
  smtpSecure:        boolean("smtp_secure").default(false),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});
export type SmtpSenderProfile       = typeof smtpSenderProfiles.$inferSelect;
export type InsertSmtpSenderProfile = typeof smtpSenderProfiles.$inferInsert;
export const insertSmtpSenderProfileSchema = createInsertSchema(smtpSenderProfiles).omit({ id: true, createdAt: true, updatedAt: true });

// ── Tariff Versioning — Layer 4A ──────────────────────────────────────────────
// Immutable point-in-time snapshots of Sippy tariff states.
// Required for: invoice reproducibility, interval change history,
//   rating verification, carrier reconciliation, Morocco workflows.
//
// Design: Once a snapshot row is written, snapshotJson is never mutated.
// source: 'manual' | 'auto_snapshot' | 'morocco_workflow' | 'pre_change' | 'post_change'
export const tariffVersions = pgTable("tariff_versions", {
  id:            serial("id").primaryKey(),
  iTariff:       varchar("i_tariff",     { length: 64  }).notNull(),
  tariffName:    varchar("tariff_name",  { length: 256 }),
  source:        varchar("source",       { length: 32  }).notNull().default('manual'),
  snapshotJson:  text("snapshot_json").notNull(),
  rateCount:     integer("rate_count").default(0),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo:   timestamp("effective_to"),
  notes:         text("notes"),
  createdBy:     varchar("created_by",   { length: 128 }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
export type TariffVersion       = typeof tariffVersions.$inferSelect;
export type InsertTariffVersion = typeof tariffVersions.$inferInsert;
export const insertTariffVersionSchema = createInsertSchema(tariffVersions).omit({ id: true, createdAt: true });

// Individual field-level change events belonging to a tariff version snapshot.
// changeType: 'added' | 'removed' | 'interval_changed' | 'rate_changed' | 'surcharge_changed' | 'modified'
export const tariffChangeEvents = pgTable("tariff_change_events", {
  id:              serial("id").primaryKey(),
  tariffVersionId: integer("tariff_version_id").notNull(),
  iTariff:         varchar("i_tariff",      { length: 64  }).notNull(),
  prefix:          varchar("prefix",        { length: 32  }),
  destination:     varchar("destination",   { length: 256 }),
  changeType:      varchar("change_type",   { length: 32  }).notNull(),
  oldInterval1:    integer("old_interval_1"),
  newInterval1:    integer("new_interval_1"),
  oldIntervalN:    integer("old_interval_n"),
  newIntervalN:    integer("new_interval_n"),
  oldPrice1:       real("old_price_1"),
  newPrice1:       real("new_price_1"),
  oldPriceN:       real("old_price_n"),
  newPriceN:       real("new_price_n"),
  oldConnectFee:   real("old_connect_fee"),
  newConnectFee:   real("new_connect_fee"),
  oldGracePeriod:  integer("old_grace_period"),
  newGracePeriod:  integer("new_grace_period"),
  oldSurcharge:    real("old_surcharge"),
  newSurcharge:    real("new_surcharge"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type TariffChangeEvent       = typeof tariffChangeEvents.$inferSelect;
export type InsertTariffChangeEvent = typeof tariffChangeEvents.$inferInsert;
export const insertTariffChangeEventSchema = createInsertSchema(tariffChangeEvents).omit({ id: true, createdAt: true });

// ── Rating Verification — Layer 4B ────────────────────────────────────────────
// Deterministic telecom rating reproduction and comparison.
// Per-CDR record: historical tariff resolved → cost reproduced → delta classified.
//
// discrepancyType:
//   exact_match | overbilled | underbilled | interval_mismatch |
//   connect_fee_mismatch | grace_period_mismatch | surcharge_mismatch |
//   missing_rate | unrated
//
// severity: none | minor | major | critical
// verificationSource: auto | manual | ai
// verificationStatus: pending | verified | disputed | flagged
export const ratingVerifications = pgTable("rating_verifications", {
  id:                 serial("id").primaryKey(),
  cdrCallId:          varchar("cdr_call_id",     { length: 128 }),
  cdrStartTime:       varchar("cdr_start_time",  { length: 64  }),
  prefix:             varchar("prefix",           { length: 32  }),
  destination:        varchar("destination",      { length: 256 }),
  iTariff:            varchar("i_tariff",         { length: 64  }),
  tariffVersionId:    integer("tariff_version_id"),
  durationSecs:       integer("duration_secs"),
  billedSecs:         integer("billed_secs"),
  sippyActualCost:    real("sippy_actual_cost"),
  reproducedCost:     real("reproduced_cost"),
  deltaAmount:        real("delta_amount"),
  deltaPct:           real("delta_pct"),
  discrepancyType:    varchar("discrepancy_type",    { length: 64  }).notNull().default('unrated'),
  verificationStatus: varchar("verification_status", { length: 32  }).notNull().default('pending'),
  severity:           varchar("severity",            { length: 16  }).notNull().default('none'),
  verificationSource: varchar("verification_source", { length: 32  }).notNull().default('auto'),
  verifiedAt:         timestamp("verified_at"),
  notes:              text("notes"),
  rateSnapshot:       text("rate_snapshot"),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
});
export type RatingVerification       = typeof ratingVerifications.$inferSelect;
export type InsertRatingVerification = typeof ratingVerifications.$inferInsert;
export const insertRatingVerificationSchema = createInsertSchema(ratingVerifications).omit({ id: true, createdAt: true });

// ── Immutable Rating Snapshots — Layer 4C ─────────────────────────────────────
// Crystallized telecom finance truth — permanent invoice-safe record.
//
// Once created:
//   - Economic fields are NEVER mutated.
//   - snapshot_hash detects any tampering.
//   - locked_at is the immutable commit timestamp.
//
// This is the prerequisite for:
//   5B — Automated Invoice Delivery (invoices reference these snapshots)
//   5C — Carrier Invoice Reconciliation (discrepancy proofs use these snapshots)
export const invoiceCdrSnapshots = pgTable("invoice_cdr_snapshots", {
  id:                     serial("id").primaryKey(),
  cdrId:                  varchar("cdr_id",              { length: 128 }),
  cdrStartTime:           varchar("cdr_start_time",      { length: 64  }),
  callee:                 varchar("callee",               { length: 256 }),
  durationSecs:           integer("duration_secs"),
  iTariff:                varchar("i_tariff",             { length: 64  }),
  tariffVersionId:        integer("tariff_version_id"),
  ratingVerificationId:   integer("rating_verification_id"),
  reproducedCost:         real("reproduced_cost").notNull(),
  actualCost:             real("actual_cost"),
  delta:                  real("delta"),
  interval1Used:          integer("interval_1_used"),
  intervalNUsed:          integer("interval_n_used"),
  price1Used:             real("price_1_used"),
  priceNUsed:             real("price_n_used"),
  connectFeeUsed:         real("connect_fee_used"),
  gracePeriodUsed:        integer("grace_period_used"),
  freeSecondsUsed:        integer("free_seconds_used"),
  postCallSurchargeUsed:  real("post_call_surcharge_used"),
  prefix:                 varchar("prefix",               { length: 32  }),
  verificationStatus:     varchar("verification_status",  { length: 32  }).notNull().default('pending'),
  snapshotHash:           varchar("snapshot_hash",        { length: 64  }).notNull(),
  lockedAt:               timestamp("locked_at").defaultNow().notNull(),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
});
export type InvoiceCdrSnapshot       = typeof invoiceCdrSnapshots.$inferSelect;
export type InsertInvoiceCdrSnapshot = typeof invoiceCdrSnapshots.$inferInsert;
export const insertInvoiceCdrSnapshotSchema = createInsertSchema(invoiceCdrSnapshots).omit({ id: true, createdAt: true, lockedAt: true });

// ── Layer 5A — Monthly Executive Reports ──────────────────────────────────────
// Intelligence presentation layer — NOT financial truth generation.
// Safe to deploy immediately. Does not depend on tariff versioning or snapshots.
export const reportJobs = pgTable("report_jobs", {
  id:             serial("id").primaryKey(),
  reportType:     varchar("report_type",     { length: 32  }).notNull().default('executive_monthly'),
  title:          varchar("title",           { length: 256 }),
  periodStart:    varchar("period_start",    { length: 32  }),
  periodEnd:      varchar("period_end",      { length: 32  }),
  deliveryStatus: varchar("delivery_status", { length: 32  }).notNull().default('generated'),
  recipientsJson: text("recipients_json"),
  htmlContent:    text("html_content"),
  generatedAt:    timestamp("generated_at").defaultNow(),
  sentAt:         timestamp("sent_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
export type ReportJob       = typeof reportJobs.$inferSelect;
export type InsertReportJob = typeof reportJobs.$inferInsert;
export const insertReportJobSchema = createInsertSchema(reportJobs).omit({ id: true, createdAt: true });

// ── Layer 5B — Automated Invoice Delivery ─────────────────────────────────────
// CRITICAL: Invoices MUST use invoice_cdr_snapshots ONLY. Never live tariffs.
// Draft flow: draft → review → approved → sent (NEVER auto-send on first deploy).
export const invoices = pgTable("invoices", {
  id:              serial("id").primaryKey(),
  invoiceNumber:   varchar("invoice_number",  { length: 64  }).notNull(),
  iTariff:         varchar("i_tariff",         { length: 64  }),
  customerName:    varchar("customer_name",    { length: 256 }),
  periodStart:     varchar("period_start",     { length: 32  }),
  periodEnd:       varchar("period_end",       { length: 32  }),
  totalReproduced: real("total_reproduced"),
  totalActual:     real("total_actual"),
  totalDelta:      real("total_delta"),
  lineCount:       integer("line_count"),
  status:          varchar("status",           { length: 32  }).notNull().default('draft'),
  generatedAt:     timestamp("generated_at").defaultNow(),
  approvedAt:      timestamp("approved_at"),
  sentAt:          timestamp("sent_at"),
  notes:           text("notes"),
  htmlContent:     text("html_content"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type Invoice       = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });

export const invoiceLineItems = pgTable("invoice_line_items", {
  id:             serial("id").primaryKey(),
  invoiceId:      integer("invoice_id").notNull(),
  snapshotId:     integer("snapshot_id"),
  cdrCallId:      varchar("cdr_call_id",  { length: 128 }),
  prefix:         varchar("prefix",       { length: 32  }),
  durationSecs:   integer("duration_secs"),
  reproducedCost: real("reproduced_cost"),
  actualCost:     real("actual_cost"),
  delta:          real("delta"),
});
export type InvoiceLineItem       = typeof invoiceLineItems.$inferSelect;
export type InsertInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
export const insertInvoiceLineItemSchema = createInsertSchema(invoiceLineItems).omit({ id: true });

// ── Invoice Email Deliveries — audit log of every invoice send attempt ─────────
export const invoiceEmailDeliveries = pgTable("invoice_email_deliveries", {
  id:           serial("id").primaryKey(),
  invoiceId:    integer("invoice_id").notNull(),
  recipients:   text("recipients").notNull(),   // JSON array of To: addresses
  ccAddresses:  text("cc_addresses").default('[]'), // JSON array of CC: addresses
  subject:      varchar("subject",     { length: 512 }).notNull(),
  bodyText:     text("body_text"),
  sentBy:       varchar("sent_by",     { length: 255 }),  // user id / name
  status:       varchar("status",      { length: 32  }).notNull().default('sent'), // sent | failed
  errorMessage: text("error_message"),
  sentAt:       timestamp("sent_at").defaultNow(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});
export type InvoiceEmailDelivery       = typeof invoiceEmailDeliveries.$inferSelect;
export type InsertInvoiceEmailDelivery = typeof invoiceEmailDeliveries.$inferInsert;
export const insertInvoiceEmailDeliverySchema = createInsertSchema(invoiceEmailDeliveries).omit({ id: true, createdAt: true });

// ── Layer 5C — Carrier Invoice Reconciliation ─────────────────────────────────
// Shadow verification mode ONLY on first deploy.
// Compares: Carrier Invoice vs Sippy Actual vs BitsAuto Reproduced vs Immutable Snapshot.
// No automatic accounting actions. Discrepancy intelligence only.
export const carrierReconciliations = pgTable("carrier_reconciliations", {
  id:                       serial("id").primaryKey(),
  carrierName:              varchar("carrier_name",    { length: 256 }).notNull(),
  iTariff:                  varchar("i_tariff",         { length: 64  }),
  invoiceRef:               varchar("invoice_ref",      { length: 128 }),
  invoiceDate:              varchar("invoice_date",     { length: 32  }),
  periodStart:              varchar("period_start",     { length: 32  }),
  periodEnd:                varchar("period_end",       { length: 32  }),
  carrierTotal:             real("carrier_total"),
  sippyTotal:               real("sippy_total"),
  reproducedTotal:          real("reproduced_total"),
  snapshotTotal:            real("snapshot_total"),
  deltaCarrierVsReproduced: real("delta_carrier_vs_reproduced"),
  deltaCarrierVsSippy:      real("delta_carrier_vs_sippy"),
  discrepancyCount:         integer("discrepancy_count").default(0),
  status:                   varchar("status",           { length: 32  }).notNull().default('shadow'),
  notes:                    text("notes"),
  createdAt:                timestamp("created_at").defaultNow().notNull(),
});
export type CarrierReconciliation       = typeof carrierReconciliations.$inferSelect;
export type InsertCarrierReconciliation = typeof carrierReconciliations.$inferInsert;
export const insertCarrierReconciliationSchema = createInsertSchema(carrierReconciliations).omit({ id: true, createdAt: true });

// ── Layer 5D — Payments Received ──────────────────────────────────────────────
export const payments = pgTable("payments", {
  id:            serial("id").primaryKey(),
  companyId:     integer("company_id"),
  companyName:   varchar("company_name",   { length: 256 }),
  invoiceId:     integer("invoice_id"),
  amount:        real("amount").notNull().default(0),
  currency:      varchar("currency",       { length: 8  }).notNull().default('USD'),
  paymentDate:   varchar("payment_date",   { length: 32 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 64 }).default('bank_transfer'),
  reference:     varchar("reference",      { length: 256 }),
  notes:         text("notes"),
  status:        varchar("status",         { length: 32 }).notNull().default('received'),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
export type Payment       = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });

// ── Layer 5E — Invoice Schedules ───────────────────────────────────────────────
export const invoiceSchedules = pgTable("invoice_schedules", {
  id:          serial("id").primaryKey(),
  companyId:   integer("company_id"),
  companyName: varchar("company_name", { length: 256 }),
  iAccount:    integer("i_account"),
  iTariff:     varchar("i_tariff",     { length: 64  }),
  frequency:   varchar("frequency",    { length: 32  }).notNull().default('monthly'),
  dayOfWeek:   integer("day_of_week").default(1),
  dayOfMonth:  integer("day_of_month").default(1),
  timezone:    varchar("timezone",     { length: 64  }).default('Etc/UTC'),
  autoApprove: boolean("auto_approve").default(false),
  active:      boolean("active").notNull().default(true),
  lastRunAt:   timestamp("last_run_at"),
  nextRunAt:   timestamp("next_run_at"),
  notes:       text("notes"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
export type InvoiceSchedule       = typeof invoiceSchedules.$inferSelect;
export type InsertInvoiceSchedule = typeof invoiceSchedules.$inferInsert;
export const insertInvoiceScheduleSchema = createInsertSchema(invoiceSchedules).omit({ id: true, createdAt: true });

// ── Layer 5F — Payment Reminder Config ────────────────────────────────────────
export const paymentReminderConfig = pgTable("payment_reminder_config", {
  id:                    serial("id").primaryKey(),
  graceDays:             integer("grace_days").notNull().default(7),
  reminderIntervalDays:  integer("reminder_interval_days").notNull().default(7),
  maxReminders:          integer("max_reminders").notNull().default(3),
  enabled:               boolean("enabled").notNull().default(false),
  reminderEmailTemplate: text("reminder_email_template"),
  updatedAt:             timestamp("updated_at").defaultNow().notNull(),
});
export type PaymentReminderConfig       = typeof paymentReminderConfig.$inferSelect;
export type InsertPaymentReminderConfig = typeof paymentReminderConfig.$inferInsert;

// ── CDR Re-rating Runs ────────────────────────────────────────────────────────
// Scenario analysis ONLY — never modifies invoice_cdr_snapshots (immutable).
// mode='flat_rate': every CDR duration * flatRatePerMin = reratedCost.
// mode='tariff_swap': deferred — requires Sippy prefix-match integration.
export const cdrRerateRuns = pgTable("cdr_rerate_runs", {
  id:             serial("id").primaryKey(),
  name:           varchar("name",            { length: 256 }).notNull(),
  mode:           varchar("mode",            { length: 32  }).notNull().default('flat_rate'),
  fromDate:       varchar("from_date",       { length: 32  }).notNull(),
  toDate:         varchar("to_date",         { length: 32  }).notNull(),
  iTariffFilter:  varchar("i_tariff_filter", { length: 64  }),
  flatRatePerMin: real("flat_rate_per_min"),
  status:         varchar("status",          { length: 32  }).notNull().default('pending'),
  snapshotCount:  integer("snapshot_count").default(0),
  originalCost:   real("original_cost").default(0),
  reratedCost:    real("rerated_cost").default(0),
  delta:          real("delta").default(0),
  savingsPct:     real("savings_pct").default(0),
  notes:          text("notes"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  completedAt:    timestamp("completed_at"),
});
export type CdrRerateRun       = typeof cdrRerateRuns.$inferSelect;
export type InsertCdrRerateRun = typeof cdrRerateRuns.$inferInsert;
export const insertCdrRerateRunSchema = createInsertSchema(cdrRerateRuns).omit({ id: true, createdAt: true, completedAt: true });

// ── Portal Governance Framework ───────────────────────────────────────────────

export const portalDefinitions = pgTable("portal_definitions", {
  id:              serial("id").primaryKey(),
  slug:            text("slug").unique().notNull(),
  name:            text("name").notNull(),
  icon:            text("icon").notNull().default("layout-dashboard"),
  theme:           text("theme").notNull().default("neutral"),
  layoutType:      text("layout_type").notNull().default("sidebar-sections"),
  defaultRoute:    text("default_route").notNull().default("/"),
  allowedRoles:    text("allowed_roles").array().notNull().default([]),
  isActive:        boolean("is_active").notNull().default(true),
  sortOrder:       integer("sort_order").notNull().default(0),
  // Theme engine fields
  primaryColor:    text("primary_color").notNull().default("purple"),
  accentColor:     text("accent_color").notNull().default("indigo"),
  backgroundStyle: text("background_style").notNull().default("flat"),
  density:         text("density").notNull().default("comfortable"),
  navStyle:        text("nav_style").notNull().default("glass"),
  fontScale:       text("font_scale").notNull().default("normal"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});
export type PortalDefinition       = typeof portalDefinitions.$inferSelect;
export type InsertPortalDefinition = typeof portalDefinitions.$inferInsert;

export const navigationModules = pgTable("navigation_modules", {
  id:             serial("id").primaryKey(),
  moduleKey:      text("module_key").unique().notNull(),
  title:          text("title").notNull(),
  icon:           text("icon").notNull().default("circle"),
  route:          text("route").notNull(),
  engine:         text("engine"),
  adapterSupport: text("adapter_support").array().notNull().default([]),
  category:       text("category").notNull().default("general"),
  defaultPortal:  text("default_portal"),
  isMovable:      boolean("is_movable").notNull().default(true),
  isSystem:       boolean("is_system").notNull().default(false),
  sortOrder:      integer("sort_order").notNull().default(0),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
export type NavigationModule       = typeof navigationModules.$inferSelect;
export type InsertNavigationModule = typeof navigationModules.$inferInsert;

export const portalModuleAssignments = pgTable("portal_module_assignments", {
  id:               serial("id").primaryKey(),
  portalId:         text("portal_id").notNull(),
  moduleId:         integer("module_id").notNull(),
  section:          text("section").notNull().default("main"),
  displayOrder:     integer("display_order").notNull().default(0),
  displayLabel:     text("display_label"),
  adapter:          text("adapter"),
  visibility:       text("visibility").notNull().default("full"),
  isHome:           boolean("is_home").notNull().default(false),
  isPinned:         boolean("is_pinned").notNull().default(false),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
  updatedBy:        text("updated_by"),
  // Adapter metadata (T001)
  adapterType:      text("adapter_type"),
  widgetProfile:    text("widget_profile").notNull().default("standard"),
  accessScope:      text("access_scope").notNull().default("global"),
  realtimeEnabled:  boolean("realtime_enabled").notNull().default(false),
  densityMode:      text("density_mode").notNull().default("standard"),
  defaultTimeRange: text("default_time_range").notNull().default("24h"),
});
export type PortalModuleAssignment       = typeof portalModuleAssignments.$inferSelect;
export type InsertPortalModuleAssignment = typeof portalModuleAssignments.$inferInsert;

// Enriched type returned by getPortalModules
export interface PortalModuleWithMeta extends PortalModuleAssignment {
  moduleKey:  string;
  title:      string;
  icon:       string;
  route:      string;
  engine:     string | null;
  isSystem:   boolean;
  isMovable:  boolean;
}

// ── Portal Sections (DB-driven Level 2 domain navigation tabs) ────────────────
export const portalSections = pgTable("portal_sections", {
  id:         serial("id").primaryKey(),
  portalId:   text("portal_id").notNull().references(() => portalDefinitions.slug, { onDelete: "cascade" }),
  sectionKey: text("section_key").notNull(),
  title:      text("title").notNull(),
  icon:       text("icon").notNull().default("circle"),
  sortOrder:  integer("sort_order").notNull().default(0),
  isActive:   boolean("is_active").notNull().default(true),
});

export type PortalSection       = typeof portalSections.$inferSelect;

// ── User Favorites ────────────────────────────────────────────────────────────
export const userFavorites = pgTable("user_favorites", {
  id:         serial("id").primaryKey(),
  userId:     text("user_id").notNull(),
  moduleKey:  text("module_key").notNull(),
  portalKey:  text("portal_key"),
  label:      text("label"),
  icon:       text("icon").notNull().default("circle"),
  route:      text("route").notNull(),
  sortOrder:  integer("sort_order").notNull().default(0),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});
export type UserFavorite       = typeof userFavorites.$inferSelect;
export type InsertUserFavorite = typeof userFavorites.$inferInsert;
export type InsertPortalSection = typeof portalSections.$inferInsert;

// ── RBAC Matrix ────────────────────────────────────────────────────────────────
export const rbacPermissions = pgTable("rbac_permissions", {
  id:          serial("id").primaryKey(),
  key:         varchar("key",         { length: 80  }).notNull().unique(),
  domain:      varchar("domain",      { length: 40  }).notNull(),
  label:       varchar("label",       { length: 120 }).notNull(),
  description: text("description"),
  riskLevel:   varchar("risk_level",  { length: 20  }).notNull().default('low'),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
export type RbacPermission = typeof rbacPermissions.$inferSelect;

export const rbacRolePermissions = pgTable("rbac_role_permissions", {
  id:            serial("id").primaryKey(),
  role:          varchar("role",           { length: 40 }).notNull(),
  permissionKey: varchar("permission_key", { length: 80 }).notNull().references(() => rbacPermissions.key, { onDelete: 'cascade' }),
  granted:       boolean("granted").notNull().default(true),
  grantedBy:     varchar("granted_by",    { length: 255 }),
  grantedAt:     timestamp("granted_at").defaultNow().notNull(),
});
export type RbacRolePermission = typeof rbacRolePermissions.$inferSelect;

export const rbacUserPermissionOverrides = pgTable("rbac_user_permission_overrides", {
  id:            serial("id").primaryKey(),
  userId:        varchar("user_id",        { length: 255 }).notNull(),
  permissionKey: varchar("permission_key", { length: 80  }).notNull().references(() => rbacPermissions.key, { onDelete: 'cascade' }),
  granted:       boolean("granted").notNull(),
  scope:         varchar("scope",          { length: 40  }).default('all'),
  reason:        text("reason"),
  grantedBy:     varchar("granted_by",    { length: 255 }).notNull(),
  grantedAt:     timestamp("granted_at").defaultNow().notNull(),
  expiresAt:     timestamp("expires_at"),
});
export type RbacUserPermissionOverride = typeof rbacUserPermissionOverrides.$inferSelect;

export const rbacPermissionAuditEvents = pgTable("rbac_permission_audit_events", {
  id:           serial("id").primaryKey(),
  eventType:    varchar("event_type",     { length: 60  }).notNull(),
  actorId:      varchar("actor_id",       { length: 255 }).notNull(),
  targetUserId: varchar("target_user_id", { length: 255 }),
  targetRole:   varchar("target_role",   { length: 40  }),
  permissionKey:varchar("permission_key", { length: 80  }),
  beforeValue:  json("before_value").$type<any>(),
  afterValue:   json("after_value").$type<any>(),
  ipAddress:    varchar("ip_address",    { length: 45  }),
  userAgent:    text("user_agent"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});
export type RbacPermissionAuditEvent = typeof rbacPermissionAuditEvents.$inferSelect;

// ── NOC Incident Command Center ───────────────────────────────────────────────
// Network-level incidents (route degradation, carrier outage, etc.)
// Distinct from account-level `incidents` table (ACCOUNT_HEALTH / FAS_SPIKE).

export const NOC_INCIDENT_TYPES = [
  'route_degradation', 'carrier_outage', 'fraud_alert',
  'quality_issue', 'traffic_drop', 'routing_failure', 'manual',
] as const;

export const NOC_INCIDENT_STATUSES = [
  'open', 'investigating', 'mitigated', 'resolved', 'postmortem',
] as const;

export const nocIncidents = pgTable("noc_incidents", {
  id:              serial("id").primaryKey(),
  title:           varchar("title",           { length: 255 }).notNull(),
  type:            varchar("type",            { length: 32  }).notNull().default('manual'),
  severity:        varchar("severity",        { length: 20  }).notNull().default('medium'),
  status:          varchar("status",          { length: 20  }).notNull().default('open'),
  entityType:      varchar("entity_type",     { length: 32  }),
  entityId:        varchar("entity_id",       { length: 128 }),
  entityName:      varchar("entity_name",     { length: 255 }),
  description:     text("description"),
  suggestedAction: text("suggested_action"),
  assigneeId:      varchar("assignee_id",     { length: 255 }),
  assigneeName:    varchar("assignee_name",   { length: 255 }),
  source:          varchar("source",          { length: 64  }).notNull().default('manual'),
  tags:            text("tags").array().notNull().default([]),
  openedAt:        timestamp("opened_at").defaultNow().notNull(),
  acknowledgedAt:  timestamp("acknowledged_at"),
  mitigatedAt:     timestamp("mitigated_at"),
  resolvedAt:      timestamp("resolved_at"),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});
export type NocIncident       = typeof nocIncidents.$inferSelect;
export type InsertNocIncident = typeof nocIncidents.$inferInsert;
export const insertNocIncidentSchema = createInsertSchema(nocIncidents).omit({ id: true, openedAt: true, updatedAt: true });

export const nocIncidentEvents = pgTable("noc_incident_events", {
  id:         serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull(),
  eventType:  varchar("event_type",   { length: 32  }).notNull(),
  fromStatus: varchar("from_status",  { length: 20  }),
  toStatus:   varchar("to_status",    { length: 20  }),
  actorId:    varchar("actor_id",     { length: 255 }),
  actorName:  varchar("actor_name",   { length: 255 }).notNull().default('system'),
  note:       text("note"),
  metadata:   json("metadata").$type<Record<string, unknown>>(),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});
export type NocIncidentEvent       = typeof nocIncidentEvents.$inferSelect;
export type InsertNocIncidentEvent = typeof nocIncidentEvents.$inferInsert;

export const nocIncidentAssignments = pgTable("noc_incident_assignments", {
  id:         serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull(),
  userId:     varchar("user_id",    { length: 255 }).notNull(),
  userName:   varchar("user_name",  { length: 255 }).notNull(),
  assignedBy: varchar("assigned_by",{ length: 255 }),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  isActive:   boolean("is_active").notNull().default(true),
});
export type NocIncidentAssignment       = typeof nocIncidentAssignments.$inferSelect;
export type InsertNocIncidentAssignment = typeof nocIncidentAssignments.$inferInsert;

// ── Security Sprint ───────────────────────────────────────────────────────────

export const mfaSecrets = pgTable("mfa_secrets", {
  id:          serial("id").primaryKey(),
  userId:      varchar("user_id",  { length: 255 }).notNull().unique(),
  secret:      text("secret").notNull(),
  isEnabled:   boolean("is_enabled").notNull().default(false),
  backupCodes: text("backup_codes").array().notNull().default([]),
  enabledAt:   timestamp("enabled_at"),
  lastUsedAt:  timestamp("last_used_at"),
});
export type MfaSecret = typeof mfaSecrets.$inferSelect;

export const userSessions = pgTable("user_sessions", {
  id:           serial("id").primaryKey(),
  sessionId:    varchar("session_id",  { length: 512 }).notNull(),
  userId:       varchar("user_id",     { length: 255 }).notNull(),
  ipAddress:    varchar("ip_address",  { length: 64  }),
  userAgent:    text("user_agent"),
  lastActivity: timestamp("last_activity").defaultNow().notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  isRevoked:    boolean("is_revoked").notNull().default(false),
  revokedAt:    timestamp("revoked_at"),
  revokedBy:    varchar("revoked_by",  { length: 255 }),
});
export type UserSession = typeof userSessions.$inferSelect;

export const ipRestrictions = pgTable("ip_restrictions", {
  id:          serial("id").primaryKey(),
  scope:       varchar("scope",        { length: 20  }).notNull().default('global'),
  scopeValue:  varchar("scope_value",  { length: 255 }),
  cidr:        varchar("cidr",         { length: 64  }).notNull(),
  description: text("description"),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  createdBy:   varchar("created_by",   { length: 255 }),
});
export type IpRestriction = typeof ipRestrictions.$inferSelect;

// ── Client Identity Map ───────────────────────────────────────────────────────
// Canonical identity resolution layer for all finance/governance systems.
// Every invoice, DMR row, dispute, reconciliation entry, and AI alert
// should resolve through resolveClientIdentity() rather than raw field lookups.
export const clientIdentityMap = pgTable("client_identity_map", {
  id:               serial("id").primaryKey(),
  iAccount:         integer("i_account").unique(),           // Sippy i_account (canonical key)
  sippyUsername:    varchar("sippy_username",  { length: 255 }),  // Sippy account username
  billingName:      varchar("billing_name",    { length: 255 }),  // legal/invoice name
  displayName:      varchar("display_name",    { length: 255 }),  // UI label
  crmName:          varchar("crm_name",        { length: 255 }),  // CRM / commercial name
  portalName:       varchar("portal_name",     { length: 255 }),  // client-portal branding
  externalRef:      varchar("external_ref",    { length: 255 }),  // ERP / CRM ID
  accountManagerId: varchar("account_manager_id", { length: 255 }), // KAM user ID
  financeOwnerId:   varchar("finance_owner_id",   { length: 255 }), // finance escalation user
  riskTier:         varchar("risk_tier", { length: 20 }).default('standard'), // low | standard | elevated | critical
  notes:            text("notes"),
  active:           boolean("active").notNull().default(true),
  lastSyncedAt:     timestamp("last_synced_at"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});
export type ClientIdentity       = typeof clientIdentityMap.$inferSelect;
export type InsertClientIdentity = typeof clientIdentityMap.$inferInsert;
export const insertClientIdentitySchema = createInsertSchema(clientIdentityMap).omit({ id: true, createdAt: true, updatedAt: true });

// ── Workspace Navigation Architecture ────────────────────────────────────────
// Composition layer: maps existing routes into grouped tab workspaces.
// Routes stay intact; only the exposure model changes.
// FREEZE: Do not add new standalone pages — use workspace tabs instead.

export const workspaceDefinitions = pgTable("workspace_definitions", {
  id:          serial("id").primaryKey(),
  slug:        text("slug").unique().notNull(),
  label:       text("label").notNull(),
  description: text("description"),
  portalSlug:  text("portal_slug"),
  domainId:    text("domain_id"),
  icon:        text("icon"),
  sortOrder:   integer("sort_order").default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const workspaceTabs = pgTable("workspace_tabs", {
  id:              serial("id").primaryKey(),
  workspaceId:     integer("workspace_id").notNull(),
  slug:            text("slug").notNull(),
  label:           text("label").notNull(),
  icon:            text("icon"),
  sortOrder:       integer("sort_order").default(0),
  isVisible:       boolean("is_visible").notNull().default(true),
  visibilityRoles: text("visibility_roles").array(),
});

export const workspaceTabItems = pgTable("workspace_tab_items", {
  id:              serial("id").primaryKey(),
  tabId:           integer("tab_id").notNull(),
  route:           text("route").notNull(),
  label:           text("label"),
  icon:            text("icon"),
  sortOrder:       integer("sort_order").default(0),
  isContextual:    boolean("is_contextual").notNull().default(false),
  isHidden:        boolean("is_hidden").notNull().default(false),
  visibilityRoles: text("visibility_roles").array(),
});

export type WorkspaceDefinition   = typeof workspaceDefinitions.$inferSelect;
export type WorkspaceTab          = typeof workspaceTabs.$inferSelect;
export type WorkspaceTabItem      = typeof workspaceTabItems.$inferSelect;
export type WorkspaceTabWithItems = WorkspaceTab & { items: WorkspaceTabItem[] };
export type WorkspaceWithTabs     = WorkspaceDefinition & { tabs: WorkspaceTabWithItems[] };

// ── Termination Chains ───────────────────────────────────────────────────────
export const terminationChains = pgTable("termination_chains", {
  id:                    serial("id").primaryKey(),
  name:                  varchar("name",                 { length: 64  }).notNull(),
  description:           text("description"),
  // REVE layer
  reveProfileId:         integer("reve_profile_id"),
  // Asterisk layer
  asteriskTrunk:         varchar("asterisk_trunk",       { length: 64  }).notNull().default('Sippy'),
  asteriskHost:          varchar("asterisk_host",        { length: 128 }).notNull().default('159.223.32.59'),
  // Sippy layer (IDs from Sippy XML-RPC)
  sippyClientAccountId:  integer("sippy_client_account_id"),
  sippyVendorId:         integer("sippy_vendor_id"),
  sippyConnectionId:     integer("sippy_connection_id"),
  sippyRoutingGroupId:   integer("sippy_routing_group_id"),
  // Cached friendly names
  sippyClientName:       varchar("sippy_client_name",   { length: 128 }),
  sippyVendorName:       varchar("sippy_vendor_name",   { length: 128 }),
  sippyConnectionName:   varchar("sippy_connection_name",{ length: 128 }),
  // Status
  isActive:              boolean("is_active").notNull().default(true),
  notes:                 text("notes"),
  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().notNull(),
});
export type TerminationChain       = typeof terminationChains.$inferSelect;
export type InsertTerminationChain = typeof terminationChains.$inferInsert;

// ── BhaooSMS Profiles ────────────────────────────────────────────────────────
export const bhaooProfiles = pgTable("bhaoo_profiles", {
  id:        serial("id").primaryKey(),
  name:      varchar("name",       { length: 64  }).notNull(),
  baseUrl:   varchar("base_url",   { length: 256 }).notNull().default('http://149.20.185.6/BhaooSMSV5'),
  apiKey:    varchar("api_key",    { length: 128 }).notNull(),
  secretKey: varchar("secret_key", { length: 128 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BhaooProfile       = typeof bhaooProfiles.$inferSelect;
export type InsertBhaooProfile = typeof bhaooProfiles.$inferInsert;
export const insertBhaooProfileSchema = createInsertSchema(bhaooProfiles).omit({ id: true, createdAt: true, updatedAt: true });

// ── BhaooSMS / REVE SMS Integration ──────────────────────────────────────────

export const smsMessages = pgTable("sms_messages", {
  id:            serial("id").primaryKey(),
  internalId:    varchar("internal_id",   { length: 64  }).unique(),
  bhaooId:       varchar("bhaoo_id",      { length: 128 }),
  toNumber:      varchar("to_number",     { length: 32  }).notNull(),
  fromId:        varchar("from_id",       { length: 32  }),
  messageText:   text("message_text"),
  messageType:   varchar("message_type",  { length: 16  }).default('text'),
  status:        varchar("status",        { length: 16  }).notNull().default('submitted'),
  statusCode:    integer("status_code"),
  operator:      varchar("operator",      { length: 64  }),
  country:       varchar("country",       { length: 64  }),
  errorCode:     varchar("error_code",    { length: 32  }),
  errorMessage:  text("error_message"),
  clientRef:          varchar("client_ref",    { length: 128 }),
  profileId:          integer("profile_id"),
  fallbackTriggered:  boolean("fallback_triggered").notNull().default(false),
  fallbackAt:         timestamp("fallback_at"),
  dlrReceivedAt:      timestamp("dlr_received_at"),
  submittedAt:        timestamp("submitted_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
  // Messaging Intelligence Center — channel orchestration fields
  channel:       varchar("channel",       { length: 16  }).default('sms'),   // sms | voice | whatsapp
  provider:      varchar("provider",      { length: 32  }),                   // callmebot | ultramsg | bhaoo | asterisk
  fallbackFrom:  integer("fallback_from"),                                    // id of the original sms_messages row that triggered this fallback
  latencyMs:     integer("latency_ms"),                                       // ms from dispatch to first delivery confirmation
  retryCount:    integer("retry_count").notNull().default(0),                 // number of retry attempts made so far
  nextRetryAt:   timestamp("next_retry_at"),                                  // when the next retry should fire (null = no retry scheduled)
  flowToken:     varchar("flow_token",    { length: 64  }),                   // Meta WhatsApp Flow token (meta_flow provider only)
  verifiedAt:    timestamp("verified_at"),                                    // timestamp of OTP verification via Flow webhook
});
export type SmsMessage       = typeof smsMessages.$inferSelect;
export type InsertSmsMessage = typeof smsMessages.$inferInsert;

export const smsDlrEvents = pgTable("sms_dlr_events", {
  id:         serial("id").primaryKey(),
  messageId:  varchar("message_id",  { length: 128 }),
  clientRef:  varchar("client_ref",  { length: 128 }),
  status:     integer("status"),
  statusText: varchar("status_text", { length: 16  }),
  msisdn:     varchar("msisdn",      { length: 32  }),
  operator:   varchar("operator",    { length: 64  }),
  country:    varchar("country",     { length: 64  }),
  errorCode:  varchar("error_code",  { length: 32  }),
  rawPayload: jsonb("raw_payload"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});
export type SmsDlrEvent = typeof smsDlrEvents.$inferSelect;

export const bhaooBalanceLog = pgTable("bhaoo_balance_log", {
  id:          serial("id").primaryKey(),
  balance:     real("balance").notNull(),
  creditLimit: real("credit_limit"),
  currency:    varchar("currency", { length: 8 }).default('USD'),
  checkedAt:   timestamp("checked_at").defaultNow().notNull(),
});
export type BhaooBalanceLog = typeof bhaooBalanceLog.$inferSelect;

export const smsVendorStats = pgTable("sms_vendor_stats", {
  id:           serial("id").primaryKey(),
  operator:     varchar("operator",  { length: 64  }).notNull(),
  country:      varchar("country",   { length: 64  }),
  sent:         integer("sent").default(0),
  delivered:    integer("delivered").default(0),
  failed:       integer("failed").default(0),
  pending:      integer("pending").default(0),
  deliveryRate: real("delivery_rate"),
  windowStart:  timestamp("window_start").notNull(),
  windowEnd:    timestamp("window_end").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});
export type SmsVendorStat = typeof smsVendorStats.$inferSelect;

// ── Voice OTP ────────────────────────────────────────────────────────────────
export const voiceOtpCalls = pgTable("voice_otp_calls", {
  id:           serial("id").primaryKey(),
  toNumber:     varchar("to_number",  { length: 32 }).notNull(),
  otp:          varchar("otp",         { length: 16 }).notNull(),
  trunk:        varchar("trunk",        { length: 64 }).default('Sippy'),
  asteriskId:   varchar("asterisk_id", { length: 128 }),
  status:       varchar("status",       { length: 16 }).notNull().default('initiated'),
  errorMessage: text("error_message"),
  initiatedAt:  timestamp("initiated_at").defaultNow().notNull(),
  answeredAt:   timestamp("answered_at"),
  completedAt:  timestamp("completed_at"),
});
export type VoiceOtpCall = typeof voiceOtpCalls.$inferSelect;

// ── Call Governance ───────────────────────────────────────────────────────────

export const callGovernanceRules = pgTable("call_governance_rules", {
  id:             serial("id").primaryKey(),
  connectionName: varchar("connection_name", { length: 128 }).notNull(),
  channelPattern: varchar("channel_pattern", { length: 255 }),
  capSec:         integer("cap_sec").notNull().default(120),
  jitterSec:      integer("jitter_sec").notNull().default(15),
  enabled:        boolean("enabled").notNull().default(false),
  action:         varchar("action",   { length: 32 }).notNull().default('cap_and_replay'),
  scenario:       varchar("scenario", { length: 32 }).notNull().default('time_cap'),
  notes:          text("notes"),
  createdAt:      timestamp("created_at").defaultNow(),
  updatedAt:      timestamp("updated_at").defaultNow(),
});
export type CallGovernanceRule = typeof callGovernanceRules.$inferSelect;
export type InsertCallGovernanceRule = typeof callGovernanceRules.$inferInsert;
export const insertCallGovernanceRuleSchema = createInsertSchema(callGovernanceRules)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const governedCalls = pgTable("governed_calls", {
  id:                serial("id").primaryKey(),
  uniqueId:          varchar("unique_id",       { length: 128 }),
  channelA:          varchar("channel_a",        { length: 255 }),
  channelB:          varchar("channel_b",        { length: 255 }),
  caller:            varchar("caller",           { length: 64  }),
  callee:            varchar("callee",           { length: 64  }),
  connectionName:    varchar("connection_name",  { length: 128 }),
  ruleId:            integer("rule_id").references(() => callGovernanceRules.id),
  capSec:            integer("cap_sec"),
  startTime:         timestamp("start_time").defaultNow(),
  byeSentAt:         timestamp("bye_sent_at"),
  playbackStartedAt: timestamp("playback_started_at"),
  completedAt:       timestamp("completed_at"),
  recordingPath:     varchar("recording_path", { length: 512 }),
  triggerReason:     varchar("trigger_reason", { length: 64  }),
  status:            varchar("status",         { length: 32  }).notNull().default('active'),
});
export type GovernedCall = typeof governedCalls.$inferSelect;

export const callGovernanceLogs = pgTable("call_governance_log", {
  id:             serial("id").primaryKey(),
  governedCallId: integer("governed_call_id").references(() => governedCalls.id),
  eventType:      varchar("event_type", { length: 64 }).notNull(),
  channel:        varchar("channel",    { length: 255 }),
  details:        text("details"),
  createdAt:      timestamp("created_at").defaultNow(),
});
export type CallGovernanceLog = typeof callGovernanceLogs.$inferSelect;

// ── Copilot result cache (DB-persisted, survives server restarts) ─────────────
export const copilotResultCache = pgTable("copilot_result_cache", {
  id:          serial("id").primaryKey(),
  result:      jsonb("result").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});
export type CopilotResultCache = typeof copilotResultCache.$inferSelect;

// ── Vendor Probe Results — SIP OPTIONS reachability intelligence ──────────────
// One row per probe attempt per vendor connection.
// Pruned to the last 2 000 rows per vendor automatically by the probe engine.
export const vendorProbeResults = pgTable("vendor_probe_results", {
  id:              serial("id").primaryKey(),
  vendorId:        varchar("vendor_id",        { length: 32  }).notNull(),
  vendorName:      varchar("vendor_name",      { length: 255 }),
  connectionId:    varchar("connection_id",    { length: 32  }),
  connectionName:  varchar("connection_name",  { length: 255 }),
  host:            varchar("host",             { length: 255 }),
  port:            integer("port").default(5060),
  probedAt:        timestamp("probed_at").defaultNow().notNull(),
  latencyMs:       integer("latency_ms"),
  sipResponseCode: integer("sip_response_code"),
  reachable:       boolean("reachable").notNull().default(false),
  error:           varchar("error",            { length: 255 }),
});

export type VendorProbeResult       = typeof vendorProbeResults.$inferSelect;
export type InsertVendorProbeResult = typeof vendorProbeResults.$inferInsert;
export const insertVendorProbeResultSchema = createInsertSchema(vendorProbeResults).omit({ id: true });

// ── Balance Alert Thresholds ──────────────────────────────────────────────────
// account_id NULL = global default threshold applied to all accounts
// account_id set = per-account override
export const balanceAlertThresholds = pgTable("balance_alert_thresholds", {
  id:           serial("id").primaryKey(),
  accountId:    varchar("account_id",    { length: 32 }),   // null = global default
  accountName:  varchar("account_name",  { length: 128 }),  // denormalized display name
  thresholdUsd: real("threshold_usd").notNull(),             // USD balance trigger value
  severity:     varchar("severity",      { length: 16 }).notNull().default('warning'), // warning | urgent | critical
  createdAt:    timestamp("created_at").defaultNow(),
  updatedAt:    timestamp("updated_at").defaultNow(),
});
export type BalanceAlertThreshold = typeof balanceAlertThresholds.$inferSelect;
export type InsertBalanceAlertThreshold = typeof balanceAlertThresholds.$inferInsert;
export const insertBalanceAlertThresholdSchema = createInsertSchema(balanceAlertThresholds)
  .omit({ id: true, createdAt: true, updatedAt: true });

// ── Balance Alert Events ──────────────────────────────────────────────────────
// One row per threshold crossing, resolved when balance rises back above threshold.
export const balanceAlertEvents = pgTable("balance_alert_events", {
  id:             serial("id").primaryKey(),
  accountId:      varchar("account_id",    { length: 32 }).notNull(),
  accountName:    varchar("account_name",  { length: 128 }),
  thresholdUsd:   real("threshold_usd").notNull(),
  severity:       varchar("severity",      { length: 16 }).notNull(), // warning | urgent | critical
  currentBalance: real("current_balance").notNull(),
  triggeredAt:    timestamp("triggered_at").defaultNow().notNull(),
  resolvedAt:     timestamp("resolved_at"),
  checkedAt:      timestamp("checked_at").defaultNow().notNull(),
});
export type BalanceAlertEvent = typeof balanceAlertEvents.$inferSelect;
export type InsertBalanceAlertEvent = typeof balanceAlertEvents.$inferInsert;

// ── SIP Error Stats — per-vendor error code telemetry for AI Route Copilot ───
// Populated every 5 min by the SIP error aggregation background job.
// windowMinutes: 15 | 60 | 240
// code: 503 | 486 | 480 | 404 | 603 | 487
export const sipErrorStats = pgTable("sip_error_stats", {
  id:            serial("id").primaryKey(),
  vendorName:    varchar("vendor_name",     { length: 128 }).notNull(),
  windowMinutes: integer("window_minutes").notNull(),
  code:          integer("code").notNull(),
  count:         integer("count").notNull().default(0),
  rate:          real("rate").notNull().default(0),
  computedAt:    timestamp("computed_at").notNull().defaultNow(),
  destPrefix:    varchar("dest_prefix",     { length: 12 }),
});
export type SipErrorStat = typeof sipErrorStats.$inferSelect;


import { pgTable, text, serial, integer, boolean, timestamp, real, varchar, pgEnum, json } from "drizzle-orm/pg-core";
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
  resolved: boolean("resolved").default(false),
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
  // Sidebar visibility config — JSON array of hidden item hrefs (admin-controlled)
  sidebarHiddenItems: text("sidebar_hidden_items").default('[]'),
  // HLR / CNAM provider config
  hlrProvider:   varchar("hlr_provider",    { length: 20 }).default('none'),  // 'telnyx' | 'hlrlookup' | 'none'
  hlrApiKey:     varchar("hlr_api_key",     { length: 255 }),
  hlrApiSecret:  varchar("hlr_api_secret",  { length: 255 }),
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
export type Role = 'super_admin' | 'admin' | 'noc_operator' | 'team_lead' | 'management' | 'viewer';

// Approval Workflow RBAC policy (configurable — policy may be updated over time)
export const APPROVAL_POLICY: Record<Role, { canSubmit: boolean; approveScope: 'all' | 'team' | 'none'; selfApproval: boolean }> = {
  super_admin:  { canSubmit: true,  approveScope: 'all',  selfApproval: true  },
  admin:        { canSubmit: true,  approveScope: 'all',  selfApproval: false },
  noc_operator: { canSubmit: true,  approveScope: 'none', selfApproval: false },
  team_lead:    { canSubmit: false, approveScope: 'team', selfApproval: false },
  management:   { canSubmit: true,  approveScope: 'none', selfApproval: false },
  viewer:       { canSubmit: false, approveScope: 'none', selfApproval: false },
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
  id:          serial("id").primaryKey(),
  email:       varchar("email",        { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  userId:      varchar("user_id",      { length: 255 }),  // optional link to a system user
  active:      boolean("active").default(true).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
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

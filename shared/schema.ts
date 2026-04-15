
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
  apiAdminPassword: varchar("api_admin_password", { length: 255 }),
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
  connection:      varchar("connection",        { length: 32 }),
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

// ── KAM (Key Account Manager) Management ─────────────────────────────────────
export const kams = pgTable("kams", {
  id:        serial("id").primaryKey(),
  name:      varchar("name",  { length: 128 }).notNull(),
  email:     varchar("email", { length: 255 }).notNull(),
  phone:     varchar("phone", { length: 32 }),
  title:     varchar("title", { length: 128 }),
  active:    boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
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

// Monitoring Items — canonical list shared between frontend and backend
export const MONITORING_ITEMS = [
  { id: 'live_summary',      label: 'Live Calls – Summary',     group: 'Live Calls'  },
  { id: 'live_details',      label: 'Live Calls – Details',     group: 'Live Calls'  },
  { id: 'live_quality',      label: 'Live Calls – Quality',     group: 'Live Calls'  },
  { id: 'call_history',      label: 'Call History',             group: 'Live Calls'  },
  { id: 'balance_monitor',   label: 'Balance Monitor',          group: 'Finance'     },
  { id: 'alerts',            label: 'Alerts',                   group: 'Operations'  },
  { id: 'fraud_fas',         label: 'FAS / Fraud Detection',    group: 'Security'    },
  { id: 'traffic_map',       label: 'Traffic Map',              group: 'Operations'  },
  { id: 'graphs',            label: 'Graphs',                   group: 'Analytics'   },
  { id: 'bitseye',           label: 'BitsEye Live Graphs',      group: 'Analytics'   },
  { id: 'server_monitoring', label: 'Server Monitoring',        group: 'Operations'  },
  { id: 'cdr_viewer',        label: 'CDR Viewer',               group: 'Reports'     },
  { id: 'reports',           label: 'ASR / ACD Reports',        group: 'Reports'     },
  { id: 'route_quality',     label: 'Route Quality Analysis',   group: 'Reports'     },
  { id: 'did_management',    label: 'DID Management',           group: 'Operations'  },
] as const;

export type MonitoringItemId = typeof MONITORING_ITEMS[number]['id'];

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
  role: varchar("role", { length: 20 }).default('viewer').notNull(), // admin | management | viewer
  assignedAt: timestamp("assigned_at").defaultNow(),
  assignedBy: varchar("assigned_by"), // userId of admin who assigned (null = auto)
});

export type UserRole = typeof userRoles.$inferSelect;
export type InsertUserRole = typeof userRoles.$inferInsert;
export type Role = 'admin' | 'management' | 'viewer';

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
  id:            serial("id").primaryKey(),
  vendorName:    varchar("vendor_name",  { length: 128 }).notNull(),
  name:          varchar("name",         { length: 128 }).notNull(),
  cardType:      varchar("card_type",    { length: 10  }).default('vendor').notNull(), // 'client' | 'vendor'
  currency:      varchar("currency",     { length: 8   }).default('USD'),
  effectiveDate: timestamp("effective_date"),
  entryCount:    integer("entry_count").default(0),
  createdAt:     timestamp("created_at").defaultNow(),
});
export type RateCard = typeof rateCards.$inferSelect;
export type InsertRateCard = typeof rateCards.$inferInsert;
export const insertRateCardSchema = createInsertSchema(rateCards).omit({ id: true, createdAt: true, entryCount: true });

// ── Rate Card Entries: individual prefix → rate mappings ─────────────────────
export const rateCardEntries = pgTable("rate_card_entries", {
  id:          serial("id").primaryKey(),
  rateCardId:  integer("rate_card_id").notNull(),
  prefix:      varchar("prefix",   { length: 20  }).notNull(),
  country:     varchar("country",  { length: 255 }),
  breakout:    varchar("breakout", { length: 255 }),
  ratePerMin:  real("rate_per_min").notNull(),
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
  updatedAt:     timestamp("updated_at").defaultNow(),
});

export type DashboardWidgetPrefs = typeof dashboardWidgetPrefs.$inferSelect;

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
  cliFilter?: string;     // substring match on caller
  cldFilter?: string;     // substring match on callee
  startTime?: string;     // ISO date string
  endTime?: string;       // ISO date string
  highlightAsrBelow?: number;
  groupBy?: 'caller' | 'callee';
  sortBy?: 'totalCalls' | 'asr' | 'billableCalls' | 'revenueUsd';
  hideEmpty?: boolean;
};


import { pgTable, text, serial, integer, boolean, timestamp, real, varchar, pgEnum, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  failReason: varchar("fail_reason", { length: 30 }), // wrong_number | switched_off | untraceable
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

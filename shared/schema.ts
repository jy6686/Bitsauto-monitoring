
import { pgTable, text, serial, integer, boolean, timestamp, real, varchar } from "drizzle-orm/pg-core";
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
  simulationEnabled: boolean("simulation_enabled").default(true),
  monitoredIp: varchar("monitored_ip", { length: 45 }).default('45.59.163.182'), // IP to probe for live calls
});

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
};

export type CallWithLatestMetric = Call & {
  latestMetric?: Metric;
};

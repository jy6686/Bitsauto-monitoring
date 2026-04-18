
import { 
  calls, metrics, alerts, settings, userRoles, clientProfiles, userConfig,
  switches, fasEvents, callSnapshots, monitoringAssignments, outageLog, alertRules,
  monitoredHosts, hostOutageLog, kams, kamAccounts, trafficAlerts, sippySnapshots,
  watcherRecipients, irsfEvents, blacklistRules, rateCards, rateCardEntries, mosHourly,
  apiKeys, dashboardWidgetPrefs, callTestLogs, whatsappAlertLog,
  type Call, type InsertCall, type InsertMetric, 
  type Alert, type InsertAlert, type Settings, type InsertSettings,
  type UpdateSettingsRequest, type DashboardStats, type CallWithLatestMetric,
  type AsrAcdReportRow, type AsrAcdReportFilters,
  type Role, type ClientProfile, type InsertClientProfile,
  type UserConfig, type InsertUserConfig,
  type Switch, type InsertSwitch,
  type FasEvent, type InsertFasEvent,
  type CallSnapshot, type InsertCallSnapshot,
  type OutageEntry, type InsertOutageEntry,
  type AlertRule, type InsertAlertRule,
  type MonitoredHost, type InsertMonitoredHost,
  type HostOutageEntry, type InsertHostOutageEntry,
  type Kam, type InsertKam,
  type KamAccount, type InsertKamAccount,
  type TrafficAlert, type InsertTrafficAlert,
  type WatcherRecipient, type InsertWatcherRecipient,
  type IrsfEvent, type InsertIrsfEvent,
  type BlacklistRule, type InsertBlacklistRule,
  type RateCard, type InsertRateCard,
  type RateCardEntry, type InsertRateCardEntry,
  type MosHourly,
  type ApiKey,
  type DashboardWidgetPrefs,
  type CallTestLog, type InsertCallTestLog,
  type WhatsappAlertLog,
  fixHistory,
  type FixHistory, type InsertFixHistory,
} from "@shared/schema";
import { users, type User } from "@shared/models/auth";
import { db } from "./db";
import { eq, desc, and, sql, gte, lt } from "drizzle-orm";

export interface IStorage {
  // Calls
  getCalls(limit?: number): Promise<CallWithLatestMetric[]>;
  getCall(id: number): Promise<Call | undefined>;
  createCall(call: InsertCall): Promise<Call>;
  endCall(id: number, status?: 'completed' | 'failed', failReason?: string): Promise<void>;
  
  // Metrics
  getMetricsForCall(callId: number): Promise<Metric[]>; // Returns last 50 metrics
  createMetric(metric: InsertMetric): Promise<Metric>;
  
  // Alerts
  getAlerts(): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  
  // Settings
  getSettings(): Promise<Settings>;
  getSippySettings(): Promise<Settings>;   // alias of getSettings(); used by Sippy routes
  updateSettings(settings: UpdateSettingsRequest): Promise<Settings>;
  
  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;

  // Reports
  getAsrAcdReport(filters: AsrAcdReportFilters): Promise<AsrAcdReportRow[]>;

  // Team / Roles
  getUserRole(userId: string): Promise<Role | null>;
  setUserRole(userId: string, role: Role, assignedBy?: string): Promise<void>;
  getAllUsersWithRoles(): Promise<Array<User & { role: Role }>>;
  countRoleEntries(): Promise<number>;

  // Client & Vendor Profiles
  getClientProfiles(): Promise<ClientProfile[]>;
  createClientProfile(profile: InsertClientProfile): Promise<ClientProfile>;
  updateClientProfile(id: number, profile: Partial<InsertClientProfile>): Promise<ClientProfile>;
  deleteClientProfile(id: number): Promise<void>;

  // Switches
  getSwitches(): Promise<Switch[]>;
  createSwitch(sw: InsertSwitch): Promise<Switch>;
  updateSwitch(id: number, updates: Partial<InsertSwitch>): Promise<Switch>;
  deleteSwitch(id: number): Promise<void>;

  // User Configuration
  getUserConfig(userId: string): Promise<UserConfig | null>;
  upsertUserConfig(userId: string, config: Partial<InsertUserConfig>): Promise<UserConfig>;

  // FAS Events
  getFasEvents(limit?: number): Promise<FasEvent[]>;
  createFasEvent(event: InsertFasEvent): Promise<FasEvent>;
  markFasAlertSent(id: number): Promise<void>;
  backfillFasEventVendors(vendorName: string): Promise<number>;

  // Call Snapshots (24-hour live call history)
  upsertCallSnapshot(snapshot: InsertCallSnapshot): Promise<void>;
  getCallHistory(hoursBack?: number): Promise<CallSnapshot[]>;
  cleanupOldSnapshots(): Promise<void>;

  // Monitoring Assignments
  getAllMonitoringAssignments(): Promise<Record<string, string[]>>;
  setMonitoringAssignments(userId: string, items: string[], assignedBy?: string): Promise<void>;

  // Monitored Hosts (multi-IP monitoring)
  getMonitoredHosts(): Promise<MonitoredHost[]>;
  createMonitoredHost(host: InsertMonitoredHost): Promise<MonitoredHost>;
  updateMonitoredHost(id: number, updates: Partial<InsertMonitoredHost>): Promise<MonitoredHost>;
  deleteMonitoredHost(id: number): Promise<void>;

  // Host Outage Log
  getHostOutageLog(hostId?: number, limit?: number): Promise<HostOutageEntry[]>;
  createHostOutageEntry(entry: InsertHostOutageEntry): Promise<HostOutageEntry>;
  updateHostOutageEntry(id: number, updates: Partial<HostOutageEntry>): Promise<void>;

  // KAM Management
  getKams(): Promise<Kam[]>;
  getKam(id: number): Promise<Kam | undefined>;
  createKam(kam: InsertKam): Promise<Kam>;
  updateKam(id: number, updates: Partial<InsertKam>): Promise<Kam>;
  deleteKam(id: number): Promise<void>;

  // KAM Account Assignments
  getKamAccounts(kamId?: number): Promise<KamAccount[]>;
  createKamAccount(ka: InsertKamAccount): Promise<KamAccount>;
  deleteKamAccount(id: number): Promise<void>;

  // Traffic Alerts
  getTrafficAlerts(limit?: number): Promise<TrafficAlert[]>;
  createTrafficAlert(alert: InsertTrafficAlert): Promise<TrafficAlert>;
  updateTrafficAlert(id: number, updates: Partial<TrafficAlert>): Promise<void>;
  getOpenTrafficAlert(clientName: string): Promise<TrafficAlert | undefined>;

  // Sippy Snapshots (key-value store for change detection)
  getSippySnapshot(key: string): Promise<any | null>;
  setSippySnapshot(key: string, data: any): Promise<void>;

  // Watcher Recipients
  getWatcherRecipients(): Promise<WatcherRecipient[]>;
  addWatcherRecipient(data: InsertWatcherRecipient): Promise<WatcherRecipient>;
  updateWatcherRecipient(id: number, data: Partial<InsertWatcherRecipient>): Promise<WatcherRecipient | undefined>;
  deleteWatcherRecipient(id: number): Promise<void>;

  // IRSF Events
  getIrsfEvents(limit?: number): Promise<IrsfEvent[]>;
  createIrsfEvent(event: InsertIrsfEvent): Promise<IrsfEvent>;

  // Blacklist Rules
  getBlacklistRules(): Promise<BlacklistRule[]>;
  createBlacklistRule(rule: InsertBlacklistRule): Promise<BlacklistRule>;
  updateBlacklistRule(id: number, updates: Partial<InsertBlacklistRule>): Promise<BlacklistRule | undefined>;
  deleteBlacklistRule(id: number): Promise<void>;
  incrementBlacklistHit(id: number): Promise<void>;

  // Rate Cards
  getRateCards(): Promise<RateCard[]>;
  createRateCard(card: InsertRateCard): Promise<RateCard>;
  deleteRateCard(id: number): Promise<void>;
  getRateCardEntries(rateCardId: number): Promise<RateCardEntry[]>;
  bulkInsertRateCardEntries(entries: InsertRateCardEntry[]): Promise<number>;
  updateRateCardEntryCount(rateCardId: number, count: number): Promise<void>;
  lookupRateForPrefix(rateCardId: number, callee: string): Promise<RateCardEntry | null>;
  lcrAnalyse(number: string, clientRateCardId?: number): Promise<{
    vendorResults: { card: RateCard; entry: RateCardEntry }[];
    clientEntry: RateCardEntry | null;
  }>;

  // MOS Hourly Snapshots
  getMosHourly(hoursBack?: number, vendor?: string): Promise<MosHourly[]>;
  upsertMosHourly(hour: Date, vendor: string | null, avgMos: number, minMos: number, maxMos: number, callCount: number): Promise<void>;

  // API Keys (Tier 5 — #24)
  getApiKeys(userId: string): Promise<ApiKey[]>;
  createApiKey(data: { userId: string; name: string; keyHash: string; keyPrefix: string; permissions: string[] }): Promise<ApiKey>;
  revokeApiKey(id: number, userId: string): Promise<void>;
  validateApiKey(keyHash: string): Promise<ApiKey | null>;
  touchApiKey(id: number): Promise<void>;

  // Dashboard Widget Prefs (Tier 5 — #20)
  getDashboardWidgetPrefs(userId: string): Promise<DashboardWidgetPrefs | null>;
  setDashboardWidgetPrefs(userId: string, hiddenWidgets: string[], widgetOrder?: string[]): Promise<DashboardWidgetPrefs>;

  // Call Test Logs (Vol 2 — #16)
  logTestCall(data: InsertCallTestLog): Promise<CallTestLog>;
  getTestCallLogs(userId: string, limit?: number): Promise<CallTestLog[]>;

  // WhatsApp Alert Log
  logWhatsappAlert(data: { alertType: string; recipient: string; message: string; status: string; errorMsg?: string | null }): Promise<void>;
  getWhatsappAlertLogs(limit?: number): Promise<WhatsappAlertLog[]>;

  // Fix History — Phase 3
  addFixHistoryEntry(entry: InsertFixHistory): Promise<FixHistory>;
  getFixHistory(limit?: number): Promise<FixHistory[]>;
  findSimilarFix(issueType: string, component: string): Promise<FixHistory | null>;
}

export class DatabaseStorage implements IStorage {
  async getCalls(limit: number = 20): Promise<CallWithLatestMetric[]> {
    const activeCalls = await db.select().from(calls)
      .orderBy(desc(calls.startTime))
      .limit(limit);
      
    // Fetch latest metric for each call to display real-time status
    const callsWithMetrics = await Promise.all(activeCalls.map(async (call) => {
      const [latestMetric] = await db.select().from(metrics)
        .where(eq(metrics.callId, call.id))
        .orderBy(desc(metrics.timestamp))
        .limit(1);
      return { ...call, latestMetric };
    }));
    
    return callsWithMetrics;
  }

  async getCall(id: number): Promise<Call | undefined> {
    const [call] = await db.select().from(calls).where(eq(calls.id, id));
    return call;
  }

  async createCall(call: InsertCall): Promise<Call> {
    const [newCall] = await db.insert(calls).values(call).returning();
    return newCall;
  }

  async endCall(id: number, status: 'completed' | 'failed' = 'completed', failReason?: string): Promise<void> {
    await db.update(calls)
      .set({ status, endTime: new Date(), ...(failReason ? { failReason } : {}) })
      .where(eq(calls.id, id));
  }

  async getMetricsForCall(callId: number): Promise<Metric[]> {
    return await db.select().from(metrics)
      .where(eq(metrics.callId, callId))
      .orderBy(desc(metrics.timestamp)) // Latest first
      .limit(50); // Limit to last 50 points for graph
  }

  async createMetric(metric: InsertMetric): Promise<Metric> {
    const [newMetric] = await db.insert(metrics).values(metric).returning();
    return newMetric;
  }

  async getAlerts(): Promise<Alert[]> {
    return await db.select().from(alerts)
      .orderBy(desc(alerts.createdAt))
      .limit(20);
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    const [newAlert] = await db.insert(alerts).values(alert).returning();
    return newAlert;
  }

  async getSettings(): Promise<Settings> {
    const [existingSettings] = await db.select().from(settings).limit(1);

    // Known Sippy credentials — always seeded so the app works out of the box
    const SIPPY_DEFAULTS = {
      switchType:       'sippy'               as const,
      portalUrl:        'https://191.101.30.107',
      portalUsername:   'RTST1',
      portalPassword:   'abcd@1234',
      apiAdminUsername: 'ssp-root',
      apiAdminPassword: '!chiaan1',
    };

    if (existingSettings) {
      // Patch any missing credential fields without overwriting user changes
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(SIPPY_DEFAULTS)) {
        if (!existingSettings[k as keyof typeof existingSettings]) patch[k] = v;
      }
      if (Object.keys(patch).length > 0) {
        const [patched] = await db.update(settings)
          .set(patch)
          .where(eq(settings.id, existingSettings.id))
          .returning();
        return patched;
      }
      return existingSettings;
    }

    // Create default settings with Sippy credentials pre-seeded
    const [newSettings] = await db.insert(settings).values(SIPPY_DEFAULTS).returning();
    return newSettings;
  }

  /** Alias of getSettings() — used by all Sippy XML-RPC routes. */
  async getSippySettings(): Promise<Settings> {
    return this.getSettings();
  }

  async updateSettings(updates: UpdateSettingsRequest): Promise<Settings> {
    const currentSettings = await this.getSettings();
    const [updated] = await db.update(settings)
      .set(updates)
      .where(eq(settings.id, currentSettings.id))
      .returning();
    return updated;
  }

  async getDashboardStats(): Promise<DashboardStats> {
    // 1. Count active calls
    const [activeCallsCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(calls)
      .where(eq(calls.status, 'active'));
      
    // 2. Calculate Avg MOS from latest metrics
    const latestMetrics = await db
      .select({ mos: metrics.mos })
      .from(metrics)
      .orderBy(desc(metrics.timestamp))
      .limit(100);
      
    const totalMos = latestMetrics.reduce((sum, m) => sum + m.mos, 0);
    const avgMos = latestMetrics.length > 0 ? totalMos / latestMetrics.length : 4.5;
      
    // 3. Count alerts created today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const [alertsCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(alerts)
      .where(sql`${alerts.createdAt} >= ${startOfDay}`);
      
    // 4. Determine System Health
    const alertsNum = Number(alertsCount?.count || 0);
    let systemHealth: 'Healthy' | 'Degraded' | 'Critical' = 'Healthy';
    if (alertsNum > 50) systemHealth = 'Critical';
    else if (alertsNum > 10) systemHealth = 'Degraded';

    // 5. ASR (Answer-Seizure Ratio): completed / (completed + failed) * 100
    //    Standard telecom definition: answered seizures / total seizures
    //    Use a rolling 30-minute window so new failures surface immediately
    const windowStart = new Date(Date.now() - 30 * 60 * 1000);
    const recentFinishedCalls = await db
      .select({ status: calls.status, startTime: calls.startTime, endTime: calls.endTime, pdd: calls.pdd })
      .from(calls)
      .where(sql`${calls.status} IN ('completed', 'failed') AND ${calls.startTime} >= ${windowStart}`)
      .orderBy(desc(calls.startTime))
      .limit(500);

    const completedCalls = recentFinishedCalls.filter(c => c.status === 'completed');
    const totalAttempted = recentFinishedCalls.length;
    const asr = totalAttempted > 0
      ? Math.round((completedCalls.length / totalAttempted) * 100 * 10) / 10
      : 100;

    // 6. ACD (Average Call Duration) in seconds for completed calls
    const durationsSeconds = completedCalls
      .filter(c => c.startTime && c.endTime)
      .map(c => (new Date(c.endTime!).getTime() - new Date(c.startTime!).getTime()) / 1000);
    const acd = durationsSeconds.length > 0
      ? Math.round(durationsSeconds.reduce((s, d) => s + d, 0) / durationsSeconds.length)
      : 0;

    // 7. PDD (Post-Dial Delay) average in seconds from all calls with pdd recorded
    const pddValues = recentFinishedCalls
      .concat(
        (await db.select({ status: calls.status, startTime: calls.startTime, endTime: calls.endTime, pdd: calls.pdd })
          .from(calls).where(eq(calls.status, 'active')).limit(50))
      )
      .filter(c => c.pdd !== null && c.pdd !== undefined)
      .map(c => c.pdd as number);
    const pdd = pddValues.length > 0
      ? Math.round((pddValues.reduce((s, v) => s + v, 0) / pddValues.length) * 100) / 100
      : 0;

    // 8. CK Ratio — Connection Rate: confirmed connected / total attempted (today's window)
    //    Connected = completed (answered by user)
    //    Failed = wrong_number | switched_off | untraceable
    const todayAllCalls = await db
      .select({ status: calls.status, failReason: calls.failReason })
      .from(calls)
      .where(sql`${calls.startTime} >= ${startOfDay}`)
      .limit(5000);

    const ckConnected = todayAllCalls.filter(c => c.status === 'completed').length;
    const ckWrongNumber = todayAllCalls.filter(c => c.failReason === 'wrong_number').length;
    const ckSwitchedOff = todayAllCalls.filter(c => c.failReason === 'switched_off').length;
    const ckUntraceable = todayAllCalls.filter(c => c.failReason === 'untraceable').length;
    const ckTotal = todayAllCalls.length; // includes active calls as "attempts"
    const ckRatio = ckTotal > 0
      ? Math.round((ckConnected / ckTotal) * 100 * 10) / 10
      : 0;

    return {
      activeCalls: Number(activeCallsCount?.count || 0),
      avgMos: Number(avgMos || 4.5),
      alertsToday: alertsNum,
      systemHealth,
      asr,
      acd,
      pdd,
      ckRatio,
      ckBreakdown: {
        connected: ckConnected,
        wrongNumber: ckWrongNumber,
        switchedOff: ckSwitchedOff,
        untraceable: ckUntraceable,
        total: ckTotal,
      },
    };
  }

  async getAsrAcdReport(filters: AsrAcdReportFilters): Promise<AsrAcdReportRow[]> {
    const {
      cliFilter,
      cldFilter,
      startTime,
      endTime,
      groupBy = 'caller',
      sortBy = 'totalCalls',
      hideEmpty = true,
    } = filters;

    const RATE_PER_MIN = 0.025;
    const groupColName = groupBy === 'callee' ? 'callee' : 'caller';

    const orderMap: Record<string, string> = {
      totalCalls: 'total_calls DESC',
      asr: 'asr DESC',
      billableCalls: 'billable_calls DESC',
      revenueUsd: 'revenue_usd DESC',
    };
    const orderClause = orderMap[sortBy] || 'total_calls DESC';

    // Build parameterized WHERE conditions using sql template tag
    const condParts: ReturnType<typeof sql>[] = [
      sql`status IN ('completed', 'failed')`,
    ];
    if (startTime) condParts.push(sql`start_time >= ${new Date(startTime)}`);
    if (endTime)   condParts.push(sql`start_time <= ${new Date(endTime)}`);
    if (cliFilter) condParts.push(sql`caller ILIKE ${'%' + cliFilter + '%'}`);
    if (cldFilter) condParts.push(sql`callee ILIKE ${'%' + cldFilter + '%'}`);

    const whereClause = sql`WHERE ${sql.join(condParts, sql` AND `)}`;
    const havingClause = hideEmpty ? sql`HAVING COUNT(*) > 0` : sql``;

    const rows = await db.execute(sql`
      SELECT
        ${sql.raw(groupColName)} AS caller,
        COUNT(*) AS total_calls,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) AS billable_calls,
        COALESCE(SUM(CASE WHEN status = 'completed' AND end_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (end_time - start_time)) ELSE 0 END), 0) AS billed_duration_seconds,
        COALESCE(AVG(CASE WHEN status = 'completed' AND end_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (end_time - start_time)) END), 0) AS acd_seconds,
        ROUND(
          (COUNT(CASE WHEN status = 'completed' THEN 1 END)::numeric /
           NULLIF(COUNT(*), 0) * 100), 4
        ) AS asr,
        COALESCE(AVG(pdd), 0) AS avg_pdd,
        ROUND(
          (COALESCE(SUM(CASE WHEN status = 'completed' AND end_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (end_time - start_time)) ELSE 0 END), 0) / 60.0 * ${RATE_PER_MIN})::numeric, 7
        ) AS revenue_usd
      FROM calls
      ${whereClause}
      GROUP BY ${sql.raw(groupColName)}
      ${havingClause}
      ORDER BY ${sql.raw(orderClause)}
      LIMIT 200
    `);

    return (rows.rows as any[]).map(r => ({
      caller: r.caller ?? '',
      totalCalls: Number(r.total_calls),
      billableCalls: Number(r.billable_calls),
      billedDurationSeconds: Number(r.billed_duration_seconds),
      acdSeconds: Number(r.acd_seconds),
      asr: Number(r.asr),
      avgPdd: Number(r.avg_pdd),
      revenueUsd: Number(r.revenue_usd),
    }));
  }

  // ── Team / Roles ──────────────────────────────────────────────────────────

  async getUserRole(userId: string): Promise<Role | null> {
    const [row] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    return (row?.role as Role) ?? null;
  }

  async setUserRole(userId: string, role: Role, assignedBy?: string): Promise<void> {
    await db.insert(userRoles)
      .values({ userId, role, assignedBy })
      .onConflictDoUpdate({ target: userRoles.userId, set: { role, assignedBy, assignedAt: new Date() } });
  }

  async countRoleEntries(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(userRoles);
    return Number(row?.count ?? 0);
  }

  async getAllUsersWithRoles(): Promise<Array<User & { role: Role }>> {
    const allUsers = await db.select().from(users);
    const allRoles = await db.select().from(userRoles);
    const roleMap = new Map(allRoles.map(r => [r.userId, r.role as Role]));
    return allUsers.map(u => ({ ...u, role: roleMap.get(u.id) ?? 'viewer' as Role }));
  }

  // ── Client & Vendor Profiles ───────────────────────────────────────────────

  async getClientProfiles(): Promise<ClientProfile[]> {
    return await db.select().from(clientProfiles).orderBy(clientProfiles.type, clientProfiles.name);
  }

  async createClientProfile(profile: InsertClientProfile): Promise<ClientProfile> {
    const [created] = await db.insert(clientProfiles).values(profile).returning();
    return created;
  }

  async updateClientProfile(id: number, updates: Partial<InsertClientProfile>): Promise<ClientProfile> {
    const [updated] = await db.update(clientProfiles).set(updates).where(eq(clientProfiles.id, id)).returning();
    return updated;
  }

  async deleteClientProfile(id: number): Promise<void> {
    await db.delete(clientProfiles).where(eq(clientProfiles.id, id));
  }

  // ── Switches ───────────────────────────────────────────────────────────────

  async getSwitches(): Promise<Switch[]> {
    return db.select().from(switches).orderBy(switches.createdAt);
  }

  async createSwitch(sw: InsertSwitch): Promise<Switch> {
    const [created] = await db.insert(switches).values(sw).returning();
    return created;
  }

  async updateSwitch(id: number, updates: Partial<InsertSwitch>): Promise<Switch> {
    const [updated] = await db.update(switches).set(updates).where(eq(switches.id, id)).returning();
    return updated;
  }

  async deleteSwitch(id: number): Promise<void> {
    await db.delete(switches).where(eq(switches.id, id));
  }

  // ── User Configuration ─────────────────────────────────────────────────────

  async getUserConfig(userId: string): Promise<UserConfig | null> {
    const [row] = await db.select().from(userConfig).where(eq(userConfig.userId, userId));
    return row ?? null;
  }

  async upsertUserConfig(userId: string, config: Partial<InsertUserConfig>): Promise<UserConfig> {
    const [row] = await db
      .insert(userConfig)
      .values({ ...config, userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userConfig.userId,
        set: { ...config, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  // ── FAS Events ─────────────────────────────────────────────────────────────

  async getFasEvents(limit: number = 100): Promise<FasEvent[]> {
    return db.select().from(fasEvents).orderBy(desc(fasEvents.detectedAt)).limit(limit);
  }

  async createFasEvent(event: InsertFasEvent): Promise<FasEvent> {
    const [row] = await db.insert(fasEvents).values(event).returning();
    return row;
  }

  async markFasAlertSent(id: number): Promise<void> {
    await db.update(fasEvents).set({ alertSent: true }).where(eq(fasEvents.id, id));
  }

  async backfillFasEventVendors(vendorName: string): Promise<number> {
    const rows = await db.update(fasEvents)
      .set({ vendor: vendorName })
      .where(sql`(vendor IS NULL OR vendor = '')`)
      .returning({ id: fasEvents.id });
    return rows.length;
  }

  // ── Call Snapshots ─────────────────────────────────────────────────────────

  async upsertCallSnapshot(snapshot: InsertCallSnapshot): Promise<void> {
    await db.insert(callSnapshots)
      .values(snapshot)
      .onConflictDoUpdate({
        target: callSnapshots.sippyCallId,
        set: {
          ccState:         snapshot.ccState,
          maxDurationSecs: sql`GREATEST(call_snapshots.max_duration_secs, EXCLUDED.max_duration_secs)`,
          lastSeen:        snapshot.lastSeen ?? new Date(),
          mediaIpCaller:   snapshot.mediaIpCaller,
          mediaIpCallee:   snapshot.mediaIpCallee,
          codec:           snapshot.codec,
          vendor:          snapshot.vendor,
          clientName:      snapshot.clientName,
        },
      });
  }

  async getCallHistory(hoursBack: number = 24): Promise<CallSnapshot[]> {
    const since = new Date(Date.now() - hoursBack * 3600 * 1000);
    return db.select().from(callSnapshots)
      .where(gte(callSnapshots.firstSeen, since))
      .orderBy(desc(callSnapshots.lastSeen));
  }

  async cleanupOldSnapshots(): Promise<void> {
    const cutoff = new Date(Date.now() - 25 * 3600 * 1000); // 25h buffer
    await db.delete(callSnapshots).where(lt(callSnapshots.lastSeen, cutoff));
  }

  async getAllMonitoringAssignments(): Promise<Record<string, string[]>> {
    const rows = await db.select().from(monitoringAssignments);
    const result: Record<string, string[]> = {};
    for (const row of rows) {
      result[row.userId] = row.items ?? [];
    }
    return result;
  }

  async setMonitoringAssignments(userId: string, items: string[], assignedBy?: string): Promise<void> {
    await db.insert(monitoringAssignments)
      .values({ userId, items, assignedBy: assignedBy ?? null, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: monitoringAssignments.userId,
        set: { items, assignedBy: assignedBy ?? null, updatedAt: new Date() },
      });
  }

  // ── Outage Log ───────────────────────────────────────────────────────────────
  async getOutageLog(limit = 50): Promise<OutageEntry[]> {
    return db.select().from(outageLog).orderBy(desc(outageLog.downAt)).limit(limit);
  }

  async getLatestOutageEntry(): Promise<OutageEntry | null> {
    const rows = await db.select().from(outageLog).orderBy(desc(outageLog.downAt)).limit(1);
    return rows[0] ?? null;
  }

  async createOutageEntry(entry: InsertOutageEntry): Promise<OutageEntry> {
    const rows = await db.insert(outageLog).values(entry).returning();
    return rows[0];
  }

  async updateOutageEntry(id: number, updates: Partial<OutageEntry>): Promise<void> {
    await db.update(outageLog).set(updates).where(eq(outageLog.id, id));
  }

  // ── Alert Rules ──────────────────────────────────────────────────────────────
  async getAlertRules(): Promise<AlertRule[]> {
    return db.select().from(alertRules).orderBy(desc(alertRules.createdAt));
  }

  async createAlertRule(rule: InsertAlertRule): Promise<AlertRule> {
    const rows = await db.insert(alertRules).values(rule).returning();
    return rows[0];
  }

  async updateAlertRule(id: number, updates: Partial<AlertRule>): Promise<void> {
    await db.update(alertRules).set(updates).where(eq(alertRules.id, id));
  }

  async deleteAlertRule(id: number): Promise<void> {
    await db.delete(alertRules).where(eq(alertRules.id, id));
  }

  // ── Monitored Hosts ──────────────────────────────────────────────────────────
  async getMonitoredHosts(): Promise<MonitoredHost[]> {
    return db.select().from(monitoredHosts).orderBy(monitoredHosts.createdAt);
  }

  async createMonitoredHost(host: InsertMonitoredHost): Promise<MonitoredHost> {
    const [row] = await db.insert(monitoredHosts).values(host).returning();
    return row;
  }

  async updateMonitoredHost(id: number, updates: Partial<InsertMonitoredHost>): Promise<MonitoredHost> {
    const [row] = await db.update(monitoredHosts).set(updates).where(eq(monitoredHosts.id, id)).returning();
    return row;
  }

  async deleteMonitoredHost(id: number): Promise<void> {
    await db.delete(monitoredHosts).where(eq(monitoredHosts.id, id));
    await db.delete(hostOutageLog).where(eq(hostOutageLog.hostId, id));
  }

  // ── Host Outage Log ──────────────────────────────────────────────────────────
  async getHostOutageLog(hostId?: number, limit = 50): Promise<HostOutageEntry[]> {
    if (hostId !== undefined) {
      return db.select().from(hostOutageLog)
        .where(eq(hostOutageLog.hostId, hostId))
        .orderBy(desc(hostOutageLog.downAt))
        .limit(limit);
    }
    return db.select().from(hostOutageLog).orderBy(desc(hostOutageLog.downAt)).limit(limit);
  }

  async createHostOutageEntry(entry: InsertHostOutageEntry): Promise<HostOutageEntry> {
    const [row] = await db.insert(hostOutageLog).values(entry).returning();
    return row;
  }

  async updateHostOutageEntry(id: number, updates: Partial<HostOutageEntry>): Promise<void> {
    await db.update(hostOutageLog).set(updates).where(eq(hostOutageLog.id, id));
  }

  // ── KAM Management ───────────────────────────────────────────────────────────
  async getKams(): Promise<Kam[]> {
    return db.select().from(kams).orderBy(kams.name);
  }

  async getKam(id: number): Promise<Kam | undefined> {
    const [row] = await db.select().from(kams).where(eq(kams.id, id));
    return row;
  }

  async createKam(kam: InsertKam): Promise<Kam> {
    const [row] = await db.insert(kams).values(kam).returning();
    return row;
  }

  async updateKam(id: number, updates: Partial<InsertKam>): Promise<Kam> {
    const [row] = await db.update(kams).set(updates).where(eq(kams.id, id)).returning();
    return row;
  }

  async deleteKam(id: number): Promise<void> {
    await db.delete(kamAccounts).where(eq(kamAccounts.kamId, id));
    await db.delete(kams).where(eq(kams.id, id));
  }

  // ── KAM Account Assignments ───────────────────────────────────────────────────
  async getKamAccounts(kamId?: number): Promise<KamAccount[]> {
    if (kamId !== undefined) {
      return db.select().from(kamAccounts).where(eq(kamAccounts.kamId, kamId));
    }
    return db.select().from(kamAccounts);
  }

  async createKamAccount(ka: InsertKamAccount): Promise<KamAccount> {
    const [row] = await db.insert(kamAccounts).values(ka).returning();
    return row;
  }

  async deleteKamAccount(id: number): Promise<void> {
    await db.delete(kamAccounts).where(eq(kamAccounts.id, id));
  }

  // ── Traffic Alerts ────────────────────────────────────────────────────────────
  async getTrafficAlerts(limit = 50): Promise<TrafficAlert[]> {
    return db.select().from(trafficAlerts)
      .orderBy(desc(trafficAlerts.triggeredAt))
      .limit(limit);
  }

  async createTrafficAlert(alert: InsertTrafficAlert): Promise<TrafficAlert> {
    const [row] = await db.insert(trafficAlerts).values(alert).returning();
    return row;
  }

  async updateTrafficAlert(id: number, updates: Partial<TrafficAlert>): Promise<void> {
    await db.update(trafficAlerts).set(updates).where(eq(trafficAlerts.id, id));
  }

  async getOpenTrafficAlert(clientName: string): Promise<TrafficAlert | undefined> {
    const [row] = await db.select().from(trafficAlerts)
      .where(and(
        eq(trafficAlerts.clientName, clientName),
        sql`${trafficAlerts.resolvedAt} IS NULL`,
        sql`${trafficAlerts.alertType} != 'traffic_restored'`
      ))
      .orderBy(desc(trafficAlerts.triggeredAt))
      .limit(1);
    return row;
  }

  // ── Sippy Snapshots ──────────────────────────────────────────────────────────
  async getSippySnapshot(key: string): Promise<any | null> {
    const [row] = await db.select().from(sippySnapshots).where(eq(sippySnapshots.key, key));
    return row?.data ?? null;
  }

  async setSippySnapshot(key: string, data: any): Promise<void> {
    await db.insert(sippySnapshots).values({ key, data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: sippySnapshots.key, set: { data, updatedAt: new Date() } });
  }

  // ── Watcher Recipients ────────────────────────────────────────────────────────
  async getWatcherRecipients(): Promise<WatcherRecipient[]> {
    return db.select().from(watcherRecipients).orderBy(watcherRecipients.createdAt);
  }

  async addWatcherRecipient(data: InsertWatcherRecipient): Promise<WatcherRecipient> {
    const [row] = await db.insert(watcherRecipients).values(data).returning();
    return row;
  }

  async updateWatcherRecipient(id: number, data: Partial<InsertWatcherRecipient>): Promise<WatcherRecipient | undefined> {
    const [row] = await db.update(watcherRecipients).set(data).where(eq(watcherRecipients.id, id)).returning();
    return row;
  }

  async deleteWatcherRecipient(id: number): Promise<void> {
    await db.delete(watcherRecipients).where(eq(watcherRecipients.id, id));
  }

  // ── IRSF Events ──────────────────────────────────────────────────────────────
  async getIrsfEvents(limit = 200): Promise<IrsfEvent[]> {
    return db.select().from(irsfEvents).orderBy(desc(irsfEvents.detectedAt)).limit(limit);
  }

  async createIrsfEvent(event: InsertIrsfEvent): Promise<IrsfEvent> {
    const [row] = await db.insert(irsfEvents).values(event).returning();
    return row;
  }

  // ── Blacklist Rules ───────────────────────────────────────────────────────────
  async getBlacklistRules(): Promise<BlacklistRule[]> {
    return db.select().from(blacklistRules).orderBy(desc(blacklistRules.createdAt));
  }

  async createBlacklistRule(rule: InsertBlacklistRule): Promise<BlacklistRule> {
    const [row] = await db.insert(blacklistRules).values(rule).returning();
    return row;
  }

  async updateBlacklistRule(id: number, updates: Partial<InsertBlacklistRule>): Promise<BlacklistRule | undefined> {
    const [row] = await db.update(blacklistRules).set(updates).where(eq(blacklistRules.id, id)).returning();
    return row;
  }

  async deleteBlacklistRule(id: number): Promise<void> {
    await db.delete(blacklistRules).where(eq(blacklistRules.id, id));
  }

  async incrementBlacklistHit(id: number): Promise<void> {
    await db.update(blacklistRules)
      .set({ hitCount: sql`${blacklistRules.hitCount} + 1` })
      .where(eq(blacklistRules.id, id));
  }

  // ── Rate Cards ────────────────────────────────────────────────────────────────
  async getRateCards(): Promise<RateCard[]> {
    return db.select().from(rateCards).orderBy(desc(rateCards.createdAt));
  }

  async createRateCard(card: InsertRateCard): Promise<RateCard> {
    const [row] = await db.insert(rateCards).values(card).returning();
    return row;
  }

  async deleteRateCard(id: number): Promise<void> {
    await db.delete(rateCardEntries).where(eq(rateCardEntries.rateCardId, id));
    await db.delete(rateCards).where(eq(rateCards.id, id));
  }

  async getRateCardEntries(rateCardId: number): Promise<RateCardEntry[]> {
    return db.select().from(rateCardEntries)
      .where(eq(rateCardEntries.rateCardId, rateCardId))
      .orderBy(rateCardEntries.prefix)
      .limit(5000);
  }

  async bulkInsertRateCardEntries(entries: InsertRateCardEntry[]): Promise<number> {
    if (!entries.length) return 0;
    // Insert in batches of 500 to avoid parameter limits
    let inserted = 0;
    for (let i = 0; i < entries.length; i += 500) {
      const batch = entries.slice(i, i + 500);
      await db.insert(rateCardEntries).values(batch);
      inserted += batch.length;
    }
    return inserted;
  }

  async updateRateCardEntryCount(rateCardId: number, count: number): Promise<void> {
    await db.update(rateCards).set({ entryCount: count }).where(eq(rateCards.id, rateCardId));
  }

  async lookupRateForPrefix(rateCardId: number, callee: string): Promise<RateCardEntry | null> {
    const digits = callee.replace(/^\+/, '').replace(/\D/g, '');
    // Try progressively shorter prefixes from longest match down
    for (let len = Math.min(digits.length, 11); len >= 1; len--) {
      const prefix = digits.slice(0, len);
      const [row] = await db.select().from(rateCardEntries)
        .where(and(eq(rateCardEntries.rateCardId, rateCardId), eq(rateCardEntries.prefix, prefix)))
        .limit(1);
      if (row) return row;
    }
    return null;
  }

  async lcrAnalyse(number: string, clientRateCardId?: number): Promise<{
    vendorResults: { card: RateCard; entry: RateCardEntry }[];
    clientEntry: RateCardEntry | null;
  }> {
    const allCards = await this.getRateCards();
    const vendorCards = allCards.filter(c => c.cardType === 'vendor');

    const vendorResults: { card: RateCard; entry: RateCardEntry }[] = [];
    for (const card of vendorCards) {
      const entry = await this.lookupRateForPrefix(card.id, number);
      if (entry) vendorResults.push({ card, entry });
    }
    vendorResults.sort((a, b) => a.entry.ratePerMin - b.entry.ratePerMin);

    let clientEntry: RateCardEntry | null = null;
    if (clientRateCardId) {
      clientEntry = await this.lookupRateForPrefix(clientRateCardId, number);
    }

    return { vendorResults, clientEntry };
  }

  // ── MOS Hourly ────────────────────────────────────────────────────────────────
  async getMosHourly(hoursBack = 24, vendor?: string): Promise<MosHourly[]> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const conditions = [gte(mosHourly.hour, since)];
    if (vendor && vendor !== '__all__') conditions.push(eq(mosHourly.vendor, vendor));
    else if (!vendor || vendor === '__all__') conditions.push(sql`${mosHourly.vendor} IS NULL`);
    return db.select().from(mosHourly).where(and(...conditions)).orderBy(mosHourly.hour);
  }

  async upsertMosHourly(hour: Date, vendor: string | null, avgMos: number, minMos: number, maxMos: number, callCount: number): Promise<void> {
    await db.insert(mosHourly)
      .values({ hour, vendor, avgMos, minMos, maxMos, callCount })
      .onConflictDoNothing();
  }

  // ── API Keys ───────────────────────────────────────────────────────────────
  async getApiKeys(userId: string): Promise<ApiKey[]> {
    return db.select().from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));
  }

  async createApiKey(data: { userId: string; name: string; keyHash: string; keyPrefix: string; permissions: string[] }): Promise<ApiKey> {
    const [row] = await db.insert(apiKeys).values(data).returning();
    return row;
  }

  async revokeApiKey(id: number, userId: string): Promise<void> {
    await db.update(apiKeys)
      .set({ active: false })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
  }

  async validateApiKey(keyHash: string): Promise<ApiKey | null> {
    const [row] = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.active, true)));
    return row ?? null;
  }

  async touchApiKey(id: number): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  // ── Dashboard Widget Prefs ────────────────────────────────────────────────
  async getDashboardWidgetPrefs(userId: string): Promise<DashboardWidgetPrefs | null> {
    const [row] = await db.select().from(dashboardWidgetPrefs).where(eq(dashboardWidgetPrefs.userId, userId));
    return row ?? null;
  }

  async setDashboardWidgetPrefs(userId: string, hiddenWidgets: string[], widgetOrder: string[] = []): Promise<DashboardWidgetPrefs> {
    const [row] = await db.insert(dashboardWidgetPrefs)
      .values({ userId, hiddenWidgets, widgetOrder })
      .onConflictDoUpdate({ target: dashboardWidgetPrefs.userId, set: { hiddenWidgets, widgetOrder, updatedAt: new Date() } })
      .returning();
    return row;
  }

  // ── Call Test Logs (Vol 2 — #16) ─────────────────────────────────────────────
  async logTestCall(data: InsertCallTestLog): Promise<CallTestLog> {
    const [row] = await db.insert(callTestLogs).values(data).returning();
    return row;
  }

  async getTestCallLogs(userId: string, limit = 50): Promise<CallTestLog[]> {
    return db.select().from(callTestLogs)
      .where(eq(callTestLogs.userId, userId))
      .orderBy(desc(callTestLogs.createdAt))
      .limit(limit);
  }

  // ── WhatsApp Alert Log ────────────────────────────────────────────────────
  async logWhatsappAlert(data: { alertType: string; recipient: string; message: string; status: string; errorMsg?: string | null }): Promise<void> {
    await db.insert(whatsappAlertLog).values({
      alertType: data.alertType,
      recipient: data.recipient,
      message:   data.message,
      status:    data.status,
      errorMsg:  data.errorMsg ?? null,
    });
  }

  async getWhatsappAlertLogs(limit = 100): Promise<WhatsappAlertLog[]> {
    return db.select().from(whatsappAlertLog)
      .orderBy(desc(whatsappAlertLog.sentAt))
      .limit(limit);
  }

  // ── Fix History (Phase 3) ─────────────────────────────────────────────────
  async addFixHistoryEntry(entry: InsertFixHistory): Promise<FixHistory> {
    const [row] = await db.insert(fixHistory).values(entry).returning();
    return row;
  }

  async getFixHistory(limit = 100): Promise<FixHistory[]> {
    return db.select().from(fixHistory)
      .orderBy(desc(fixHistory.createdAt))
      .limit(limit);
  }

  async findSimilarFix(issueType: string, component: string): Promise<FixHistory | null> {
    const [row] = await db.select().from(fixHistory)
      .where(
        and(
          eq(fixHistory.issueType, issueType),
          eq(fixHistory.outcome, 'success')
        )
      )
      .orderBy(desc(fixHistory.createdAt))
      .limit(1);
    return row ?? null;
  }
}

export const storage = new DatabaseStorage();

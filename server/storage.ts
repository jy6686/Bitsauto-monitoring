
import { 
  calls, metrics, alerts, settings, userRoles, clientProfiles, userConfig,
  switches,
  type Call, type InsertCall, type InsertMetric, 
  type Alert, type InsertAlert, type Settings, type InsertSettings,
  type UpdateSettingsRequest, type DashboardStats, type CallWithLatestMetric,
  type AsrAcdReportRow, type AsrAcdReportFilters,
  type Role, type ClientProfile, type InsertClientProfile,
  type UserConfig, type InsertUserConfig,
  type Switch, type InsertSwitch,
} from "@shared/schema";
import { users, type User } from "@shared/models/auth";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

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
    if (existingSettings) return existingSettings;
    
    // Create default settings if none exist
    const [newSettings] = await db.insert(settings).values({}).returning();
    return newSettings;
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
}

export const storage = new DatabaseStorage();

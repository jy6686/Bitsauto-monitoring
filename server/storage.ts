
import { 
  calls, metrics, alerts, settings,
  type Call, type InsertCall, type InsertMetric, 
  type Alert, type InsertAlert, type Settings, type InsertSettings,
  type UpdateSettingsRequest, type DashboardStats, type CallWithLatestMetric 
} from "@shared/schema";
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
}

export const storage = new DatabaseStorage();

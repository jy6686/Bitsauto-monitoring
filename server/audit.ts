import { db } from "./db";
import { auditEvents } from "@shared/schema";
import { eq, desc, and, or, gte, lte, ilike, sql } from "drizzle-orm";

export type AuditCategory = 'user' | 'system' | 'sippy' | 'fraud' | 'financial';
export type AuditSeverity = 'info' | 'warning' | 'critical';
export type AuditActorType = 'user' | 'system' | 'automation';

export interface AuditInput {
  category:   AuditCategory;
  action:     string;
  actor?:     string;
  actorType?: AuditActorType;
  targetType?: string;
  targetId?:   string;
  targetName?: string;
  severity?:   AuditSeverity;
  metadata?:   Record<string, unknown>;
  ip?:         string;
}

export async function writeAudit(event: AuditInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      category:   event.category,
      action:     event.action,
      actor:      event.actor      ?? 'system',
      actorType:  event.actorType  ?? 'system',
      targetType: event.targetType ?? null,
      targetId:   event.targetId   ?? null,
      targetName: event.targetName ?? null,
      severity:   event.severity   ?? 'info',
      metadata:   event.metadata   ?? null,
      ip:         event.ip         ?? null,
    });
  } catch (e) {
    console.error('[audit] Failed to write event:', e);
  }
}

export interface AuditQuery {
  category?: string;
  severity?: string;
  search?:   string;
  from?:     string;
  to?:       string;
  limit?:    number;
  offset?:   number;
}

export async function queryAudit(opts: AuditQuery) {
  const { category, severity, search, from, to, limit = 100, offset = 0 } = opts;
  const conds: ReturnType<typeof eq>[] = [];

  if (category) conds.push(eq(auditEvents.category, category));
  if (severity) conds.push(eq(auditEvents.severity, severity));
  if (from)     conds.push(gte(auditEvents.timestamp, new Date(from)));
  if (to)       conds.push(lte(auditEvents.timestamp, new Date(to)));
  if (search) {
    const pat = `%${search}%`;
    conds.push(
      or(
        ilike(auditEvents.action,     pat),
        ilike(auditEvents.actor,      pat),
        ilike(auditEvents.targetName, pat),
        ilike(auditEvents.targetId,   pat),
      ) as ReturnType<typeof eq>
    );
  }

  const where = conds.length > 0 ? and(...conds) : undefined;

  const [rows, countRows] = await Promise.all([
    db.select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.timestamp))
      .limit(Math.min(limit, 500))
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(where),
  ]);

  return { events: rows, total: countRows[0]?.count ?? 0 };
}

export async function auditStats() {
  const rows = await db.select({
    category: auditEvents.category,
    count: sql<number>`count(*)::int`,
  })
    .from(auditEvents)
    .where(gte(auditEvents.timestamp, new Date(Date.now() - 86_400_000)))
    .groupBy(auditEvents.category);

  return rows;
}

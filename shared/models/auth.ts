import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
// Sprint 1 additions: username, password_hash, job_title, platform_access_type, default_portal.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  // ── Sprint 1: native auth ─────────────────────────────────────────────────
  username: varchar("username").unique(),
  passwordHash: varchar("password_hash"),
  jobTitle: varchar("job_title"),
  // 'full_platform' | 'portal_only' | 'hybrid'  (DB CHECK enforced in 030 migration)
  platformAccessType: varchar("platform_access_type").notNull().default("full_platform"),
  // Soft FK; hard FK enforced in 030 migration (portal_definitions.slug)
  defaultPortal: varchar("default_portal"),
  // ─────────────────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Per-user portal access assignments (Sprint 1).
// Maps a user to the specific portals they are allowed to access.
// Only relevant when users.platform_access_type = 'portal_only'.
export const userPortalAssignments = pgTable(
  "user_portal_assignments",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    portalSlug: varchar("portal_slug").notNull(),
    assignedAt: timestamp("assigned_at").defaultNow(),
    assignedBy: varchar("assigned_by"),
  },
  (table) => [
    index("idx_upa_user_id").on(table.userId),
    index("idx_upa_portal").on(table.portalSlug),
  ]
);

export type UserPortalAssignment = typeof userPortalAssignments.$inferSelect;

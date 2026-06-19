# Account Management Module — Technical Implementation Specification
## Bitsauto Monitoring Platform — Developer Reference

**Purpose:** This document contains the complete, verbatim source code and integration instructions for the Account Management module. A developer or AI agent can reconstruct the entire module from scratch using this document alone.

**Stack:** React + TypeScript (Vite), Express, PostgreSQL (Drizzle ORM), TailwindCSS, shadcn/ui, TanStack Query v5, Wouter routing  
**Document Version:** 2.0 — May 2026  
**Changes in v2.0:** Edit mode on company-create page, inline IP submission on company cards, ProvisioningPanel for all non-provisioned companies, full provision endpoint, PATCH replaces PUT for company updates, provisioningStatus/wizardDraft/sippyIAccount fields added to schema.

---

## 1. Stack & Library Versions

```
react                   18.x
typescript              5.x
@tanstack/react-query   5.x       (object-form only — no positional args)
wouter                  3.x
drizzle-orm             0.30+
drizzle-zod             0.5+
express                 4.x
@radix-ui/react-*       (via shadcn/ui)
lucide-react            0.400+
tailwindcss             3.x
```

**Critical TanStack Query v5 note:** Always use object form:
```typescript
useQuery({ queryKey: [...], ... })          // correct
useQuery([...], fn)                          // WRONG — v4 style, breaks silently
```

---

## 2. Authentication Middleware Pattern

The codebase uses a **non-factory** `requireRole` function. The signature is:

```typescript
requireRole(roles: string[], req: any, res: any, next: any): Promise<void>
```

**Usage in routes (always wrap as middleware):**
```typescript
app.get('/api/endpoint',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => { /* handler */ }
);
```

**WRONG patterns (do not use):**
```typescript
app.get('/api/endpoint', requireRole(['admin']),  ...)  // NOT a factory — will throw
app.get('/api/endpoint', isAuthenticated, ...)          // isAuthenticated does NOT exist
```

The `req.user?.claims?.sub` field contains the authenticated user's ID (Replit Auth).

---

## 3. Database Schema — `shared/schema.ts`

Add the following four table definitions to `shared/schema.ts`. Requires these imports already present:
```typescript
import { pgTable, serial, varchar, integer, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
```

### 3.1 — companies table

```typescript
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
  notes:           text("notes"),
  // ── Sippy provisioning fields ──────────────────────────────────────────────
  provisioningStatus: varchar("provisioning_status", { length: 32 }),
  // null = draft (not yet provisioned), 'pending_provision' = wizard done,
  // 'provisioned' = live on Sippy, 'suspended' = suspended
  wizardDraft:     text("wizard_draft"),        // JSON blob from client wizard
  sippyIAccount:   integer("sippy_i_account"),  // Sippy account ID after provisioning
  provisionedAt:   timestamp("provisioned_at"),
  provisionedBy:   varchar("provisioned_by", { length: 255 }),
  // ───────────────────────────────────────────────────────────────────────────
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  createdBy:       varchar("created_by", { length: 255 }),
});
export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
```

### 3.2 — company_contacts table

```typescript
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
```

### 3.3 — company_bank_accounts table

```typescript
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
```

### 3.4 — client_ip_requests table

```typescript
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
```

### 3.5 — SQL to create/alter tables directly

```sql
-- Create tables (if building from scratch)
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(256) NOT NULL UNIQUE,
  short_code VARCHAR(32) NOT NULL UNIQUE,
  country VARCHAR(64),
  kam VARCHAR(128),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  company_type VARCHAR(32) NOT NULL DEFAULT 'retail',
  contract_type VARCHAR(32) NOT NULL DEFAULT 'bilateral',
  department VARCHAR(64),
  team VARCHAR(64),
  client_timezone VARCHAR(64),
  vendor_timezone VARCHAR(64),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  vendor_billing_cycle VARCHAR(32) DEFAULT 'weekly_cutoff',
  vendor_grace_period INTEGER DEFAULT 3,
  vendor_credit_limit REAL DEFAULT 0,
  dispute_over_pct REAL DEFAULT 0,
  client_billing_cycle VARCHAR(32) DEFAULT 'weekly_cutoff',
  client_grace_period INTEGER DEFAULT 3,
  client_credit_limit REAL DEFAULT 0,
  dispute_over_val REAL DEFAULT 0,
  payment_term VARCHAR(32) DEFAULT 'prepaid',
  legal_name_ci VARCHAR(256),
  legal_name_ven VARCHAR(256),
  invoice_email VARCHAR(256),
  notes TEXT,
  provisioning_status VARCHAR(32),
  wizard_draft TEXT,
  sippy_i_account INTEGER,
  provisioned_at TIMESTAMP,
  provisioned_by VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255)
);

-- Add provisioning columns to existing companies table (migration)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS provisioning_status VARCHAR(32);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS wizard_draft TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sippy_i_account INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMP;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS provisioned_by VARCHAR(255);

CREATE TABLE IF NOT EXISTS company_contacts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  contact_type VARCHAR(32) NOT NULL,
  first_name VARCHAR(128) NOT NULL,
  last_name VARCHAR(128),
  email VARCHAR(256) NOT NULL,
  phone VARCHAR(64),
  fax VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  bank_name VARCHAR(256) NOT NULL,
  account_title VARCHAR(256) NOT NULL,
  account_no VARCHAR(128) NOT NULL,
  iban VARCHAR(64),
  swift_code VARCHAR(32) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  country VARCHAR(64) NOT NULL,
  address TEXT,
  remarks TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS client_ip_requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  client_name VARCHAR(256) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  trunk VARCHAR(128),
  description TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  submitted_by VARCHAR(255),
  reviewed_by VARCHAR(255),
  rejection_reason TEXT,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP
);
```

---

## 4. Storage Interface — `server/storage.ts`

### 4.1 — Add to imports at top of storage.ts

```typescript
import {
  companies, companyContacts, companyBankAccounts, clientIpRequests,
} from "@shared/schema";
import type {
  Company, InsertCompany, CompanyContact, CompanyBankAccount,
  ClientIpRequest, InsertClientIpRequest,
} from "@shared/schema";
```

### 4.2 — Add to IStorage interface

```typescript
// ── Account Management — Companies ─────────────────────────────────────────
getCompanies(): Promise<Company[]>;
getCompany(id: number): Promise<Company | null>;
createCompany(data: InsertCompany, contacts: any[], bankAccounts: any[]): Promise<Company>;
updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company>;
deleteCompany(id: number): Promise<void>;

// ── Account Management — Client IP Requests ─────────────────────────────────
getClientIpRequests(companyId?: number): Promise<ClientIpRequest[]>;
findClientIpRequest(ipAddress: string, clientName: string): Promise<ClientIpRequest | null>;
createClientIpRequest(data: InsertClientIpRequest): Promise<ClientIpRequest>;
updateClientIpRequest(id: number, updates: Partial<ClientIpRequest>): Promise<ClientIpRequest>;
```

### 4.3 — Add to DatabaseStorage class implementation

```typescript
async getCompanies(): Promise<Company[]> {
  return db.select().from(companies).orderBy(companies.name);
}

async getCompany(id: number): Promise<Company | null> {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  return row ?? null;
}

async createCompany(data: InsertCompany, contacts: any[], bankAccounts: any[]): Promise<Company> {
  const [company] = await db.insert(companies).values(data).returning();
  if (contacts.length) {
    const validContacts = contacts.filter(c => c.firstName?.trim() || c.email?.trim());
    if (validContacts.length) {
      await db.insert(companyContacts).values(
        validContacts.map(c => ({ ...c, companyId: company.id }))
      );
    }
  }
  if (bankAccounts.length) {
    const validBanks = bankAccounts.filter(b => b.bankName?.trim() && b.accountNo?.trim());
    if (validBanks.length) {
      await db.insert(companyBankAccounts).values(
        validBanks.map(b => ({ ...b, companyId: company.id }))
      );
    }
  }
  return company;
}

async updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company> {
  const [row] = await db.update(companies).set(updates).where(eq(companies.id, id)).returning();
  return row;
}

async deleteCompany(id: number): Promise<void> {
  await db.delete(companyContacts).where(eq(companyContacts.companyId, id));
  await db.delete(companyBankAccounts).where(eq(companyBankAccounts.companyId, id));
  await db.delete(companies).where(eq(companies.id, id));
}

// ── Account Management — Client IP Requests ──────────────────────────────────

async getClientIpRequests(companyId?: number): Promise<ClientIpRequest[]> {
  if (companyId) {
    return db.select().from(clientIpRequests)
      .where(eq(clientIpRequests.companyId, companyId))
      .orderBy(desc(clientIpRequests.submittedAt));
  }
  return db.select().from(clientIpRequests).orderBy(desc(clientIpRequests.submittedAt));
}

async findClientIpRequest(ipAddress: string, clientName: string): Promise<ClientIpRequest | null> {
  const [row] = await db.select().from(clientIpRequests)
    .where(and(
      eq(clientIpRequests.ipAddress, ipAddress),
      eq(clientIpRequests.clientName, clientName),
    ));
  return row ?? null;
}

async createClientIpRequest(data: InsertClientIpRequest): Promise<ClientIpRequest> {
  const [row] = await db.insert(clientIpRequests).values(data).returning();
  return row;
}

async updateClientIpRequest(id: number, updates: Partial<ClientIpRequest>): Promise<ClientIpRequest> {
  const [row] = await db.update(clientIpRequests).set(updates).where(eq(clientIpRequests.id, id)).returning();
  return row;
}
```

---

## 5. API Routes — `server/routes.ts`

The following routes are appended near the end of the `registerRoutes` function, just before `return httpServer`.

**Required imports already in routes.ts:**
```typescript
import { join as _pathJoin } from "path";
import { storage } from "./storage";
// requireRole is defined earlier in the same file — NOT imported
// sippyXmlCreds, sippyPortalUrl, sippy — already imported from sippy.ts
```

### 5.1 — Company CRUD routes

```typescript
// ── Account Management — Companies ────────────────────────────────────────────

app.get('/api/companies',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const rows = await storage.getCompanies();
      res.json({ companies: rows });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

app.post('/api/companies',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const { basic, billing, contacts = [], bankAccounts = [] } = req.body ?? {};
      if (!basic?.name?.trim()) return res.status(400).json({ message: 'Company name is required' });
      if (!basic?.shortCode?.trim()) return res.status(400).json({ message: 'Short code is required' });
      const company = await storage.createCompany({
        name: basic.name.trim(),
        shortCode: basic.shortCode.trim().toUpperCase(),
        country: basic.country || null,
        kam: basic.kam || null,
        status: basic.status || 'active',
        companyType: basic.companyType || 'retail',
        contractType: basic.contractType || 'bilateral',
        department: basic.department || null,
        team: basic.team || null,
        clientTimezone: basic.clientTimezone || null,
        vendorTimezone: basic.vendorTimezone || null,
        currency: basic.currency || 'USD',
        vendorBillingCycle: billing?.vendorBillingCycle || 'weekly_cutoff',
        vendorGracePeriod: billing?.vendorGracePeriod ?? 3,
        vendorCreditLimit: billing?.vendorCreditLimit ?? 0,
        disputeOverPct: billing?.disputeOverPct ?? 0,
        clientBillingCycle: billing?.clientBillingCycle || 'weekly_cutoff',
        clientGracePeriod: billing?.clientGracePeriod ?? 3,
        clientCreditLimit: billing?.clientCreditLimit ?? 0,
        disputeOverVal: billing?.disputeOverVal ?? 0,
        paymentTerm: billing?.paymentTerm || 'prepaid',
        legalNameCi: billing?.legalNameCi || null,
        legalNameVen: billing?.legalNameVen || null,
        invoiceEmail: billing?.invoiceEmail || null,
        notes: null,
        createdBy: (req as any).user?.claims?.sub || null,
      }, contacts, bankAccounts);
      res.json({ company });
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.includes('unique') || msg.includes('duplicate'))
        return res.status(409).json({ message: 'Company name or short code already exists' });
      res.status(500).json({ message: msg });
    }
  });

app.get('/api/companies/:id',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });
      const company = await storage.getCompany(id);
      if (!company) return res.status(404).json({ message: 'Company not found' });
      res.json({ company });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

// PATCH — partial update (replaces old PUT route)
app.patch('/api/companies/:id',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });
      // Body may be flat updates or structured { basic, billing, contacts, bankAccounts }
      const body = req.body ?? {};
      let updates: Record<string, any> = {};
      if (body.basic) {
        // Structured payload from the edit wizard
        const { basic, billing } = body;
        updates = {
          name: basic.name?.trim(),
          shortCode: basic.shortCode?.trim().toUpperCase(),
          country: basic.country || null,
          kam: basic.kam || null,
          status: basic.status || 'active',
          companyType: basic.companyType || 'retail',
          contractType: basic.contractType || 'bilateral',
          department: basic.department || null,
          team: basic.team || null,
          clientTimezone: basic.clientTimezone || null,
          vendorTimezone: basic.vendorTimezone || null,
          currency: basic.currency || 'USD',
          vendorBillingCycle: billing?.vendorBillingCycle || 'weekly_cutoff',
          vendorGracePeriod: billing?.vendorGracePeriod ?? 3,
          vendorCreditLimit: billing?.vendorCreditLimit ?? 0,
          disputeOverPct: billing?.disputeOverPct ?? 0,
          clientBillingCycle: billing?.clientBillingCycle || 'weekly_cutoff',
          clientGracePeriod: billing?.clientGracePeriod ?? 3,
          clientCreditLimit: billing?.clientCreditLimit ?? 0,
          disputeOverVal: billing?.disputeOverVal ?? 0,
          paymentTerm: billing?.paymentTerm || 'prepaid',
          legalNameCi: billing?.legalNameCi || null,
          legalNameVen: billing?.legalNameVen || null,
          invoiceEmail: billing?.invoiceEmail || null,
        };
      } else {
        // Flat updates (e.g. { provisioningStatus: 'provisioned', sippyIAccount: 42 })
        updates = body;
      }
      const updated = await storage.updateCompany(id, updates);
      res.json({ company: updated });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

app.delete('/api/companies/:id',
  (req: any, res: any, next: any) => requireRole(['admin'], req, res, next),
  async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });
      await storage.deleteCompany(id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
```

### 5.2 — Client IP Request routes

```typescript
// ── Account Management — Client IP Approval Requests ─────────────────────────

app.get('/api/client-ip-requests',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const rows = await storage.getClientIpRequests();
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : null;
      const filtered = companyId ? rows.filter((r: any) => r.companyId === companyId) : rows;
      res.json({ requests: filtered });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

app.post('/api/client-ip-requests',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const { clientName, companyId, ipAddress, trunk, description } = req.body ?? {};
      if (!clientName?.trim()) return res.status(400).json({ message: 'Client name is required' });
      if (!ipAddress?.trim()) return res.status(400).json({ message: 'IP address is required' });
      const existing = await storage.findClientIpRequest(ipAddress.trim(), clientName.trim());
      if (existing && existing.status === 'pending')
        return res.status(409).json({ message: 'IP already submitted and pending approval' });
      const row = await storage.createClientIpRequest({
        clientName: clientName.trim(),
        companyId: companyId ? parseInt(companyId, 10) : null,
        ipAddress: ipAddress.trim(),
        trunk: trunk || null,
        description: description || null,
        status: 'pending',
        submittedBy: (req as any).user?.claims?.sub || null,
        reviewedBy: null,
        rejectionReason: null,
        reviewedAt: null,
      });
      res.json({ request: row });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

app.patch('/api/client-ip-requests/:id/approve',
  (req: any, res: any, next: any) => requireRole(['admin'], req, res, next),
  async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const reviewer = (req as any).user?.claims?.sub || 'admin';
      const updated = await storage.updateClientIpRequest(id, {
        status: 'approved', reviewedBy: reviewer, reviewedAt: new Date()
      });
      // Incremental sync: if company is already provisioned, push auth rule to Sippy immediately
      if (updated.companyId) {
        try {
          const company = await storage.getCompany(updated.companyId);
          if (company?.provisioningStatus === 'provisioned' && company.sippyIAccount) {
            const settings = await storage.getSettings();
            const { username, password } = sippyXmlCreds(settings as any);
            await sippy.addSippyAuthRule(username, password, {
              iAccount: company.sippyIAccount, iProtocol: 1, remoteIp: updated.ipAddress
            });
          }
        } catch (syncErr: any) {
          console.warn('[IP Approve] Incremental Sippy sync failed:', syncErr.message);
        }
      }
      res.json({ request: updated });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

app.patch('/api/client-ip-requests/:id/reject',
  (req: any, res: any, next: any) => requireRole(['admin'], req, res, next),
  async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { reason } = req.body ?? {};
      const reviewer = (req as any).user?.claims?.sub || 'admin';
      const updated = await storage.updateClientIpRequest(id, {
        status: 'rejected', reviewedBy: reviewer,
        rejectionReason: reason || null, reviewedAt: new Date()
      });
      res.json({ request: updated });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
```

### 5.3 — Client Wizard Submit route

```typescript
// ── Account Management — Client Wizard Submit ─────────────────────────────────
// Saves wizard draft to company, transitions to pending_provision, creates Sippy account.

app.post('/api/client-wizard/submit',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const { step1, step2, trunks, ips, authRules, validRules, iCustomer = 1 } = req.body ?? {};
      if (!step1?.userId?.trim()) return res.status(400).json({ message: 'User ID is required' });
      const companyId = step1.companyId ? parseInt(step1.companyId, 10) : null;

      // Save wizard draft to company record
      if (companyId) {
        const draft = JSON.stringify({ step1, step2, trunks, ips, authRules, validRules, iCustomer });
        await storage.updateCompany(companyId, { wizardDraft: draft, provisioningStatus: 'pending_provision' } as any);
      }

      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings as any);
      const portalUrl = sippyPortalUrl(settings as any);
      const primaryTrunk = trunks?.[0] ?? {};
      const displayName = step1.displayName || (companyId ? (await storage.getCompany(companyId))?.name : step1.userId) || step1.userId;

      const result = await sippy.pushAccountToSippy({
        name: displayName,
        type: 'client',
        username: step1.userId,
        voipPassword: step1.password,
        webPassword: step1.password,
        companyName: displayName,
        iCustomer,
        routingGroup: primaryTrunk.routingGroupId || undefined,
        maxSessions: primaryTrunk.maxSessions ? parseInt(primaryTrunk.maxSessions, 10) : 0,
        maxCallsPerSecond: primaryTrunk.maxCps ? parseFloat(primaryTrunk.maxCps) : undefined,
        maxSessionTime: primaryTrunk.maxTime ? parseInt(primaryTrunk.maxTime, 10) : 3600,
        preferredCodec: primaryTrunk.codec && primaryTrunk.codec !== 'none'
          ? parseInt(primaryTrunk.codec, 10) : null,
        usePreferredCodecOnly: !!primaryTrunk.useCodecOnly,
        disallowLoops: !!primaryTrunk.preventLoops,
        regAllowed: primaryTrunk.allowRegistration !== false ? 1 : 0,
        cldTranslationRule: primaryTrunk.cldTranslation || '',
        email: step1.notifEmailTo || undefined,
        cc: step1.notifEmailCc || undefined,
        currency: 'USD',
      }, { username, password }, portalUrl);

      // i_account is snake_case in the Sippy response
      let iAccount: number | undefined = result?.i_account;
      if (!iAccount && step1.userId) {
        const lookup = await sippy.listSippyAccounts(username, password, {}, portalUrl);
        const match = lookup.accounts.find((a: any) =>
          a.username?.toLowerCase() === step1.userId.toLowerCase()
        );
        if (match) iAccount = match.iAccount;
      }

      res.json({ success: true, iAccount, message: result?.message });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
```

### 5.4 — Provision to Sippy route

```typescript
// ── Account Management — Provision Company to Sippy ───────────────────────────
// POST /api/companies/:id/provision — admin only
// Requirements: wizardDraft must exist, ≥1 approved IP, 0 pending IPs

app.post('/api/companies/:id/provision',
  (req: any, res: any, next: any) => requireRole(['admin'], req, res, next),
  async (req: any, res) => {
    try {
      const companyId = parseInt(req.params.id, 10);
      if (isNaN(companyId)) return res.status(400).json({ message: 'Invalid company ID' });
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ message: 'Company not found' });
      if (company.provisioningStatus === 'provisioned')
        return res.status(409).json({ message: 'Client already provisioned in Sippy' });
      if (!company.wizardDraft)
        return res.status(400).json({ message: 'No wizard draft found. Complete the client wizard first.' });

      const ipRequests = await storage.getClientIpRequests(companyId);
      const pendingIps = ipRequests.filter((r: any) => r.status === 'pending');
      const approvedIps = ipRequests.filter((r: any) => r.status === 'approved');
      if (pendingIps.length > 0)
        return res.status(400).json({ message: `${pendingIps.length} IP(s) still pending approval.` });
      if (approvedIps.length === 0)
        return res.status(400).json({ message: 'No approved IPs. Approve at least one IP before provisioning.' });

      const draft = JSON.parse(company.wizardDraft);
      const { step1, trunks, iCustomer = 1 } = draft;
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings as any);
      const portalUrl = sippyPortalUrl(settings as any);
      const adminUser = (settings as any)?.apiAdminUsername || (settings as any)?.portalUsername || '';
      const adminPass = (settings as any)?.apiAdminPassword || (settings as any)?.portalPassword || '';
      const portalUser = (settings as any)?.portalUsername || '';
      const portalPass = (settings as any)?.portalPassword || '';
      const adminWebPassword = (settings as any)?.adminWebPassword || undefined;
      const primaryTrunk = trunks?.[0] ?? {};
      const planBase = company.shortCode || company.name;
      const tariffName = `${planBase}-TARIFF`;
      const servicePlanName = `${planBase}-SP`;

      // Step 1: Create tariff (duplicate guard built in — reuses if exists)
      let servicePlanId: string | undefined;
      try {
        const tariffRes = await sippy.createSippyTariff(username, password, { name: tariffName, currency: 'USD' }, portalUrl);
        if (tariffRes.success && tariffRes.iTariff) {
          // Step 2: Create service plan linked to tariff
          const planRes = await sippy.createSippyServicePlan(
            portalUrl, adminUser, adminPass, portalUser, portalPass,
            servicePlanName, tariffRes.iTariff, undefined, 3, adminWebPassword,
          );
          if (planRes.success && planRes.planId) {
            servicePlanId = String(planRes.planId);
          }
        }
      } catch (e: any) {
        console.warn(`[Provision] Tariff/plan setup error (non-fatal): ${e.message}`);
      }

      // Step 3: Create account in Sippy
      const displayName = step1.displayName || company.name;
      const result = await sippy.pushAccountToSippy({
        name: displayName,
        type: 'client',
        username: step1.userId,
        voipPassword: step1.password,
        webPassword: step1.password,
        companyName: displayName,
        iCustomer,
        servicePlan: servicePlanId,
        routingGroup: primaryTrunk.routingGroupId || undefined,
        maxSessions: primaryTrunk.maxSessions ? parseInt(primaryTrunk.maxSessions, 10) : 0,
        maxCallsPerSecond: primaryTrunk.maxCps ? parseFloat(primaryTrunk.maxCps) : undefined,
        maxSessionTime: primaryTrunk.maxTime ? parseInt(primaryTrunk.maxTime, 10) : 3600,
        preferredCodec: primaryTrunk.codec && primaryTrunk.codec !== 'none' ? parseInt(primaryTrunk.codec, 10) : null,
        usePreferredCodecOnly: !!primaryTrunk.useCodecOnly,
        disallowLoops: !!primaryTrunk.preventLoops,
        regAllowed: primaryTrunk.allowRegistration !== false ? 1 : 0,
        cldTranslationRule: primaryTrunk.cldTranslation || '',
        email: step1.notifEmailTo || undefined,
        cc: step1.notifEmailCc || undefined,
        currency: 'USD',
      }, { username, password }, portalUrl);

      // result.i_account is snake_case — this is the correct field name
      let iAccount: number | undefined = result?.i_account;

      // Fallback: look up by username if no ID returned (covers "already exists" case)
      if (!iAccount) {
        const lookupResult = await sippy.listSippyAccounts(username, password, {}, portalUrl);
        const match = lookupResult.accounts.find((a: any) =>
          a.username?.toLowerCase() === step1.userId?.toLowerCase()
        );
        if (match) iAccount = match.iAccount;
        if (!iAccount) {
          const lookupResult2 = await sippy.listSippyAccounts(username, password, { iCustomer: iCustomer ?? 1 }, portalUrl);
          const match2 = lookupResult2.accounts.find((a: any) =>
            a.username?.toLowerCase() === step1.userId?.toLowerCase()
          );
          if (match2) iAccount = match2.iAccount;
        }
      }
      if (!iAccount) throw new Error(`Could not provision account "${step1.userId}" — check Sippy portal.`);

      // Step 4: Push auth rules for all approved IPs
      const authErrors: string[] = [];
      for (const ipReq of approvedIps) {
        try {
          await sippy.addSippyAuthRule(username, password, { iAccount, iProtocol: 1, remoteIp: ipReq.ipAddress });
        } catch (e: any) { authErrors.push(`${ipReq.ipAddress}: ${e.message}`); }
      }

      // Step 5: Mark company as provisioned
      const reviewer = (req as any).user?.claims?.sub || 'admin';
      await storage.updateCompany(companyId, {
        provisioningStatus: 'provisioned',
        sippyIAccount: iAccount,
        provisionedAt: new Date(),
        provisionedBy: reviewer,
      } as any);

      res.json({ success: true, iAccount, authErrors: authErrors.length ? authErrors : undefined });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
```

### 5.5 — Document download routes

```typescript
// GET /api/download/account-management-impl-spec — Technical Implementation Spec (.docx)
app.get('/api/download/account-management-impl-spec', async (_req: any, res: any) => {
  try {
    const mdPath  = _pathJoin(process.cwd(), 'ACCOUNT_MANAGEMENT_IMPL_SPEC.md');
    const outPath = _pathJoin(process.cwd(), 'attached_assets', 'Bitsauto_Account_Management_Impl_Spec.docx');
    await convertMdToDocx(mdPath, outPath, 'Account Management Module — Technical Implementation Specification');
    res.download(outPath, 'Bitsauto_Account_Management_Impl_Spec.docx', (err: any) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Conversion failed' });
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/download/account-management-workflow — Account Management Workflow (.docx)
app.get('/api/download/account-management-workflow', async (_req: any, res: any) => {
  try {
    const mdPath  = _pathJoin(process.cwd(), 'ACCOUNT_MANAGEMENT_WORKFLOW.md');
    const outPath = _pathJoin(process.cwd(), 'attached_assets', 'Bitsauto_Account_Management_Workflow.docx');
    await convertMdToDocx(mdPath, outPath, 'Account Management Workflow & Operations Script');
    res.download(outPath, 'Bitsauto_Account_Management_Workflow.docx', (err: any) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Conversion failed' });
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
```

---

## 6. Frontend Pages

### 6.1 — Router registration in `client/src/App.tsx`

```tsx
import CompanyListPage   from "@/pages/company-list";
import CompanyCreatePage from "@/pages/company-create";
import ClientWizardPage  from "@/pages/client-wizard";

// Inside the Switch component:
<Route path="/company/list">
  {() => <ProtectedRoute component={CompanyListPage} requiredRoles={['admin','management']} mgmtFeature="clients" />}
</Route>
<Route path="/company/create">
  {() => <ProtectedRoute component={CompanyCreatePage} requiredRoles={['admin','management']} mgmtFeature="clients" />}
</Route>
<Route path="/company/edit/:id">
  {() => <ProtectedRoute component={CompanyCreatePage} requiredRoles={['admin','management']} mgmtFeature="clients" />}
</Route>
<Route path="/client/wizard">
  {() => <ProtectedRoute component={ClientWizardPage} requiredRoles={['admin','management']} mgmtFeature="account_management" />}
</Route>
```

Both `/company/create` and `/company/edit/:id` use the same `CompanyCreatePage` component. The component detects edit mode via `useParams`.

---

### 6.2 — `client/src/pages/company-create.tsx`

This page handles both CREATE (`/company/create`) and EDIT (`/company/edit/:id`) modes using the same component.

**Edit mode detection:** `useParams<{ id?: string }>()` — if `id` is present, the component is in edit mode.  
**Pre-population:** On mount (edit mode only), fetches `/api/companies`, finds the matching record by ID, and populates all state fields via `useEffect`.  
**Save action:** Edit mode sends `PATCH /api/companies/:id`; create mode sends `POST /api/companies`.

```tsx
import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronRight, ChevronLeft, CheckCircle2, Plus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STEPS = [
  { id: 1, label: "Basic Information" },
  { id: 2, label: "Billing Information" },
  { id: 3, label: "Contacts & Bank" },
];

const COUNTRIES = ["United Kingdom","United States","Pakistan","India","Bangladesh","UAE","Saudi Arabia","Germany","France","Australia","Canada","Nigeria","Kenya","Egypt","South Africa","Other"];
const TIMEZONES = ["GMT+00:00 | UTC","GMT+01:00 | London","GMT+02:00 | Cairo","GMT+03:00 | Riyadh","GMT+04:00 | Dubai","GMT+05:00 | Karachi","GMT+05:30 | Mumbai","GMT+06:00 | Dhaka","GMT+07:00 | Bangkok","GMT+08:00 | Singapore","GMT+09:00 | Tokyo","GMT-05:00 | New York","GMT-08:00 | Los Angeles"];
const CURRENCIES = ["USD","EUR","GBP","AED","SAR","PKR","INR","BDT","NGN","KES","EGP"];
const BILLING_CYCLES = ["weekly_cutoff","monthly","daily","bi_weekly"];
const BILLING_CYCLE_LABELS: Record<string,string> = { weekly_cutoff:"Weekly Cutoff", monthly:"Monthly", daily:"Daily", bi_weekly:"Bi-Weekly" };
const PAYMENT_TERMS = ["prepaid","postpaid","credit"];
const CONTRACT_TYPES = ["bilateral","client","vendor"];
const COMPANY_TYPES = ["retail","wholesale"];
const DEPARTMENTS = ["retail","wholesale","enterprise","carrier","reseller"];

interface Contact { firstName: string; lastName: string; email: string; phone: string; fax: string; }
interface BankAccount { bankName: string; accountTitle: string; accountNo: string; iban: string; swiftCode: string; currency: string; country: string; address: string; remarks: string; }

const emptyContact = (): Contact => ({ firstName:"", lastName:"", email:"", phone:"", fax:"" });
const emptyBank = (): BankAccount => ({ bankName:"", accountTitle:"", accountNo:"", iban:"", swiftCode:"", currency:"USD", country:"", address:"", remarks:"" });

const defaultBasic = () => ({
  name:"", shortCode:"", country:"", kam:"", status:"active",
  companyType:"retail", contractType:"bilateral", department:"retail",
  team:"", clientTimezone:"", vendorTimezone:"", currency:"USD",
});
const defaultBilling = () => ({
  vendorBillingCycle:"weekly_cutoff", vendorGracePeriod:3, vendorCreditLimit:0, disputeOverPct:0,
  clientBillingCycle:"weekly_cutoff", clientGracePeriod:3, clientCreditLimit:0, disputeOverVal:0,
  paymentTerm:"prepaid", legalNameCi:"", legalNameVen:"", invoiceEmail:"",
});
const defaultContacts = () => ({
  technical:[emptyContact()], finance:[emptyContact()], commercial:[emptyContact()], billing:[emptyContact()],
});

export default function CompanyCreatePage() {
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const companyId = params.id ? parseInt(params.id, 10) : null;
  const isEdit = !!companyId;
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [populated, setPopulated] = useState(false);

  const [basic, setBasic] = useState(defaultBasic());
  const [billing, setBilling] = useState(defaultBilling());
  const [contacts, setContacts] = useState<Record<string,Contact[]>>(defaultContacts());
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);

  const { data: usersData } = useQuery<{ users: { username: string; displayName?: string }[] }>({
    queryKey: ["/api/users"],
    retry: false,
  });

  const { data: existingData, isLoading: loadingExisting } = useQuery<{ companies: any[] }>({
    queryKey: ["/api/companies"],
    enabled: isEdit,
  });

  // Pre-populate form when in edit mode and company data loads
  useEffect(() => {
    if (!isEdit || populated || !existingData) return;
    const co = existingData.companies?.find((c: any) => c.id === companyId);
    if (!co) return;
    setBasic({
      name: co.name ?? "",
      shortCode: co.shortCode ?? "",
      country: co.country ?? "",
      kam: co.kam ?? "",
      status: co.status ?? "active",
      companyType: co.companyType ?? "retail",
      contractType: co.contractType ?? "bilateral",
      department: co.department ?? "retail",
      team: co.team ?? "",
      clientTimezone: co.clientTimezone ?? "",
      vendorTimezone: co.vendorTimezone ?? "",
      currency: co.currency ?? "USD",
    });
    setBilling({
      vendorBillingCycle: co.vendorBillingCycle ?? "weekly_cutoff",
      vendorGracePeriod: co.vendorGracePeriod ?? 3,
      vendorCreditLimit: co.vendorCreditLimit ?? 0,
      disputeOverPct: co.disputeOverPct ?? 0,
      clientBillingCycle: co.clientBillingCycle ?? "weekly_cutoff",
      clientGracePeriod: co.clientGracePeriod ?? 3,
      clientCreditLimit: co.clientCreditLimit ?? 0,
      disputeOverVal: co.disputeOverVal ?? 0,
      paymentTerm: co.paymentTerm ?? "prepaid",
      legalNameCi: co.legalNameCi ?? "",
      legalNameVen: co.legalNameVen ?? "",
      invoiceEmail: co.invoiceEmail ?? "",
    });
    setPopulated(true);
  }, [isEdit, existingData, companyId, populated]);

  const createMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/companies", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company created successfully" });
      navigate("/company/list");
    },
    onError: (e: any) => toast({ title: e.message || "Failed to create company", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("PATCH", `/api/companies/${companyId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company updated successfully" });
      navigate("/company/list");
    },
    onError: (e: any) => toast({ title: e.message || "Failed to update company", variant: "destructive" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const setB = (k: string, v: any) => setBasic(p => ({ ...p, [k]: v }));
  const setBl = (k: string, v: any) => setBilling(p => ({ ...p, [k]: v }));

  const validateStep = () => {
    const errs: Record<string,string> = {};
    if (step === 1) {
      if (!basic.name.trim()) errs.name = "Company name is required";
      if (!basic.shortCode.trim()) errs.shortCode = "Short code is required";
      if (!basic.department) errs.department = "Department is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validateStep()) setStep(s => Math.min(s + 1, 3)); };
  const back = () => setStep(s => Math.max(s - 1, 1));

  const handleSubmit = () => {
    const pocContacts = Object.entries(contacts).flatMap(([type, list]) =>
      list.filter(c => c.firstName || c.email).map(c => ({ contactType: type, ...c }))
    );
    const payload = { basic, billing, contacts: pocContacts, bankAccounts };
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  if (isEdit && loadingExisting && !populated) {
    return (
      <div className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading company…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-blue-400" />
        <h1 className="text-xl font-semibold">{isEdit ? "Edit Company" : "Create New Company"}</h1>
        {isEdit && <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 bg-blue-500/10">Editing #{companyId}</Badge>}
      </div>
      {/* Step indicators, form content, back/next/submit buttons — same structure as before */}
      {/* Submit button shows "Save Changes" in edit mode, "Create Company" in create mode */}
      {/* isPending covers both createMutation.isPending and updateMutation.isPending */}
    </div>
  );
}
```

---

### 6.3 — `client/src/pages/company-list.tsx`

**Key behaviour changes in v2.0:**
- `ProvisioningPanel` now renders for ALL companies where `provisioningStatus !== 'provisioned' && provisioningStatus !== 'suspended'`
- `ProvisioningPanel` includes an inline "Add IP" form — no wizard needed to submit IPs
- Edit/Delete buttons always visible regardless of provisioning status
- "Provision to Sippy" button disabled with "wizard required" badge if `wizardDraft` is null
- IP query no longer gated on `pending_provision` status — always fetches for non-provisioned companies

```tsx
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Building2, Plus, Search, Pencil, Trash2, Users, Globe, CreditCard,
  Zap, Loader2, Clock, CheckCircle2, XCircle, ShieldCheck, AlertTriangle, PlusCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

interface IpRequest {
  id: number; ipAddress: string; trunk: string | null;
  description: string | null; status: string; submittedBy: string | null;
}

function ProvisioningPanel({ company }: { company: Company }) {
  const { toast } = useToast();
  const companyAny = company as any;
  const hasWizardDraft = !!companyAny.wizardDraft;   // provision button gated on this

  const [showAddIp, setShowAddIp] = useState(false);
  const [newIp, setNewIp] = useState("");
  const [newTrunk, setNewTrunk] = useState("");

  // Always fetch — no longer gated on pending_provision status
  const { data: ipData, isLoading: ipsLoading } = useQuery<{ requests: IpRequest[] }>({
    queryKey: ["/api/client-ip-requests", company.id],
    queryFn: () => fetch(`/api/client-ip-requests?companyId=${company.id}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: false,
  });

  const addIpMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-ip-requests", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests", company.id] });
      setNewIp(""); setNewTrunk(""); setShowAddIp(false);
      toast({ title: "IP submitted for approval" });
    },
    onError: (e: any) => toast({ title: "Failed to add IP", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/client-ip-requests/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests", company.id] });
      toast({ title: "IP approved" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/client-ip-requests/${id}/reject`, { reason: "Rejected from Companies page" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests", company.id] });
      toast({ title: "IP rejected" });
    },
  });

  const provisionMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${company.id}/provision`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: `${company.name} provisioned to Sippy` });
    },
    onError: (e: any) => toast({ title: "Provisioning failed", description: e.message, variant: "destructive" }),
  });

  const allRequests = ipData?.requests ?? [];
  const pendingIps  = allRequests.filter(r => r.status === "pending");
  const approvedIps = allRequests.filter(r => r.status === "approved");
  const rejectedIps = allRequests.filter(r => r.status === "rejected");
  // Can provision only if: wizardDraft exists, ≥1 approved IP, 0 pending IPs
  const canProvision = hasWizardDraft && pendingIps.length === 0 && approvedIps.length > 0;

  // ... render: IP header + "Add IP" toggle, inline IP form, pending/approved/rejected IP rows,
  //     warning if no wizardDraft, green "Provision to Sippy" button (or disabled with badges)
}

export default function CompanyListPage() {
  // ... companies query, delete mutation, search filter

  // Render: for each company card —
  // showPanel = provisioningStatus !== 'provisioned' && provisioningStatus !== 'suspended'
  // {showPanel && <ProvisioningPanel company={c} />}
  // Edit and Delete buttons always shown (not gated on provisioningStatus)
}
```

---

## 7. API Route Summary

| Method | Path | Role | Description |
|---|---|---|---|
| GET | /api/companies | admin, management | List all companies (full row including provisioningStatus, wizardDraft, sippyIAccount) |
| POST | /api/companies | admin, management | Create company (structured body: { basic, billing, contacts, bankAccounts }) |
| GET | /api/companies/:id | admin, management | Get single company |
| PATCH | /api/companies/:id | admin, management | Update company — accepts structured { basic, billing } OR flat partial updates |
| DELETE | /api/companies/:id | admin | Delete company and all linked contacts/banks |
| GET | /api/client-ip-requests | admin, management | List IP requests; ?companyId=N to filter |
| POST | /api/client-ip-requests | admin, management | Submit IP for approval |
| PATCH | /api/client-ip-requests/:id/approve | admin | Approve IP; immediately syncs to Sippy if company already provisioned |
| PATCH | /api/client-ip-requests/:id/reject | admin | Reject IP |
| POST | /api/client-wizard/submit | admin, management | Full wizard submit — saves wizardDraft, sets pending_provision, creates Sippy account |
| POST | /api/companies/:id/provision | admin | Provision to Sippy — creates tariff, service plan, account, auth rules |
| GET | /api/download/account-management-workflow | any auth | Download Workflow doc as .docx |
| GET | /api/download/account-management-impl-spec | any auth | Download this spec as .docx |

---

## 8. Key Implementation Notes & Gotchas

### 8.1 — Sippy field naming: i_account vs iAccount

The Sippy API returns `i_account` (snake_case) in XML-RPC responses. The `SippyAccount` TypeScript interface uses `iAccount` (camelCase). Always access `result.i_account` when reading from a raw Sippy response, and `account.iAccount` when reading from the parsed interface.

```typescript
// CORRECT: reading raw API response
let iAccount: number | undefined = result?.i_account;

// CORRECT: reading parsed SippyAccount interface
const id = account.iAccount;

// WRONG: result?.iAccount — will be undefined for raw Sippy responses
```

### 8.2 — wizardDraft is required for provisioning

`POST /api/companies/:id/provision` will return HTTP 400 if `company.wizardDraft` is null. The wizard draft stores the SIP account configuration (routing group, codec, credentials, etc.) used during account creation. Run the Client Wizard (`/client/wizard`) at least once for any company before direct provisioning.

### 8.3 — Incremental IP sync on approval

When `PATCH /api/client-ip-requests/:id/approve` is called and the company is already `provisioned`, the approve handler immediately calls `sippy.addSippyAuthRule()` to push the new IP to Sippy without requiring a full re-provision.

### 8.4 — PATCH vs PUT for company updates

The original spec used `PUT /api/companies/:id`. This was changed to `PATCH` in v2.0. The handler accepts either a structured payload (`{ basic, billing }`) or a flat partial update object. Internal calls (e.g., setting `provisioningStatus`, `wizardDraft`, `sippyIAccount`) use flat partial updates.

### 8.5 — Edit page uses shared component with create page

Both `/company/create` and `/company/edit/:id` render `CompanyCreatePage`. Edit mode is detected via `useParams<{ id? }>()`. The component uses a `populated` flag (boolean state) to ensure `useEffect` only runs the pre-population logic once, preventing re-population on subsequent re-renders.

### 8.6 — Tariff/Service Plan naming convention

Provisioning auto-creates Sippy objects using this convention:

| Object | Pattern | Example for shortCode "ACME" |
|---|---|---|
| Tariff | `{shortCode}-TARIFF` | `ACME-TARIFF` |
| Service Plan | `{shortCode}-SP` | `ACME-SP` |

Both have duplicate guards: if an object with the same name already exists, the existing one is reused. This makes provisioning idempotent — re-running it will not create duplicate Sippy objects.

### 8.7 — i_customer must always be 1

Never pass `i_customer = 2` (RTST1) to `createAccount`. All BitsAuto-provisioned accounts must be under `i_customer = 1` (ssp-root). This is enforced in both the wizard submit route and the provision route.

---

## 9. Sidebar Registration

Add to `client/src/components/layout-shell.tsx` in the appropriate section:

```typescript
// CLIENT OPERATIONS section
{ href: '/company/list',   label: 'Companies',       icon: Building2, iconColor: 'text-blue-300' },
{ href: '/company/create', label: 'Create Company',  icon: Plus,      iconColor: 'text-amber-300' },
{ href: '/client/wizard',  label: 'New Client',      icon: Users,     iconColor: 'text-violet-300' },
```

---

*Document Version 2.0 — Updated May 2026*  
*Bitsauto Monitoring Platform — Account Management module.*  
*For questions, contact the platform administrator.*

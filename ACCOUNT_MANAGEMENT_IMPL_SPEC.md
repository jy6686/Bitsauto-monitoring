# Account Management Module — Technical Implementation Specification
## Bitsauto Monitoring Platform — Developer Reference

**Purpose:** This document contains the complete, verbatim source code and integration instructions for the Account Management module. A developer or AI agent can reconstruct the entire module from scratch using this document alone.

**Stack:** React + TypeScript (Vite), Express, PostgreSQL (Drizzle ORM), TailwindCSS, shadcn/ui, TanStack Query v5, Wouter routing  
**Document Version:** 1.0 — May 2026

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

Add the following four table definitions to the end of `shared/schema.ts`. Requires these imports already present:
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

### 3.5 — SQL to create tables directly (if db:push is blocked)

```sql
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
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255)
);

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

### Full route code block

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

app.put('/api/companies/:id',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });
      const updated = await storage.updateCompany(id, req.body);
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

// ── Account Management — Client IP Approval Requests ─────────────────────────

app.get('/api/client-ip-requests',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const rows = await storage.getClientIpRequests();
      res.json({ requests: rows });
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

// ── Account Management — Client Wizard Submit ─────────────────────────────────
// NOTE: This route calls sippy.pushAccountToSippy() — a Sippy-specific function.
// For a generic app, replace this with your own account creation logic.
// The key constraint: always pass iCustomer = 1 (root), never 2 (RTST1).

app.post('/api/client-wizard/submit',
  (req: any, res: any, next: any) => requireRole(['admin','management'], req, res, next),
  async (req: any, res) => {
    try {
      const { step1, step2, trunks, ips, authRules, validRules, iCustomer = 1 } = req.body ?? {};
      if (!step1?.userId?.trim()) return res.status(400).json({ message: 'User ID is required' });
      const settings = await storage.getSettings();
      const { username, password } = sippyXmlCreds(settings as any);
      const portalUrl = sippyPortalUrl(settings as any);
      const primaryTrunk = trunks?.[0] ?? {};
      const result = await sippy.pushAccountToSippy({
        name: step1.userId,
        type: 'client',
        username: step1.userId,
        voipPassword: step1.password,
        webPassword: step1.password,
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
      res.json(result);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
```

---

## 6. Frontend — Page Files

### 6.1 — `client/src/pages/company-list.tsx`

```tsx
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Plus, Search, Pencil, Trash2, Users, Globe, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

const TYPE_COLOR: Record<string, string> = {
  retail:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
  wholesale: "bg-violet-500/10 text-violet-400 border-violet-500/20",
};
const CONTRACT_COLOR: Record<string, string> = {
  client:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
  vendor:    "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  bilateral: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};
const STATUS_COLOR: Record<string, string> = {
  active:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  inactive: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

export default function CompanyListPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ companies: Company[] }>({
    queryKey: ["/api/companies"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/companies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const companies = (data?.companies ?? []).filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.shortCode ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.kam ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-blue-400" />
          <h1 className="text-xl font-semibold">Companies</h1>
          <Badge variant="outline" className="text-xs">{companies.length}</Badge>
        </div>
        <Link href="/company/create">
          <Button data-testid="btn-create-company" size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> New Company
          </Button>
        </Link>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          data-testid="input-search-company"
          placeholder="Search by name, code, KAM…"
          className="pl-8 h-8 text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-32" />
            </Card>
          ))}
        </div>
      ) : companies.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {search ? "No companies match your search." : "No companies yet."}
            </p>
            {!search && (
              <Link href="/company/create">
                <Button size="sm" className="mt-4 gap-1.5">
                  <Plus className="h-4 w-4" /> Create First Company
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map(c => (
            <Card key={c.id} data-testid={`card-company-${c.id}`} className="hover:border-border/80 transition-colors">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm font-semibold truncate">{c.name}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.shortCode}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${STATUS_COLOR[c.status] ?? ""}`}>
                    {c.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className={`text-[10px] ${TYPE_COLOR[c.companyType] ?? ""}`}>
                    {c.companyType}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${CONTRACT_COLOR[c.contractType] ?? ""}`}>
                    {c.contractType}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {c.kam && (
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3 w-3 shrink-0" />
                      <span className="truncate">{c.kam}</span>
                    </div>
                  )}
                  {c.country && (
                    <div className="flex items-center gap-1.5">
                      <Globe className="h-3 w-3 shrink-0" />
                      <span>{c.country}</span>
                    </div>
                  )}
                  {c.currency && (
                    <div className="flex items-center gap-1.5">
                      <CreditCard className="h-3 w-3 shrink-0" />
                      <span>{c.currency} · {c.paymentTerm}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Link href={`/company/edit/${c.id}`}>
                    <Button data-testid={`btn-edit-company-${c.id}`} size="sm" variant="outline" className="h-7 text-xs gap-1">
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                  </Link>
                  <Button
                    data-testid={`btn-delete-company-${c.id}`}
                    size="sm" variant="ghost"
                    className="h-7 text-xs gap-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                    onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id); }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 6.2 — `client/src/pages/company-create.tsx`

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronRight, ChevronLeft, CheckCircle2, Plus, Trash2 } from "lucide-react";
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

export default function CompanyCreatePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string,string>>({});

  const [basic, setBasic] = useState({
    name:"", shortCode:"", country:"", kam:"", status:"active",
    companyType:"retail", contractType:"bilateral", department:"retail",
    team:"", clientTimezone:"", vendorTimezone:"", currency:"USD",
  });
  const [billing, setBilling] = useState({
    vendorBillingCycle:"weekly_cutoff", vendorGracePeriod:3, vendorCreditLimit:0, disputeOverPct:0,
    clientBillingCycle:"weekly_cutoff", clientGracePeriod:3, clientCreditLimit:0, disputeOverVal:0,
    paymentTerm:"prepaid", legalNameCi:"", legalNameVen:"", invoiceEmail:"",
  });
  const [contacts, setContacts] = useState<Record<string,Contact[]>>({
    technical:[emptyContact()], finance:[emptyContact()], commercial:[emptyContact()], billing:[emptyContact()],
  });
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);

  const { data: usersData } = useQuery<{ users: { username: string; displayName?: string }[] }>({
    queryKey: ["/api/users"],
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/companies", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company created successfully" });
      navigate("/company/list");
    },
    onError: (e: any) => toast({ title: e.message || "Failed to create company", variant: "destructive" }),
  });

  const setB = (k: string, v: any) => setBasic(p => ({ ...p, [k]: v }));
  const setBl = (k: string, v: any) => setBilling(p => ({ ...p, [k]: v }));

  const updateContact = (type: string, idx: number, k: keyof Contact, v: string) => {
    setContacts(p => { const arr = [...p[type]]; arr[idx] = { ...arr[idx], [k]: v }; return { ...p, [type]: arr }; });
  };
  const addContact = (type: string) => setContacts(p => ({ ...p, [type]: [...p[type], emptyContact()] }));
  const removeContact = (type: string, idx: number) => setContacts(p => ({ ...p, [type]: p[type].filter((_,i) => i !== idx) }));

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
    createMutation.mutate({ basic, billing, contacts: pocContacts, bankAccounts });
  };

  const field = (label: string, key: string, value: string, onChange: (v: string) => void, required = false, type = "text") => (
    <div className="space-y-1.5" key={key}>
      <Label className="text-xs">{label}{required && <span className="text-rose-400 ml-0.5">*</span>}</Label>
      <Input
        data-testid={`input-${key}`}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`h-8 text-sm ${errors[key] ? "border-rose-500" : ""}`}
      />
      {errors[key] && <p className="text-[10px] text-rose-400">{errors[key]}</p>}
    </div>
  );

  const selectField = (label: string, key: string, value: string, onChange: (v: string) => void, options: string[], labels?: Record<string,string>, required = false) => (
    <div className="space-y-1.5" key={key}>
      <Label className="text-xs">{label}{required && <span className="text-rose-400 ml-0.5">*</span>}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={`select-${key}`} className="h-8 text-sm">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o} value={o}>{labels?.[o] ?? o.charAt(0).toUpperCase() + o.slice(1)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-blue-400" />
        <h1 className="text-xl font-semibold">Create New Company</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              step === s.id ? "bg-blue-500/10 border-blue-500/30 text-blue-400" :
              step > s.id ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
              "border-border text-muted-foreground"
            }`}>
              {step > s.id ? <CheckCircle2 className="h-3 w-3" /> : <span>{s.id}</span>}
              {s.label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <div className="w-full bg-border/30 rounded-full h-1.5">
        <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{STEPS[step-1].label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* STEP 1 — Basic Information */}
          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {field("Company Name", "name", basic.name, v => setB("name", v), true)}
              {field("Short Code", "shortCode", basic.shortCode, v => setB("shortCode", v.toUpperCase()), true)}
              {selectField("Country", "country", basic.country, v => setB("country", v), COUNTRIES)}
              <div className="space-y-1.5">
                <Label className="text-xs">KAM (Account Manager)<span className="text-rose-400 ml-0.5">*</span></Label>
                <Select value={basic.kam} onValueChange={v => setB("kam", v)}>
                  <SelectTrigger data-testid="select-kam" className="h-8 text-sm"><SelectValue placeholder="Select KAM…" /></SelectTrigger>
                  <SelectContent>
                    {(usersData?.users ?? []).map(u => <SelectItem key={u.username} value={u.username}>{u.displayName || u.username}</SelectItem>)}
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {selectField("Status", "status", basic.status, v => setB("status", v), ["active","inactive"])}
              {selectField("Company Type", "companyType", basic.companyType, v => setB("companyType", v), COMPANY_TYPES, undefined, true)}
              {selectField("Contract Type", "contractType", basic.contractType, v => setB("contractType", v), CONTRACT_TYPES, undefined, true)}
              {selectField("Department", "department", basic.department, v => setB("department", v), DEPARTMENTS, undefined, true)}
              {field("Team", "team", basic.team, v => setB("team", v))}
              {selectField("Client Timezone", "clientTimezone", basic.clientTimezone, v => setB("clientTimezone", v), TIMEZONES)}
              {selectField("Vendor Timezone", "vendorTimezone", basic.vendorTimezone, v => setB("vendorTimezone", v), TIMEZONES)}
              {selectField("Currency", "currency", basic.currency, v => setB("currency", v), CURRENCIES, undefined, true)}
            </div>
          )}

          {/* STEP 2 — Billing Information */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wide text-[10px]">Vendor Billing</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {selectField("Vendor Billing Cycle", "vendorBillingCycle", billing.vendorBillingCycle, v => setBl("vendorBillingCycle", v), BILLING_CYCLES, BILLING_CYCLE_LABELS, true)}
                  <div className="space-y-1.5"><Label className="text-xs">Vendor Grace Period (days)<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-vendorGracePeriod" type="number" className="h-8 text-sm" value={billing.vendorGracePeriod} onChange={e => setBl("vendorGracePeriod", Number(e.target.value))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Vendor Credit Limit<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-vendorCreditLimit" type="number" className="h-8 text-sm" value={billing.vendorCreditLimit} onChange={e => setBl("vendorCreditLimit", Number(e.target.value))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Dispute Over %<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-disputeOverPct" type="number" className="h-8 text-sm" value={billing.disputeOverPct} onChange={e => setBl("disputeOverPct", Number(e.target.value))} /></div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wide text-[10px]">Client Billing</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {selectField("Client Billing Cycle", "clientBillingCycle", billing.clientBillingCycle, v => setBl("clientBillingCycle", v), BILLING_CYCLES, BILLING_CYCLE_LABELS, true)}
                  <div className="space-y-1.5"><Label className="text-xs">Client Grace Period (days)<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-clientGracePeriod" type="number" className="h-8 text-sm" value={billing.clientGracePeriod} onChange={e => setBl("clientGracePeriod", Number(e.target.value))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Client Credit Limit<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-clientCreditLimit" type="number" className="h-8 text-sm" value={billing.clientCreditLimit} onChange={e => setBl("clientCreditLimit", Number(e.target.value))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Dispute Over Value<span className="text-rose-400 ml-0.5">*</span></Label><Input data-testid="input-disputeOverVal" type="number" className="h-8 text-sm" value={billing.disputeOverVal} onChange={e => setBl("disputeOverVal", Number(e.target.value))} /></div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wide text-[10px]">Payment & Legal</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {selectField("Payment Term", "paymentTerm", billing.paymentTerm, v => setBl("paymentTerm", v), PAYMENT_TERMS)}
                  {field("Legal Name — Client Invoice", "legalNameCi", billing.legalNameCi, v => setBl("legalNameCi", v))}
                  {field("Legal Name — Vendor Invoice", "legalNameVen", billing.legalNameVen, v => setBl("legalNameVen", v))}
                  {field("Invoice Email", "invoiceEmail", billing.invoiceEmail, v => setBl("invoiceEmail", v), false, "email")}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 — Contacts & Bank */}
          {step === 3 && (
            <div className="space-y-6">
              {(["technical","finance","commercial","billing"] as const).map(type => (
                <div key={type} className="border border-border/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium capitalize">{type} Contacts</h3>
                    <Button data-testid={`btn-add-contact-${type}`} size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => addContact(type)}>
                      <Plus className="h-3 w-3" /> Add More
                    </Button>
                  </div>
                  {contacts[type].map((c, idx) => (
                    <div key={idx} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                      <div className="space-y-1"><Label className="text-[10px]">First Name<span className="text-rose-400">*</span></Label><Input data-testid={`input-${type}-firstname-${idx}`} className="h-7 text-xs" value={c.firstName} onChange={e => updateContact(type, idx, "firstName", e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Last Name</Label><Input data-testid={`input-${type}-lastname-${idx}`} className="h-7 text-xs" value={c.lastName} onChange={e => updateContact(type, idx, "lastName", e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Email<span className="text-rose-400">*</span></Label><Input data-testid={`input-${type}-email-${idx}`} type="email" className="h-7 text-xs" value={c.email} onChange={e => updateContact(type, idx, "email", e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Phone</Label><Input data-testid={`input-${type}-phone-${idx}`} className="h-7 text-xs" value={c.phone} onChange={e => updateContact(type, idx, "phone", e.target.value)} /></div>
                      <Button data-testid={`btn-remove-contact-${type}-${idx}`} size="sm" variant="ghost" className="h-7 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 mt-4" disabled={contacts[type].length === 1} onClick={() => removeContact(type, idx)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              ))}
              <div className="border border-border/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Bank Information <span className="text-xs text-muted-foreground">(optional)</span></h3>
                  <Button data-testid="btn-add-bank" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setBankAccounts(p => [...p, emptyBank()])}>
                    <Plus className="h-3 w-3" /> Add Bank
                  </Button>
                </div>
                {bankAccounts.map((b, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 border border-border/30 rounded p-3">
                    <div className="space-y-1"><Label className="text-[10px]">Bank Name<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-name-${idx}`} className="h-7 text-xs" value={b.bankName} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, bankName:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Account Title<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-title-${idx}`} className="h-7 text-xs" value={b.accountTitle} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, accountTitle:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Account No.<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-no-${idx}`} className="h-7 text-xs" value={b.accountNo} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, accountNo:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Swift Code<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-swift-${idx}`} className="h-7 text-xs" value={b.swiftCode} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, swiftCode:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">IBAN</Label><Input data-testid={`input-bank-iban-${idx}`} className="h-7 text-xs" value={b.iban} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, iban:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Country<span className="text-rose-400">*</span></Label><Input data-testid={`input-bank-country-${idx}`} className="h-7 text-xs" value={b.country} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, country:e.target.value} : x))} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Currency</Label>
                      <Select value={b.currency} onValueChange={v => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, currency:v} : x))}>
                        <SelectTrigger data-testid={`select-bank-currency-${idx}`} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end"><Button data-testid={`btn-remove-bank-${idx}`} size="sm" variant="ghost" className="h-7 text-rose-400 hover:text-rose-300" onClick={() => setBankAccounts(p => p.filter((_,i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button></div>
                    <div className="space-y-1 col-span-2"><Label className="text-[10px]">Address</Label><Input data-testid={`input-bank-address-${idx}`} className="h-7 text-xs" value={b.address} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, address:e.target.value} : x))} /></div>
                    <div className="space-y-1 col-span-2"><Label className="text-[10px]">Remarks</Label><Input data-testid={`input-bank-remarks-${idx}`} className="h-7 text-xs" value={b.remarks} onChange={e => setBankAccounts(p => p.map((x,i) => i===idx ? {...x, remarks:e.target.value} : x))} /></div>
                  </div>
                ))}
                {bankAccounts.length === 0 && <p className="text-xs text-muted-foreground">No bank accounts added yet.</p>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button data-testid="btn-wizard-back" variant="outline" onClick={back} disabled={step === 1} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {step < 3 ? (
          <Button data-testid="btn-wizard-next" onClick={next} className="gap-1.5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button data-testid="btn-wizard-submit" onClick={handleSubmit} disabled={createMutation.isPending} className="gap-1.5">
            {createMutation.isPending ? "Creating…" : "Create Company"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

### 6.3 — `client/src/pages/client-wizard.tsx`

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Users, ChevronRight, ChevronLeft, CheckCircle2, Plus, Trash2,
  AlertTriangle, Clock, ShieldCheck, Server, Network, FileText,
  ShieldAlert, Loader2, Info, Eye, EyeOff
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

const STEPS = [
  { id: 1, label: "Department & Company",  icon: Users },
  { id: 2, label: "Rate Sheet Config",     icon: FileText },
  { id: 3, label: "Technical Config",      icon: Server },
  { id: 4, label: "IPs & Trunks",          icon: Network },
  { id: 5, label: "Auth Rules",            icon: ShieldCheck },
  { id: 6, label: "Validation Rules",      icon: ShieldAlert },
  { id: 7, label: "Review & Submit",       icon: CheckCircle2 },
];

const CODECS = [
  { value: "none", label: "None / Disabled" },
  { value: "0",    label: "G.711u (PCMU)" },
  { value: "8",    label: "G.711a (PCMA)" },
  { value: "9",    label: "G.722" },
  { value: "18",   label: "G.729" },
  { value: "3",    label: "GSM" },
  { value: "4",    label: "G.723" },
  { value: "15",   label: "G.728" },
];

const TRUNKS = ["PREMIUM","STANDARD PLUS","STANDARD","BUSINESS","CHARLIE"];
const RELAY_TYPES = [{ v:"0", l:"Default" },{ v:"1", l:"Always Relay" },{ v:"2", l:"Never Relay" }];
const INVOICE_TEMPLATES = ["Standard","Retail","Wholesale","Custom"];
const SHEET_FORMATS = ["Full CSV","Excel XLSX","PDF","Partial Update","A2Z"];

function genPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

interface TrunkConfig {
  trunkName: string; routingGroupId: string; maxTime: string; maxSessions: string;
  maxCps: string; codec: string; useCodecOnly: boolean; lifetime: string;
  relayType: string; cldTranslation: string; assertedIdRule: string;
  useAssertedId: boolean; preventLoops: boolean; allowRegistration: boolean; blocked: boolean;
}
interface IpEntry { ip: string; trunk: string; description: string; status: string; }
interface AuthRule { trunk: string; ip: string; authType: string; techPrefix: string; cliRule: string; trustCli: boolean; }
interface ValidationRule { type: string; pattern: string; action: string; }

const emptyTrunk = (): TrunkConfig => ({
  trunkName:"", routingGroupId:"", maxTime:"3600", maxSessions:"0", maxCps:"",
  codec:"none", useCodecOnly:false, lifetime:"never", relayType:"0",
  cldTranslation:"s/^//", assertedIdRule:"", useAssertedId:false,
  preventLoops:false, allowRegistration:true, blocked:false,
});
const emptyIp = (): IpEntry => ({ ip:"", trunk:"", description:"", status:"pending" });
const emptyAuth = (): AuthRule => ({ trunk:"", ip:"", authType:"ip", techPrefix:"", cliRule:"", trustCli:false });
const emptyRule = (): ValidationRule => ({ type:"cli_format", pattern:"", action:"block" });

export default function ClientWizardPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [showPass, setShowPass] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [createdAccountId, setCreatedAccountId] = useState<number | null>(null);

  const [s1, setS1] = useState({ department:"retail", companyId:"", password:genPassword(), userId:"", notifEmailTo:"", notifEmailCc:"", balanceThreshold:"", a2zNotif:"no", rateNotif:"full_sheet" });
  const [s2, setS2] = useState({ invoiceTemplate:"Standard", ratesheetFull:"Full CSV", ratesheetPartial:"Partial Update", ratesheetAtoz:"A2Z", dialcodeFormat:"E.164", prefixStyle:"with_plus" });
  const [trunks, setTrunks] = useState<TrunkConfig[]>([emptyTrunk()]);
  const [ips, setIps] = useState<IpEntry[]>([emptyIp()]);
  const [authRules, setAuthRules] = useState<AuthRule[]>([emptyAuth()]);
  const [validRules, setValidRules] = useState<ValidationRule[]>([]);

  const { data: companiesData } = useQuery<{ companies: Company[] }>({ queryKey: ["/api/companies"] });
  const { data: routingData } = useQuery<{ groups: { id: number; name: string }[] }>({
    queryKey: ["/api/sippy/routing-groups"],
    retry: false,
  });

  const { data: ipRequestsData } = useQuery<{ requests: { ipAddress: string; status: string; trunk: string }[] }>({
    queryKey: ["/api/client-ip-requests"],
    enabled: step === 5,
  });

  const submitIpMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-ip-requests", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-ip-requests"] });
      toast({ title: "IP submitted for approval" });
    },
  });

  const createClientMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/client-wizard/submit", payload),
    onSuccess: (data: any) => {
      setCreatedAccountId(data?.iAccount ?? null);
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Client account created in Sippy" });
    },
    onError: (e: any) => toast({ title: e.message || "Failed to create account", variant: "destructive" }),
  });

  const companies = companiesData?.companies ?? [];
  const routingGroups = routingData?.groups ?? [];
  const selectedCompany = companies.find(c => String(c.id) === s1.companyId);
  const ipRequests = ipRequestsData?.requests ?? [];
  const approvedIps = ipRequests.filter(r => r.status === "approved").map(r => r.ipAddress);
  const pendingIps = ipRequests.filter(r => r.status === "pending");

  const validate = () => {
    const errs: Record<string,string> = {};
    if (step === 1) {
      if (!s1.companyId) errs.companyId = "Company is required";
      if (!s1.userId.trim()) errs.userId = "User ID is required";
      if (!s1.password.trim()) errs.password = "Password is required";
    }
    if (step === 3) {
      trunks.forEach((t, i) => {
        if (!t.routingGroupId) errs[`rg_${i}`] = "Routing group required";
      });
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validate()) setStep(s => Math.min(s + 1, 7)); };
  const back = () => setStep(s => Math.max(s - 1, 1));
  const updateTrunk = (idx: number, k: keyof TrunkConfig, v: any) =>
    setTrunks(p => p.map((t, i) => i === idx ? { ...t, [k]: v } : t));
  const routingGroupHealthy = (rgId: string) => rgId && routingGroups.some(g => String(g.id) === rgId);

  const handleSubmit = () => {
    const validIps = ips.filter(ip => ip.ip.trim());
    const pendingIpList = validIps.filter(ip => !approvedIps.includes(ip.ip));
    if (pendingIpList.length > 0) {
      toast({ title: "IPs pending approval — submit them for review first", variant: "destructive" });
      return;
    }
    createClientMutation.mutate({ step1: s1, step2: s2, trunks, ips: validIps, authRules, validRules, iCustomer: 1 });
  };

  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-semibold">Client Account Created</h2>
            {createdAccountId && <p className="text-sm text-muted-foreground">Sippy Account ID: <span className="font-mono text-foreground">{createdAccountId}</span></p>}
            <div className="text-left space-y-2 mt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Post-Creation Checklist</p>
              {[
                { done: true,  label: "Company record exists in BitsAuto" },
                { done: true,  label: "Client account created in Sippy (i_customer = 1, root level)" },
                { done: true,  label: "Added to BitsAuto monitoring" },
                { done: false, label: "Verify routing group has active vendor connections for target destinations" },
                { done: false, label: "Confirm rate sheet delivered to client email" },
                { done: false, label: "Run test call from new account" },
                { done: false, label: "Check CDR after test call" },
                { done: false, label: "Confirm balance threshold alerts working" },
              ].map((item, i) => (
                <div key={i} className={`flex items-center gap-2 text-sm ${item.done ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {item.done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <div className="h-3.5 w-3.5 shrink-0 border border-muted-foreground/30 rounded-full" />}
                  {item.label}
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/company/list")}>View Companies</Button>
              <Button size="sm" onClick={() => { setSubmitted(false); setStep(1); }}>Create Another</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-amber-400" />
        <h1 className="text-xl font-semibold">Create Client Account</h1>
        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">Root Level — Not under RTST1</Badge>
      </div>

      {/* Step tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => step > s.id && setStep(s.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                step === s.id ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                step > s.id ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-pointer" :
                "border-border text-muted-foreground"
              }`}
            >
              {step > s.id ? <CheckCircle2 className="h-3 w-3" /> : <span>{s.id}</span>}
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
          </div>
        ))}
      </div>

      <div className="w-full bg-border/30 rounded-full h-1">
        <div className="bg-amber-500 h-1 rounded-full transition-all" style={{ width: `${(step / 7) * 100}%` }} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {(() => { const S = STEPS[step-1]; return <S.icon className="h-4 w-4 text-amber-400" />; })()}
            {STEPS[step-1].label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* STEP 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Department<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Select value={s1.department} onValueChange={v => setS1(p => ({ ...p, department: v, companyId: "" }))}>
                    <SelectTrigger data-testid="select-department" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retail">Retail</SelectItem>
                      <SelectItem value="wholesale">Wholesale</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                      <SelectItem value="carrier">Carrier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Company<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Select value={s1.companyId} onValueChange={v => {
                    const co = companies.find(c => String(c.id) === v);
                    setS1(p => ({ ...p, companyId: v, userId: co ? co.shortCode.toLowerCase() : "" }));
                  }}>
                    <SelectTrigger data-testid="select-company" className={`h-8 text-sm ${errors.companyId ? "border-rose-500" : ""}`}><SelectValue placeholder="Select company…" /></SelectTrigger>
                    <SelectContent>
                      {companies.filter(c => !s1.department || c.department === s1.department || c.companyType === s1.department).map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name} <span className="text-muted-foreground text-[10px]">({c.shortCode})</span></SelectItem>
                      ))}
                      {companies.length === 0 && <SelectItem value="_none" disabled>No companies — create one first</SelectItem>}
                    </SelectContent>
                  </Select>
                  {errors.companyId && <p className="text-[10px] text-rose-400">{errors.companyId}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">User ID<span className="text-rose-400 ml-0.5">*</span></Label>
                  <Input data-testid="input-userId" className={`h-8 text-sm ${errors.userId ? "border-rose-500" : ""}`} value={s1.userId} onChange={e => setS1(p => ({ ...p, userId: e.target.value }))} placeholder="Auto-generated from company" />
                  {errors.userId && <p className="text-[10px] text-rose-400">{errors.userId}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password<span className="text-rose-400 ml-0.5">*</span></Label>
                  <div className="relative">
                    <Input data-testid="input-password" type={showPass ? "text" : "password"} className="h-8 text-sm pr-8" value={s1.password} onChange={e => setS1(p => ({ ...p, password: e.target.value }))} />
                    <button type="button" className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" onClick={() => setShowPass(p => !p)}>
                      {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <button type="button" className="text-[10px] text-blue-400 hover:underline" onClick={() => setS1(p => ({ ...p, password: genPassword() }))}>Re-generate</button>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notification Email (To)</Label>
                  <Input data-testid="input-notifEmailTo" type="email" className="h-8 text-sm" value={s1.notifEmailTo} onChange={e => setS1(p => ({ ...p, notifEmailTo: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notification Email (CC)</Label>
                  <Input data-testid="input-notifEmailCc" type="email" className="h-8 text-sm" value={s1.notifEmailCc} onChange={e => setS1(p => ({ ...p, notifEmailCc: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Balance Threshold Alert</Label>
                  <Input data-testid="input-balanceThreshold" type="number" className="h-8 text-sm" value={s1.balanceThreshold} onChange={e => setS1(p => ({ ...p, balanceThreshold: e.target.value }))} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">A2Z Notification</Label>
                  <Select value={s1.a2zNotif} onValueChange={v => setS1(p => ({ ...p, a2zNotif: v }))}>
                    <SelectTrigger data-testid="select-a2zNotif" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!s1.companyId && (
                <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  No company selected. <a href="/company/create" className="underline">Create a company first</a> if the list is empty.
                </div>
              )}
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {([
                ["invoiceTemplate", "Invoice Template", INVOICE_TEMPLATES],
                ["ratesheetFull", "Full Rate Sheet Format", SHEET_FORMATS],
                ["ratesheetPartial", "Partial Rate Sheet Format", SHEET_FORMATS],
                ["ratesheetAtoz", "A2Z Rate Sheet Format", SHEET_FORMATS],
                ["dialcodeFormat", "Dialcode Format", ["E.164","National","Local"]],
                ["prefixStyle", "Prefix Style", ["with_plus","without_plus"]],
              ] as [keyof typeof s2, string, string[]][]).map(([key, label, opts]) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-xs">{label}</Label>
                  <Select value={s2[key]} onValueChange={v => setS2(p => ({ ...p, [key]: v }))}>
                    <SelectTrigger data-testid={`select-${key}`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{opts.map(o => <SelectItem key={o} value={o}>{o.replace("_"," ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Routing Group is required. Leaving it blank causes the account to inherit from the parent customer — root cause of "No Route Found" errors.
              </div>
              {trunks.map((t, idx) => (
                <div key={idx} className="border border-border/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Trunk {idx + 1}</h3>
                    {trunks.length > 1 && (
                      <Button size="sm" variant="ghost" className="h-7 text-rose-400 text-xs" onClick={() => setTrunks(p => p.filter((_,i) => i !== idx))}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Trunk / Switch Name</Label>
                      <Input data-testid={`input-trunk-name-${idx}`} className="h-8 text-sm" value={t.trunkName} onChange={e => updateTrunk(idx, "trunkName", e.target.value)} placeholder="e.g. SB-1 PREMIUM" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Default Routing Group<span className="text-rose-400 ml-0.5">*</span></Label>
                      <Select value={t.routingGroupId} onValueChange={v => updateTrunk(idx, "routingGroupId", v)}>
                        <SelectTrigger data-testid={`select-rg-${idx}`} className={`h-8 text-sm ${errors[`rg_${idx}`] ? "border-rose-500" : ""}`}><SelectValue placeholder="Select group…" /></SelectTrigger>
                        <SelectContent>
                          {routingGroups.map(rg => <SelectItem key={rg.id} value={String(rg.id)}>{rg.name}</SelectItem>)}
                          {routingGroups.length === 0 && <SelectItem value="_none" disabled>Loading groups…</SelectItem>}
                        </SelectContent>
                      </Select>
                      {t.routingGroupId && routingGroupHealthy(t.routingGroupId) && (
                        <p className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Group found</p>
                      )}
                      {errors[`rg_${idx}`] && <p className="text-[10px] text-rose-400">{errors[`rg_${idx}`]}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Max Call Time (s)</Label>
                      <Input data-testid={`input-maxTime-${idx}`} type="number" className="h-8 text-sm" value={t.maxTime} onChange={e => updateTrunk(idx, "maxTime", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Max Sessions (0=unlimited)</Label>
                      <Input data-testid={`input-maxSessions-${idx}`} type="number" className="h-8 text-sm" value={t.maxSessions} onChange={e => updateTrunk(idx, "maxSessions", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Max CPS</Label>
                      <Input data-testid={`input-maxCps-${idx}`} type="number" className="h-8 text-sm" value={t.maxCps} onChange={e => updateTrunk(idx, "maxCps", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Preferred Codec</Label>
                      <Select value={t.codec} onValueChange={v => updateTrunk(idx, "codec", v)}>
                        <SelectTrigger data-testid={`select-codec-${idx}`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>{CODECS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Media Relay Type</Label>
                      <Select value={t.relayType} onValueChange={v => updateTrunk(idx, "relayType", v)}>
                        <SelectTrigger data-testid={`select-relay-${idx}`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>{RELAY_TYPES.map(r => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">CLD Translation Rule</Label>
                      <Input data-testid={`input-cldRule-${idx}`} className="h-8 text-sm font-mono" value={t.cldTranslation} onChange={e => updateTrunk(idx, "cldTranslation", e.target.value)} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 pt-1">
                    {([
                      ["useCodecOnly", "Use Preferred Codec Only"],
                      ["preventLoops", "Prevent Call Loops"],
                      ["allowRegistration", "Allow Registration"],
                      ["blocked", "Blocked"],
                    ] as [keyof TrunkConfig, string][]).map(([k, lbl]) => (
                      <div key={k} className="flex items-center gap-1.5">
                        <Checkbox
                          data-testid={`check-${k}-${idx}`}
                          id={`${k}-${idx}`}
                          checked={!!t[k]}
                          onCheckedChange={v => updateTrunk(idx, k, !!v)}
                        />
                        <label htmlFor={`${k}-${idx}`} className="text-xs cursor-pointer">{lbl}</label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <Button data-testid="btn-add-trunk" size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setTrunks(p => [...p, emptyTrunk()])}>
                <Plus className="h-3 w-3" /> Add Another Trunk
              </Button>
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">Client IP Addresses</h3>
                  <Button data-testid="btn-add-ip" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setIps(p => [...p, emptyIp()])}>
                    <Plus className="h-3 w-3" /> Add IP
                  </Button>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-md border border-blue-500/30 bg-blue-500/5 text-blue-400 text-xs mb-3">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Each IP must be submitted for approval before authentication rules can be created.
                </div>
                {ips.map((ip, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end mb-2">
                    <div className="space-y-1">
                      <Label className="text-[10px]">IP Address<span className="text-rose-400">*</span></Label>
                      <Input data-testid={`input-ip-${idx}`} className="h-7 text-xs font-mono" value={ip.ip} onChange={e => setIps(p => p.map((x,i) => i===idx ? {...x, ip:e.target.value} : x))} placeholder="192.168.1.1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Trunk</Label>
                      <Select value={ip.trunk} onValueChange={v => setIps(p => p.map((x,i) => i===idx ? {...x, trunk:v} : x))}>
                        <SelectTrigger data-testid={`select-ip-trunk-${idx}`} className="h-7 text-xs"><SelectValue placeholder="Trunk…" /></SelectTrigger>
                        <SelectContent>{TRUNKS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Description</Label>
                      <Input data-testid={`input-ip-desc-${idx}`} className="h-7 text-xs" value={ip.description} onChange={e => setIps(p => p.map((x,i) => i===idx ? {...x, description:e.target.value} : x))} />
                    </div>
                    <div className="flex items-end gap-1">
                      <Button data-testid={`btn-submit-ip-${idx}`} size="sm" variant="outline" className="h-7 text-xs gap-1"
                        disabled={!ip.ip.trim() || submitIpMutation.isPending}
                        onClick={() => submitIpMutation.mutate({ clientName: selectedCompany?.name || s1.userId, companyId: s1.companyId || null, ipAddress: ip.ip, trunk: ip.trunk, description: ip.description })}>
                        <Clock className="h-3 w-3" /> Submit
                      </Button>
                      <Button data-testid={`btn-remove-ip-${idx}`} size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => setIps(p => p.filter((_,i) => i !== idx))} disabled={ips.length === 1}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-medium mb-3">Trunk Assignment</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {TRUNKS.map(t => (
                    <div key={t} className="flex items-center gap-1.5 border border-border/50 rounded p-2">
                      <Checkbox data-testid={`check-trunk-${t}`} id={`trunk-${t}`} />
                      <label htmlFor={`trunk-${t}`} className="text-xs cursor-pointer">{t}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 5 */}
          {step === 5 && (
            <div className="space-y-4">
              {pendingIps.length > 0 && (
                <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium"><Clock className="h-3.5 w-3.5" /> {pendingIps.length} IP(s) Pending Approval</div>
                  {pendingIps.map((r, i) => <div key={i} className="font-mono">{r.ipAddress} — awaiting review</div>)}
                  <div>Auth rules locked until approved. Check the <a href="/approvals" className="underline">Approval Queue</a>.</div>
                </div>
              )}
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Authentication Rules <span className="text-xs text-muted-foreground">(approved IPs only)</span></h3>
                <Button data-testid="btn-add-auth" size="sm" variant="outline" className="h-7 text-xs gap-1"
                  disabled={approvedIps.length === 0}
                  onClick={() => setAuthRules(p => [...p, emptyAuth()])}>
                  <Plus className="h-3 w-3" /> Add Rule
                </Button>
              </div>
              {approvedIps.length === 0 && pendingIps.length === 0 && (
                <p className="text-xs text-muted-foreground">No approved IPs yet. Submit IPs in Step 4 and wait for approval.</p>
              )}
              {authRules.map((r, idx) => (
                <div key={idx} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 items-end border border-border/30 rounded p-3">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Trunk</Label>
                    <Select value={r.trunk} onValueChange={v => setAuthRules(p => p.map((x,i) => i===idx ? {...x, trunk:v} : x))}>
                      <SelectTrigger data-testid={`select-auth-trunk-${idx}`} className="h-7 text-xs"><SelectValue placeholder="Trunk…" /></SelectTrigger>
                      <SelectContent>{TRUNKS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">IP Address</Label>
                    <Select value={r.ip} onValueChange={v => setAuthRules(p => p.map((x,i) => i===idx ? {...x, ip:v} : x))}>
                      <SelectTrigger data-testid={`select-auth-ip-${idx}`} className="h-7 text-xs"><SelectValue placeholder="IP…" /></SelectTrigger>
                      <SelectContent>{approvedIps.map(ip => <SelectItem key={ip} value={ip}>{ip}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Auth Type</Label>
                    <Select value={r.authType} onValueChange={v => setAuthRules(p => p.map((x,i) => i===idx ? {...x, authType:v} : x))}>
                      <SelectTrigger data-testid={`select-auth-type-${idx}`} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ip">IP Auth</SelectItem>
                        <SelectItem value="sip_digest">SIP Digest</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Tech Prefix</Label>
                    <Input data-testid={`input-auth-prefix-${idx}`} className="h-7 text-xs font-mono" value={r.techPrefix} onChange={e => setAuthRules(p => p.map((x,i) => i===idx ? {...x, techPrefix:e.target.value} : x))} placeholder="e.g. 101" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">CLI Rule</Label>
                    <Input data-testid={`input-auth-cli-${idx}`} className="h-7 text-xs" value={r.cliRule} onChange={e => setAuthRules(p => p.map((x,i) => i===idx ? {...x, cliRule:e.target.value} : x))} />
                  </div>
                  <div className="flex items-end gap-1">
                    <div className="flex items-center gap-1">
                      <Checkbox data-testid={`check-auth-trustcli-${idx}`} id={`trustcli-${idx}`} checked={r.trustCli} onCheckedChange={v => setAuthRules(p => p.map((x,i) => i===idx ? {...x, trustCli:!!v} : x))} />
                      <label htmlFor={`trustcli-${idx}`} className="text-[10px]">Trust CLI</label>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => setAuthRules(p => p.filter((_,i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STEP 6 */}
          {step === 6 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Validation Rules <span className="text-xs text-muted-foreground">(optional)</span></h3>
                <Button data-testid="btn-add-rule" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setValidRules(p => [...p, emptyRule()])}>
                  <Plus className="h-3 w-3" /> Add Rule
                </Button>
              </div>
              {validRules.length === 0 && <p className="text-xs text-muted-foreground">No validation rules added.</p>}
              {validRules.map((r, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end border border-border/30 rounded p-3">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Rule Type</Label>
                    <Select value={r.type} onValueChange={v => setValidRules(p => p.map((x,i) => i===idx ? {...x, type:v} : x))}>
                      <SelectTrigger data-testid={`select-rule-type-${idx}`} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cli_format">CLI Format</SelectItem>
                        <SelectItem value="cld_prefix">CLD Prefix</SelectItem>
                        <SelectItem value="geo_block">Geo Block</SelectItem>
                        <SelectItem value="time_window">Time Window</SelectItem>
                        <SelectItem value="max_attempts">Max Attempts</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Pattern / Value</Label>
                    <Input data-testid={`input-rule-pattern-${idx}`} className="h-7 text-xs font-mono" value={r.pattern} onChange={e => setValidRules(p => p.map((x,i) => i===idx ? {...x, pattern:e.target.value} : x))} placeholder="e.g. ^\+44" />
                  </div>
                  <div className="flex gap-2 items-end">
                    <div className="space-y-1 flex-1">
                      <Label className="text-[10px]">Action</Label>
                      <Select value={r.action} onValueChange={v => setValidRules(p => p.map((x,i) => i===idx ? {...x, action:v} : x))}>
                        <SelectTrigger data-testid={`select-rule-action-${idx}`} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="block">Block</SelectItem>
                          <SelectItem value="allow">Allow Only</SelectItem>
                          <SelectItem value="flag">Flag</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => setValidRules(p => p.filter((_,i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STEP 7 — Review */}
          {step === 7 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {[
                  { label:"Company", value: selectedCompany?.name || s1.companyId },
                  { label:"Department", value: s1.department },
                  { label:"User ID", value: s1.userId },
                  { label:"Customer Context", value: "i_customer = 1 (Root — not under RTST1)" },
                  { label:"Invoice Template", value: s2.invoiceTemplate },
                  { label:"Notification Email", value: s1.notifEmailTo || "—" },
                  { label:"Trunks Configured", value: `${trunks.length} trunk(s)` },
                  { label:"IPs Submitted", value: `${ips.filter(i => i.ip.trim()).length} IP(s)` },
                  { label:"Auth Rules", value: `${authRules.filter(r => r.ip).length} rule(s)` },
                  { label:"Validation Rules", value: `${validRules.length} rule(s)` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
                    <span className="text-xs font-medium">{value}</span>
                  </div>
                ))}
              </div>
              {trunks.map((t, i) => (
                <div key={i} className="border border-border/40 rounded p-3 text-xs space-y-1">
                  <div className="font-medium">{t.trunkName || `Trunk ${i+1}`}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-muted-foreground">
                    <span>RG: <span className={routingGroupHealthy(t.routingGroupId) ? "text-emerald-400" : "text-rose-400"}>{routingGroups.find(g => String(g.id) === t.routingGroupId)?.name || (t.routingGroupId ? t.routingGroupId : "⚠ Not set")}</span></span>
                    <span>Max Sessions: {t.maxSessions || "unlimited"}</span>
                    <span>Codec: {CODECS.find(c => c.value === t.codec)?.label || t.codec}</span>
                  </div>
                </div>
              ))}
              {pendingIps.length > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-md border border-rose-500/30 bg-rose-500/5 text-rose-400 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {pendingIps.length} IP(s) still pending approval. Approve them before submitting.
                </div>
              )}
              <div className="flex items-center gap-2 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-xs">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                This account will be created at root level (i_customer = 1) — not under RTST1.
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button data-testid="btn-wizard-back" variant="outline" onClick={back} disabled={step === 1} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {step < 7 ? (
          <Button data-testid="btn-wizard-next" onClick={next} className="gap-1.5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            data-testid="btn-wizard-submit"
            onClick={handleSubmit}
            disabled={createClientMutation.isPending || pendingIps.length > 0}
            className="gap-1.5"
          >
            {createClientMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating in Sippy…</> : "Create Client in Sippy"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

---

## 7. Sidebar Section — `client/src/components/layout-shell.tsx`

Add the following section object to the nav sections array, positioned between Client Operations and Vendor Operations:

```typescript
{
  key: 'account_mgmt',
  label: 'Account Management',
  roles: ['admin','management'],
  items: [
    { href: "/company/list",   label: "Companies",      icon: Building2, roles: ['admin','management'] },
    { href: "/company/create", label: "Create Company", icon: Plus,      roles: ['admin','management'] },
    { href: "/client/wizard",  label: "New Client",     icon: UserPlus,  roles: ['admin','management'], isNew: true },
  ],
},
```

**Required icon imports to add:**
```typescript
import { Building2, UserPlus } from "lucide-react";
// Plus is likely already imported
```

---

## 8. Router Registration — `client/src/App.tsx`

Add these four Route entries inside the Switch block. Requires these imports:

```typescript
import CompanyListPage   from "@/pages/company-list";
import CompanyCreatePage from "@/pages/company-create";
import ClientWizardPage  from "@/pages/client-wizard";
```

Routes to register:
```tsx
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
  {() => <ProtectedRoute component={ClientWizardPage} requiredRoles={['admin','management']} mgmtFeature="clients" />}
</Route>
```

**Note:** `ProtectedRoute` and `mgmtFeature` are patterns from this specific codebase. In a generic app, wrap the component in your own auth guard or render it directly inside a protected layout route.

---

## 9. Settings Page — Download Card Entry

To add the document download card, append one entry to the doc array in `client/src/pages/settings.tsx`:

```typescript
{
  label: "Account Management Workflow & Script",
  desc: "Complete operations reference — Company wizard (3 steps), Client Account wizard (7 steps), IP approval flow, Sippy XML-RPC parameters, codec IDs, post-creation checklist, error fixes, and full database schema.",
  href: "/api/download/account-management-workflow",
  color: "text-emerald-300",
  bg: "bg-emerald-500/10 border-emerald-500/20"
},
```

---

## 10. Known Caveats for Reimplementation

| Issue | Detail |
|---|---|
| `/api/client-wizard/submit` is Sippy-specific | Replace `sippy.pushAccountToSippy()` with your own account creation API call. The route structure and validation are reusable. |
| `requireRole` is not a factory | Must be called as `(req, res, next) => requireRole([...], req, res, next)` — see Section 2 |
| `ProtectedRoute` + `mgmtFeature` | Specific to this app's auth wrapping. In a new app use your own auth HOC or layout route guard. |
| `db:push` may fail interactively | Use the raw SQL in Section 3.5 instead, run via `psql` or the database console. |
| `/api/sippy/routing-groups` | Must be a working endpoint that returns `{ groups: { id, name }[] }`. Wire this up before the wizard is usable. |
| `apiRequest` helper | Available at `@/lib/queryClient` — used for all mutations. TanStack Query fetcher is set up globally so `queryKey` strings map directly to GET endpoints. |

---

*Document generated by Bitsauto Monitoring Platform.*  
*This file contains complete, verbatim production source code. Handle appropriately.*

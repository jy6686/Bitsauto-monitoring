/**
 * Pre-provision validation — Onboarding 2.0, Sprint 2.3 task 2.
 *
 * Validation is AUTOMATIC and is not an approval step. It asks nobody for a decision; it
 * refuses to provision when the prerequisites are not satisfied. Admin approval is the
 * separate, human act of clicking Provision after reading the summary this produces.
 *
 * The IP conflict check is the load-bearing one. When the IP-approval workflow was removed
 * it took a human gate with it — but conflict detection is a different control that merely
 * shared that workflow. Two customers authorised on the same IP is a live routing fault:
 * calls authenticate against the wrong account and bill the wrong customer. That check
 * therefore moves here rather than disappearing.
 */
import { db } from "../../db";
import { companies, clientIpRequests, ipSharingApprovals, companyContacts,
         provisioningProfiles, routingPackages, routingPackageEntries,
         notificationProfiles, rateCards,
         companyProducts, productRates } from "@shared/schema";
import { eq, and, ne, or, sql, inArray } from "drizzle-orm";
import { unmappedRoutingCells } from "./routing-group";
import { planAuthRuleSet } from "./auth-rule-set";
import { testEmailConfig } from "../../email";
import { checkIpv4 } from "@shared/ip";

export type CheckStatus = "pass" | "fail" | "warn";

export interface PreflightCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Present on failure: what the operator must do. Never a bare "invalid". */
  remedy?: string;
}

export interface PreflightResult {
  companyId: number;
  companyName: string;
  canProvision: boolean;
  checks: PreflightCheck[];
  /** The pre-flight summary an admin reads before a production-changing action. */
  summary: {
    tariffId: number | null;
    servicePlanId: number | null;
    ipCount: number;
    routeCount: number;
    ratePolicy: string | null;
    routingPackage: string | null;
    notificationProfile: string | null;
    trafficOnCompletion: "enabled";
  };
}

const pass = (key: string, label: string, detail: string): PreflightCheck =>
  ({ key, label, status: "pass", detail });
const fail = (key: string, label: string, detail: string, remedy: string): PreflightCheck =>
  ({ key, label, status: "fail", detail, remedy });
/** Does NOT block provisioning — for gaps that need a follow-up rather than a halt. */
const warn = (key: string, label: string, detail: string, remedy: string): PreflightCheck =>
  ({ key, label, status: "warn", detail, remedy });

export async function runPreflight(companyId: number): Promise<PreflightResult> {
  const [company]: any[] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error(`Company ${companyId} not found`);

  const checks: PreflightCheck[] = [];

  // ── Company completeness ──────────────────────────────────────────────────
  checks.push(company.name?.trim() && company.shortCode?.trim()
    ? pass("company", "Company details", `${company.name} (${company.shortCode})`)
    : fail("company", "Company details", "Name or short code missing",
           "Edit the company and supply both a name and a short code."));

  // ── Commercial objects (created at company creation) ──────────────────────
  checks.push(company.sippyITariff
    ? pass("tariff", "Tariff", `Sippy tariff ${company.sippyITariff}`)
    : fail("tariff", "Tariff", "No Sippy tariff linked to this company",
           "The tariff is created when the company is created. Re-run preparation, or check the Sippy connection."));

  checks.push(company.sippyIBillingPlan
    ? pass("service_plan", "Service Plan", `Sippy plan ${company.sippyIBillingPlan}`)
    : fail("service_plan", "Service Plan", "No Sippy service plan linked to this company",
           "The service plan is created with the company. Re-run preparation, or check the Sippy connection."));

  // ── Preparation package ───────────────────────────────────────────────────
  let routingPackageName: string | null = null;
  let routeCount = 0;
  if (company.routingPackageId) {
    const [rp]: any[] = await db.select().from(routingPackages).where(eq(routingPackages.id, company.routingPackageId));
    const entries = await db.select().from(routingPackageEntries).where(eq(routingPackageEntries.packageId, company.routingPackageId));
    routingPackageName = rp?.name ?? null;
    routeCount = entries.length;
    // An assigned but EMPTY package would provision a customer with no routes and report
    // success — the same silent-partial-success shape this platform keeps producing.
    checks.push(routeCount > 0
      ? pass("routing", "Routing package", `${rp?.name} — ${routeCount} routes`)
      : fail("routing", "Routing package", `${rp?.name} contains no routes`,
             "Add country/product entries to the routing package, or assign a different one."));
  } else {
    checks.push(fail("routing", "Routing package", "No routing package assigned",
                     "Assign a provisioning profile to the company so its routing package resolves."));
  }

  let notificationProfileName: string | null = null;
  if (company.notificationProfileId) {
    const [np]: any[] = await db.select().from(notificationProfiles).where(eq(notificationProfiles.id, company.notificationProfileId));
    notificationProfileName = np?.name ?? null;
    checks.push(pass("notifications", "Notification profile", np?.name ?? "assigned"));
  } else {
    checks.push(fail("notifications", "Notification profile", "None assigned",
                     "Assign a provisioning profile so the notification profile resolves."));
  }

  if (company.provisioningProfileId) {
    const [pp]: any[] = await db.select().from(provisioningProfiles).where(eq(provisioningProfiles.id, company.provisioningProfileId));
    checks.push(pass("profile", "Provisioning profile", pp?.name ?? "assigned"));
  } else {
    checks.push(fail("profile", "Provisioning profile", "None assigned",
                     "Company was created before preparation existed — re-run preparation."));
  }

  // Rate policy resolves to a card by name (migration 041/042).
  // ── Rates: can we generate them, not does a static card exist ───────────────
  // This used to resolve company.ratePolicy to a rate_cards row and FAIL when it found
  // none — which blocked every retail company, because 041 sets retail profiles to
  // "Standard Retail" and only ever creates a Standard Wholesale card. The check was also
  // asking the wrong question: under per-customer tariffs there is no shared retail sheet
  // to point at. What matters is whether the rates step will have anything to upload.
  //
  // WARN, not fail. The rates step is non-blocking by design — a customer with a working
  // account and no rates is recoverable from Rate Manager in minutes — so a check that
  // refuses the whole provisioning run over it would contradict the step it describes.
  try {
    const chosen = await db.select({ productId: companyProducts.productId })
      .from(companyProducts).where(eq(companyProducts.companyId, companyId));
    const productIds = chosen.map(r => r.productId);
    const today = new Date().toISOString().slice(0, 10);

    const [{ n }] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(productRates)
      .where(and(
        productIds.length ? inArray(productRates.productId, productIds) : sql`TRUE`,
        sql`${productRates.effectiveFrom} <= ${today}`,
        or(sql`${productRates.effectiveTo} IS NULL`, sql`${productRates.effectiveTo} >= ${today}`),
      ));

    checks.push(n > 0
      ? pass("rates", "Rates", `${n} price(s) effective today${productIds.length ? ` across ${productIds.length} selected product(s)` : ' across every product'}`)
      : warn("rates", "Rates", "No prices effective today — the account will be provisioned unpriced",
             "Load prices in Rate Manager. Provisioning continues; the rate upload step will report that it had nothing to send."));
  } catch (e: any) {
    checks.push(warn("rates", "Rates", "Could not be read", e?.message ?? "unknown error"));
  }

  // ── IPs + conflict detection ──────────────────────────────────────────────
  const ips = await db.select().from(clientIpRequests).where(eq(clientIpRequests.companyId, companyId));
  const ipList = ips.map((r: any) => String(r.ipAddress).trim()).filter(Boolean);

  if (ipList.length === 0) {
    checks.push(fail("ips", "Authorised IPs", "No IP addresses recorded",
                     "Add at least one IP address for this customer."));
  } else {
    // Whitelisted IPs are deliberately shared (internal platforms) and skip the check.
    const whitelist = await db.select().from(ipSharingApprovals);
    const shared = new Set(
      whitelist.filter((w: any) => w.status === "approved" || w.status === "internal")
               .map((w: any) => String(w.ipAddress).trim()));

    // Conflicts are checked against OTHER companies' IPs. Anything already authorised
    // elsewhere would mean two customers authenticating on one address.
    const others = await db.select().from(clientIpRequests).where(ne(clientIpRequests.companyId, companyId));
    const otherCompanyIds = Array.from(new Set(others.map((o: any) => o.companyId).filter(Boolean)));
    const otherCompanies: any[] = otherCompanyIds.length
      ? await db.select().from(companies)
      : [];
    const nameOf = (id: number) => otherCompanies.find((c: any) => c.id === id)?.name ?? `company ${id}`;

    const conflicts = ipList.flatMap(ip => {
      if (shared.has(ip)) return [];
      return others
        .filter((o: any) => String(o.ipAddress).trim() === ip)
        .map((o: any) => `${ip} → ${nameOf(o.companyId)}`);
    });

    // Shape, checked BEFORE conflicts. Every entry point now refuses a malformed address,
    // but rows recorded before that landed are still in the table and still approved, and
    // Sippy rejects them one authentication rule at a time — "Parameter remote_ip has
    // incorrect format", twelve times, at step 40 of a run. Named here instead, where the
    // operator is deciding whether the customer is ready.
    //
    // Not repaired silently. Rewriting 1.2.3.09 to 1.2.3.9 on the way to Sippy would leave
    // the approved record and the switch disagreeing about what was authorised.
    const malformed = ipList
      .map(ip => ({ ip, check: checkIpv4(ip) }))
      .filter(x => !x.check.ok);

    if (malformed.length) {
      checks.push(fail("ips", "Authorised IPs",
        malformed.map(m => `${m.ip} — ${m.check.message}`).join(" · "),
        "Sippy refuses an authentication rule with a malformed remote_ip, so every rule for this IP fails. Add the corrected address on the company card, approve it, and reject the malformed one."));
    } else {
      checks.push(conflicts.length === 0
        ? pass("ips", "Authorised IPs", `${ipList.length} IP${ipList.length === 1 ? "" : "s"}, no conflicts`)
        : fail("ips", "IP conflict", conflicts.join(" · "),
               "Two customers cannot be authorised on the same IP — calls would authenticate against the wrong account. Change the IP, or add it to the internal shared-IP list if the overlap is intentional."));
    }
  }

  // ── Canonical identity (migration 049) ────────────────────────────────────
  // Every CLD translation rule derives from the prefix, so without it the engine can
  // build no authentication rules at all.
  checks.push(company.accountPrefix
    ? pass("account_prefix", "Account prefix", `${company.accountPrefix} — CLD rules derive from this`)
    : fail("account_prefix", "Account prefix", "No account prefix allocated",
           "Allocated automatically at company creation. A company created before migration 049, or one whose legacy prefix collided with another customer's, needs its prefix set from its Sippy authentication rules."));

  // ── Routing matrix (migration 050) ────────────────────────────────────────
  // An unmapped cell cannot become an authentication rule: a rule without a routing group
  // authenticates the caller and then falls back to the account default, which is the
  // usual cause of "No Route Found".
  try {
    const unmapped = await unmappedRoutingCells(companyId);
    checks.push(unmapped.length === 0
      ? pass("routing_matrix", "Routing matrix", "Every destination and product is mapped to a routing group")
      : fail("routing_matrix", "Routing matrix",
             `${unmapped.length} unmapped cell(s): ${unmapped.slice(0, 4).map(u => `${u.country}/${u.product}`).join(", ")}${unmapped.length > 4 ? " …" : ""}`,
             "Map each destination and product to a Sippy routing group on the Routing Matrix page. Provisioning cannot create authentication rules for an unmapped cell."));
  } catch {
    checks.push(warn("routing_matrix", "Routing matrix", "Could not be read",
                     "Migration 050 may not have applied yet — check Schema Migrations."));
  }

  // ── Account details email ─────────────────────────────────────────────────
  // Warn, not fail: an account that carries traffic but whose credentials were not emailed
  // is a follow-up, whereas blocking the provision would leave the customer with neither.
  const contactRows: any[] = await db.select().from(companyContacts)
    .where(eq(companyContacts.companyId, companyId));
  const eligible = contactRows.filter(c =>
    ["technical", "support", "noc", "commercial"].includes(String(c.contactType ?? "").toLowerCase())
    && String(c.email ?? "").includes("@"));
  checks.push(eligible.length > 0
    ? pass("email_recipients", "Email recipients", `${eligible.length} support/commercial contact(s) will receive the account details`)
    : warn("email_recipients", "Email recipients", "No support or commercial contact has an email address",
           "Account details are never sent to finance, billing, rates or invoicing contacts. Add a technical or commercial contact, or the credentials will have to be sent by hand."));

  // ── Authentication plan ───────────────────────────────────────────────────
  // Builds the rule set without touching Sippy, so the operator sees the exact number of
  // rules that will be created BEFORE committing. A plan that cannot be built is the same
  // failure the authentication stage would hit half way through a run — better here.
  try {
    const ips = ipList.length ? ipList : [];
    const plan = await planAuthRuleSet(companyId, ips);
    checks.push(plan.gaps.length === 0 && plan.rules.length > 0
      ? pass("auth_plan", "Authentication plan",
             `${plan.rules.length} rule(s) — ${plan.ips.length} IP(s) x ${plan.ips.length ? plan.rules.length / plan.ips.length : 0} routing cell(s)`)
      : fail("auth_plan", "Authentication plan",
             plan.gaps.length
               ? `${plan.gaps.length} gap(s): ${plan.gaps.slice(0, 3).map(g => `${g.country}/${g.product}`).join(", ")}${plan.gaps.length > 3 ? " …" : ""}`
               : "No rules could be built from this company's configuration",
             "Every destination and product must resolve to a routing group, and the company needs an account prefix and at least one approved IP."));
  } catch (e: any) {
    checks.push(warn("auth_plan", "Authentication plan", `Could not be built: ${e?.message ?? "unknown error"}`,
                     "Migrations 049/050 may not have applied — check Schema Migrations."));
  }

  // ── Outbound email ────────────────────────────────────────────────────────
  // Warning, never blocking: a provisioned customer whose credentials must be sent by hand
  // is a follow-up; refusing to provision leaves them with neither an account nor an email.
  try {
    const smtp = await testEmailConfig();
    checks.push(smtp.ok
      ? pass("smtp", "Outbound email", "SMTP is configured and reachable")
      : warn("smtp", "Outbound email", smtp.error ?? "SMTP is not configured",
             "Provisioning will still complete, but the account details email will not be delivered — send it manually or fix SMTP in Settings."));
  } catch (e: any) {
    checks.push(warn("smtp", "Outbound email", `Could not be checked: ${e?.message ?? "unknown error"}`,
                     "Provisioning is unaffected; the account details email may need to be sent by hand."));
  }

  const canProvision = checks.every(c => c.status !== "fail");

  return {
    companyId,
    companyName: company.name,
    canProvision,
    checks,
    summary: {
      tariffId: company.sippyITariff ?? null,
      servicePlanId: company.sippyIBillingPlan ?? null,
      ipCount: ipList.length,
      routeCount,
      ratePolicy: company.ratePolicy ?? null,
      routingPackage: routingPackageName,
      notificationProfile: notificationProfileName,
      // Stated explicitly on the confirmation screen: after this action the customer can
      // carry live calls. An admin should not have to infer that.
      trafficOnCompletion: "enabled",
    },
  };
}

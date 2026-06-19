path = "server/routes.ts"
with open(path, "r") as f:
    content = f.read()

old1 = """        const {
          accountNames, trunkPrefix,
          destinations,
          dialPrefix, rate,
          effectiveFrom, effectiveTill, format,
        } = req.body as {
          accountNames: string[];
          trunkPrefix: string;
          destinations?: Array<{ dialPrefix: string; rate: number }>;
          dialPrefix?: string;
          rate?: number;
          effectiveFrom?: string;
          effectiveTill?: string;
          format?: 'full' | 'partial' | 'default';
        };"""

new1 = """        const {
          accountNames, accounts, trunkPrefix,
          destinations,
          dialPrefix, rate,
          effectiveFrom, effectiveTill, format,
        } = req.body as {
          accountNames: string[];
          accounts?: Array<{ username: string; iAccount?: number }>;
          trunkPrefix: string;
          destinations?: Array<{ dialPrefix: string; rate: number }>;
          dialPrefix?: string;
          rate?: number;
          effectiveFrom?: string;
          effectiveTill?: string;
          format?: 'full' | 'partial' | 'default';
        };"""

c1 = content.count(old1)
print(f"Edit 1: found {c1} match(es)")

old2 = """        const results: {
          accountName: string; prefix: string; rate: number;
          success: boolean; message: string; method?: string;
          uploadToken?: string; uploadStatus?: string; verificationResult?: string;
        }[] = [];

        for (const dest of destList) {
          for (const accountName of accountNames) {
            try {
              const r = await sippy.pushRateToSippy(
                {
                  accountName,
                  prefix:      dest.fullPrefix,
                  ratePerMin:  dest.rate,
                  effectiveFrom: effectiveFrom || undefined,
                  effectiveTo:   effectiveTill || undefined,
                  format: format ?? 'full',
                },
                { username, password },
                portalUrl,
                adminCreds,
              );"""

new2 = """        const iTariffByAccountName = new Map();
        if (Array.isArray(accounts)) {
          const credPairs = sippyXmlCredsPairs(settings);
          for (const acc of accounts) {
            if (!acc.iAccount) continue;
            try {
              let info = null;
              for (const { username: u, password: p } of credPairs) {
                try { info = await sippy.getAccountInfo(u, p, portalUrl, acc.iAccount); if (info) break; } catch {}
              }
              if (!info) continue;
              let resolvedTariff = info.iTariff || null;
              if (!resolvedTariff && info.iBillingPlan) {
                try {
                  const { plans } = await sippy.listSippyBillingPlans(credPairs[0].username, credPairs[0].password, portalUrl);
                  const plan = plans.find((p) => p.id === info.iBillingPlan || p.iBillingPlan === info.iBillingPlan);
                  if (plan && plan.iTariff) resolvedTariff = plan.iTariff;
                } catch {}
              }
              if (resolvedTariff) iTariffByAccountName.set(acc.username, String(resolvedTariff));
            } catch (e) {
              console.warn(`[push-batch] iTariff resolution failed for ${acc.username}: ${e.message}`);
            }
          }
        }
        const results: {
          accountName: string; prefix: string; rate: number;
          success: boolean; message: string; method?: string;
          uploadToken?: string; uploadStatus?: string; verificationResult?: string;
        }[] = [];

        for (const dest of destList) {
          for (const accountName of accountNames) {
            try {
              const r = await sippy.pushRateToSippy(
                {
                  accountName,
                  iTariff:     iTariffByAccountName.get(accountName),
                  prefix:      dest.fullPrefix,
                  ratePerMin:  dest.rate,
                  effectiveFrom: effectiveFrom || undefined,
                  effectiveTo:   effectiveTill || undefined,
                  format: format ?? 'full',
                },
                { username, password },
                portalUrl,
                adminCreds,
              );"""

c2 = content.count(old2)
print(f"Edit 2: found {c2} match(es)")

if c1 == 1 and c2 == 1:
    content = content.replace(old1, new1)
    content = content.replace(old2, new2)
    with open(path, "w") as f:
        f.write(content)
    print("Both edits applied successfully")
else:
    print("MISMATCH on one or both edits — nothing was written.")

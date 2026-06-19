path = "server/routes.ts"
with open(path, "r") as f:
    content = f.read()

old = """              let resolvedTariff = info.iTariff || null;
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
            }"""

new = """              let resolvedTariff = info.iTariff || null;
              if (!resolvedTariff && info.iBillingPlan) {
                try {
                  const { plans } = await sippy.listSippyBillingPlans(credPairs[0].username, credPairs[0].password, portalUrl);
                  const plan = (plans as any[]).find((p: any) => p.id === info.iBillingPlan);
                  if (plan && (plan as any).iTariff) resolvedTariff = (plan as any).iTariff;
                } catch {}
              }
              if (resolvedTariff) iTariffByAccountName.set(acc.username, String(resolvedTariff));
            } catch (e: any) {
              console.warn(`[push-batch] iTariff resolution failed for ${acc.username}: ${e.message}`);
            }"""

c = content.count(old)
print(f"Found {c} match(es)")
if c == 1:
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    print("Applied successfully")
else:
    print("MISMATCH — nothing was written.")

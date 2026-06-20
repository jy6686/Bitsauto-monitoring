import re

# --- File 1: server/routes.ts ---
path1 = "server/routes.ts"
with open(path1, "r") as f:
    content1 = f.read()

fixes_routes_ts = [
    # Fix A: push-batch job insert (after push loop)
    (
        "            notificationType:   (req.body as any).notificationType ?? null,\n          });\n        } catch { /* non-critical */ }",
        "            notificationType:   (req.body as any).notificationType ?? null,\n          });\n        } catch (e: any) { console.error('[rate_push_jobs] push-batch insert failed:', e?.message || e); }",
    ),
    # Fix B: change-client-rates pending insert (before push loop)
    (
        "            notes:        `Pending: changing ${prefixes.length} rate(s) for ${accountName} to ${rate}`,\n          });\n        } catch { /* non-critical */ }",
        "            notes:        `Pending: changing ${prefixes.length} rate(s) for ${accountName} to ${rate}`,\n          });\n        } catch (e: any) { console.error('[rate_push_jobs] change-client-rates pending insert failed:', e?.message || e); }",
    ),
    # Fix C: change-client-rates final update (after push loop)
    (
        "            notes:              `${accountName}: ${prefixes.length} prefix(es), newRate=${rate}, method=${methods.join(',') || 'n/a'}, ok=${ok}/${prefixes.length}`,\n          }).where(eq(ratePushJobs.jobId, jobId));\n        } catch { /* non-critical */ }",
        "            notes:              `${accountName}: ${prefixes.length} prefix(es), newRate=${rate}, method=${methods.join(',') || 'n/a'}, ok=${ok}/${prefixes.length}`,\n          }).where(eq(ratePushJobs.jobId, jobId));\n        } catch (e: any) { console.error('[rate_push_jobs] change-client-rates update failed:', e?.message || e); }",
    ),
]

for old, new in fixes_routes_ts:
    c = content1.count(old)
    print(f"routes.ts fix: found {c} match(es)")
    if c == 1:
        content1 = content1.replace(old, new)
    else:
        print("  MISMATCH — skipped, no change made for this one")

with open(path1, "w") as f:
    f.write(content1)

# --- File 2: server/routes-rate-manager.ts ---
path2 = "server/routes-rate-manager.ts"
with open(path2, "r") as f:
    content2 = f.read()

old2 = "          }).catch(() => { /* rate_push_jobs insert is best-effort */ });\n        } catch { /* non-fatal */ }"
new2 = "          }).catch((e: any) => { console.error('[rate_push_jobs] product-rates insert failed:', e?.message || e); });\n        } catch (e: any) { console.error('[rate_push_jobs] product-rates outer catch:', e?.message || e); }"

c2 = content2.count(old2)
print(f"routes-rate-manager.ts fix: found {c2} match(es)")
if c2 == 1:
    content2 = content2.replace(old2, new2)
    with open(path2, "w") as f:
        f.write(content2)
else:
    print("  MISMATCH — nothing written for this file")

print("Done.")

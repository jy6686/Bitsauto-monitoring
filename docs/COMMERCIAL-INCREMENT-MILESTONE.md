# Rate Manager / Destination Catalogue — commercial chain + billing increment

**IMPLEMENTED + TESTED · NOT DEPLOYED · NOT OPERATING**

That distinction is the point of this document. The tests prove the safety properties; the
**absence of callers** proves the engines cannot currently act in production. Both halves matter,
and "done" here means *proven*, not *running*.

1,856 tests · 325 baseline type errors (unchanged throughout) · 46 commits unpushed ·
migrations 516/517/518 **written and unapplied** · no email sent · no production Sippy write.

---

## The chain, end to end

```
Catalogue (supplier truth)
  → Eligibility        what a product is declared to sell
    → Product Rates    priced per DESTINATION, not per prefix
      → Expansion      one rate → every catalogue prefix
        → Trunk + increment
          → Operations → lanes → per-operation persistence
            → MUTATION BOUNDARY → Sippy → read-back
```

| # | Slice | Commit | State |
|---|-------|--------|-------|
| 1 | Eligibility declaration UI | `1e5bfd7b` | built |
| 2 | Commercial chain acceptance | `68da664d` | built |
| 3 | Operational bridge | `ef93d115` | built |
| 4 | Increment change + outbox + UI | `4b7994aa` `69f20a58` `7eba4022` | built |
| 5 | Effective-date application | `de44e6ab` `49d4b245` | built, **unbound** |
| 6 | Delivery worker | `1fbb93a9` | built, **no caller** |
| 7 | Post-push CHANGES notification | `8eeffdb0` `6b2d2707` | built |
| 8 | Recipients (commercial + rates) | `2188f85e` | built |
| 9 | Durable post-push obligation | `34e4dcb5` | built, **no caller** |
| 10 | Branded renderer + logo contract | `81aa2da8` `a568f391` `460d5f94` | built |

## Three defects found by building, not by auditing

Each was a real hole that the acceptance tests exposed:

1. **Nothing could create eligibility.** API and grid both existed; no screen declared it. Every
   product sold nothing, so nothing was priceable or pushable — a dead end under all the audits.
2. **Pricing was a back door into selling.** No push path consulted eligibility, so a rate row
   for an undeclared destination was expanded and would have been uploaded (`68da664d`).
3. **`push-batch` was a complete eligibility bypass.** Destinations arrive in the request body and
   eligibility was never consulted, so any prefix could go to any client (`ef93d115`).
4. **Rate sheets were reaching NOC and support inboxes.** The recipient query's own comment says
   technical contacts are excluded; its predicate included `technical`, `support` and `noc`
   (`2188f85e`). Fixed for the new path only — narrowing the PROVISIONING path removes real
   contacts from real customers and is a commercial decision, still open.

## Two customer-facing rules, enforced rather than documented

**The customer never sees the execution prefix.** Commercial catalogue prefix `9230`; Sippy
execution prefix `19230`, used internally and unchanged; the notification shows `9230`. The
renderer cannot be handed a pre-built dial format — it takes the account prefix and product digit
and composes the format itself — and it THROWS if the composed prefix reaches the HTML by any
other route. Publishing it cannot be taken back once the mail is out.

**Only the governing legal clause appears.** Under FULL a destination absent from the sheet is
DELETED; under CHANGES it keeps its previous rate. A CHANGES notice never carries the deletion
clause, so a partial sheet cannot be read as withdrawing everything it does not list.

## The separations that must not collapse

**Supplier data ≠ commercial commitment.** `commercial_destination_prefixes.billing_increment` is
replaced on every re-import. A commitment written there would be silently reverted *after* clients
were emailed. Tested by replacing the supplier value after scheduling and proving the change, its
date and the client's message are unaffected.

**Commercial commitment ≠ notification ≠ switch application.** A client can be correctly notified
while the change is still `awaitingApplication`. `applied_at` is earned **only** by authoritative
read-back — the schema refuses an `applied` row without `applied_increment` and
`prefixes_verified`, so even a hand-written UPDATE cannot claim it.

**Failure ≠ indeterminate.** A write that throws, or a read-back that cannot prove the result, is
`needs_review` — never `failed`, which would say nothing happened when something may have. That is
the same conflation that let an indeterminate rate upload be retried as though it were clean.

**A refusal does not retire a commitment.** Nothing was sent, so the change stays exactly as due;
only the attempt is counted.

## Three independently gated actions — none taken

| Gate | Effect | Reachable today? |
|------|--------|------------------|
| Apply migrations 516/517 | Creates the tables. **No email or Sippy mutation follows from applying them** | tables do not exist, so nothing can be scheduled |
| Bind `applyIncrementChange` to real Sippy | **First point at which production Sippy mutation becomes reachable** | dependencies injected, bound to nothing |
| Enable delivery | Real sender + schedule | worker has no caller; delivery is off unless explicitly enabled |

`de44e6ab`'s tests are the contract the Sippy binding must satisfy.

## Deliberately out of scope

The **50% rate-decrease validation** is untouched and stays that way. Its comparison base
(Decision A) is unresolved and needs a production read this environment cannot perform. Billing
increment scheduling was built independently of it, and nothing here depends on it.

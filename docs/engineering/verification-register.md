# Verification Register

| Field | Value |
|-------|-------|
| Purpose | Track discrepancies between sources (code / institutional / runtime) until resolved with evidence |
| Status | ACTIVE (living) |
| Last verified | 2026-07-11 |
| Repository commit | `f1e349cb` |

> Every time a `.agents/memory` note, the handbook, or an assumption **disagrees**
> with current code or observed behaviour, it gets a **VR-NNN** entry here instead
> of being silently "fixed." An entry is closed only when production/runtime/DB
> evidence resolves it — and the resolution (code was right, or code was a
> regression) is recorded. This register records not just what the platform does,
> but **what still needs verification.**

Authority when sources conflict (Volume 0 §4.1): **code > institutional notes**;
**production > everything** for behaviour. Never assume which side is "wrong."

---

## Open entries

### VR-001 — Send Rate prefix: `fullPrefix` vs `dialPrefix`
| Attribute | Value |
|-----------|-------|
| Subsystem | Commercial → Send Rate (§7) |
| Institutional note | `.agents/memory/prefix-architecture-rule.md` (LOCKED): **only `dialPrefix`** may reach Sippy; `fullPrefix` is audit-only; sending `fullPrefix` (e.g. `19233`) throws `Cannot find iRate for prefix 19233`. |
| Current code | `server/routes-rate-manager.ts:313` passes **`prefix: fullPrefix`** to `pushRateToSippy` (comment claims "Sippy tariffs store full prefixes, e.g. 29233 for Business Class"); the computed `dialPrefix` (line 272) is **unused**. |
| Runtime evidence | **Unknown** — needs a real push observed against Sippy |
| Evidence level required | **L2/L3** (runtime log and/or a live push result) |
| Priority | **High** (Send Rate writes to the production Sippy switch) |
| Owner | Commercial |
| Status | **PENDING** |
| Resolution | *(to fill)* e.g. "Verified: full-prefix tariff design is current → institutional note archived" **or** "Verified: regression in commit `abc123` → code corrected to use `dialPrefix`." |

**How to resolve VR-001:** trigger one `push-to-sippy` for a product with a
trunk prefix and observe the Sippy result — success (full-prefix design is real) vs
`Cannot find iRate` (institutional rule holds, code is a regression). Record the
outcome above, then update Volume 1 §7 and mark `prefix-architecture-rule.md`
status in `INDEX.md`.

---

## Closed entries

*(none yet)*

---

## How to add an entry

1. Assign the next `VR-NNN`.
2. Record: subsystem, the two conflicting sources (with file:line and note name),
   runtime status, evidence level required, priority, owner.
3. Leave **Status: PENDING** and **Resolution** blank.
4. On resolution: fill Resolution with the outcome + the deciding evidence, move to
   Closed, and update the affected handbook module's **Verification status** field.

## Open Questions
- [ ] VR-001 resolution — **Needs Production Evidence** (L2/L3)
- [ ] Sweep the remaining `.agents/memory` notes for further code conflicts as each area is documented — **Pending**

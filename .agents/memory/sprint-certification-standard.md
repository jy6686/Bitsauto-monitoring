---
name: Sprint Certification Standard
description: Canonical certification format for all platform sprints — structure, rules, and decision language.
---

## Rule
Every sprint certification follows the template at `.local/governance/sprint-certification-template.md`.

## Five required sections
1. **Scope** — one paragraph, feature surface only, no file names
2. **Acceptance Criteria Verification** — table, ✅/❌/⚠️ per criterion
3. **Validation Summary** — only observations traceable to an acceptance criterion; no unrelated environment references
4. **Known Limitations** — intentional scope decisions only, not bugs or noise; write "None" if empty
5. **Certification Decision** — single line: Certified / Functional Certification Pending / Not Certified

## Why
User established this standard during F0 certification review. The phrase "the mockup sandbox error is unrelated to this work" was cited as an example of a certification-weakening observation — it introduces an out-of-scope issue and implies doubt where none exists. Any observation not traceable to an acceptance criterion must be omitted.

## How to apply
Before writing any sprint certification summary (in chat, commit message, or task close-out), load `.local/governance/sprint-certification-template.md` as the template. Log completed certifications in the table at the bottom of that file.

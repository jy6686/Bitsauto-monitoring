---
name: shared/lib path alias
description: "@shared/* maps to ./shared/* so @shared/lib/portal-constants works for both server and client imports without any config change."
---

## Rule
The `@shared/*` TypeScript path alias (in `tsconfig.json`) maps to `./shared/*`. This means subdirectories under `shared/` are automatically reachable via the alias.

Example:
- File: `shared/lib/portal-constants.ts`
- Import (server): `import { VALID_PORTAL_KEYS } from "@shared/lib/portal-constants";`
- Import (client): `import { VALID_PORTAL_KEYS } from "@shared/lib/portal-constants";`
- Vite config: `"@shared": path.resolve(import.meta.dirname, "shared")` covers this automatically.

**Why:** Confirmed by reading `tsconfig.json` → `"@shared/*": ["./shared/*"]` and `vite.config.ts` → `"@shared": path.resolve(...)`. The alias resolves the entire subtree, not just the root `shared/` directory.

**How to apply:** Any new shared module can be placed under `shared/lib/`, `shared/utils/`, etc. and imported with `@shared/<subdir>/<file>` from both server and client code without any config changes.

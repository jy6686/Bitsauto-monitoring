/**
 * schema-contract.ts — columns the running code reads, checked once at boot.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE MIGRATION RUNNER. runFileMigrations() deliberately
 * never throws: a migration problem must not lock an operator out of the tool they would
 * fix it with. So the app serves even when the run halted, and the next signal is a 500
 * from whichever endpoint reads a column that is not there — /api/provisioning/jobs/:id
 * returning 500 does not say "apply 055", it says the provisioning panel is broken.
 *
 * The runner's own halt report names the pending FILES, which is the common case. This
 * catches the one it cannot: a database whose ledger says everything is applied but whose
 * schema disagrees — a hand-applied migration, a restored snapshot, a database that was
 * pointed at the wrong branch. There the ledger is not evidence and only the columns are.
 *
 * SCOPE, STATED HONESTLY. This list is maintained by hand and covers columns whose absence
 * takes an endpoint down, not every column in the schema. A column missing from the list
 * is a check not performed — never a claim that the schema is complete. Add an entry when
 * a migration introduces a column that live code reads on a hot path.
 *
 * Diagnostic only. It reports and returns; it does not halt, for the same reason the
 * runner does not.
 */
import type { Pool } from "pg";

export interface ColumnRequirement {
  table:  string;
  column: string;
  /** The migration file that adds it — the operator's actual next action. */
  migration: string;
  /** What stops working without it, in the operator's terms. */
  breaks: string;
}

export const REQUIRED_COLUMNS: ColumnRequirement[] = [
  { table: "companies", column: "account_prefix",
    migration: "049_account_prefix_and_identity.sql",
    breaks: "Company list and provisioning — every CLD translation rule derives from the prefix." },
  { table: "provisioning_steps", column: "detail",
    migration: "055_provisioning_step_detail.sql",
    breaks: "GET /api/provisioning/jobs/:id — the per-stage progress panel on the company card." },
  { table: "provisioning_steps", column: "metrics",
    migration: "056_provisioning_step_metrics.sql",
    breaks: "GET /api/provisioning/jobs/:id — the per-stage progress panel on the company card." },
];

export interface SchemaContractResult {
  missing: ColumnRequirement[];
  /** True when the check itself could not run. Not a pass — an unanswerable question
   *  about the schema is not evidence the schema is right. */
  inconclusive: boolean;
  error?: string;
}

/** One query for the whole list. */
export async function checkSchemaContract(pool: Pool): Promise<SchemaContractResult> {
  if (!REQUIRED_COLUMNS.length) return { missing: [], inconclusive: false };
  try {
    // Everything cast to text on both sides. information_schema exposes these as
    // sql_identifier, and leaving a bare parameter to be resolved against it is the kind
    // of thing that works on one Postgres and raises "operator does not exist" on another
    // — at boot, where the failure would read as a schema problem rather than a query bug.
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name::text AS table_name, column_name::text AS column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name::text, column_name::text) IN (${
            REQUIRED_COLUMNS.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`).join(", ")
          })`,
      REQUIRED_COLUMNS.flatMap(r => [r.table, r.column]),
    );
    const present = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
    return {
      missing: REQUIRED_COLUMNS.filter(r => !present.has(`${r.table}.${r.column}`)),
      inconclusive: false,
    };
  } catch (e: any) {
    return { missing: [], inconclusive: true, error: e?.message ?? "unknown error" };
  }
}

/**
 * Run it and say what it found. One line when the schema matches — a silent check is
 * indistinguishable from a check that never ran.
 */
export async function reportSchemaContract(pool: Pool): Promise<SchemaContractResult> {
  const result = await checkSchemaContract(pool);

  if (result.inconclusive) {
    console.error(`[schema] Could not verify the column contract — ${result.error}. This is not a pass.`);
    return result;
  }
  if (!result.missing.length) {
    console.log(`[schema] Column contract OK — ${REQUIRED_COLUMNS.length} required column(s) present.`);
    return result;
  }

  // Grouped by migration: one apply fixes all of that file's columns, and the migration
  // name is the action. Listing columns alone would leave the operator to work out which
  // file introduces each.
  const byMigration = new Map<string, ColumnRequirement[]>();
  for (const m of result.missing) {
    byMigration.set(m.migration, [...(byMigration.get(m.migration) ?? []), m]);
  }

  console.error(`[schema] SCHEMA IS BEHIND THE CODE — ${result.missing.length} required column(s) missing.`);
  for (const [migration, cols] of byMigration) {
    console.error(`[schema]   apply ${migration}`);
    for (const c of cols) {
      console.error(`[schema]     missing ${c.table}.${c.column} — ${c.breaks}`);
    }
  }
  console.error(`[schema] Until then those endpoints return 500. Restart applies pending migrations; if a run halted, [migrate] above names the file that failed.`);
  return result;
}

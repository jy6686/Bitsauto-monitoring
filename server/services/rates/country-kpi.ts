/**
 * How many countries the rate catalogue actually covers.
 *
 * The number is counted from the SEEDED REFERENCE, never inferred from the catalogue's own
 * codes. Migration 063, which seeds `countries`, states the reason in its header: a country
 * code is a numbering plan, not a country — `1` is 22 countries and `7` is Russia and
 * Kazakhstan — so country identity must come from outside the catalogue.
 *
 * Two catalogue-derived counts were measured against production and rejected:
 *
 *   352  distinct level-1 `country_code`. Inflated: migration 064 merges each ISO/dial twin
 *        root and leaves the loser behind as a childless husk, so most countries appear twice.
 *   198  distinct numeric `country_code` on level-2 rows. Not a hierarchy at all — 150,002 of
 *        those 150,294 rows have no parent — and it collapses the whole NANP set into `1`,
 *        silently losing two dozen countries.
 *
 * THE JOIN IS THE ONE MIGRATION 064 CREATED. For every reference country it chose a surviving
 * level-1 root and wrote `destinations.country_code = countries.iso2` onto it. Matching on that
 * ISO identity is therefore reading back what the merge recorded, which is why the join is
 * exact-match on `iso2` and never on a dial code or a name — 064 refuses dial matching for the
 * same NANP reason, and V2's rule is that aliases are exact-match only, never fuzzy.
 *
 * "Covered" means the root has at least one destination beneath it. A reference country with no
 * root, or a root with nothing under it, is catalogue scaffolding rather than somewhere we sell.
 * That condition also excludes 064's husks for free, since a husk by definition has no children.
 *
 * The blank guard is not decoration, and there is exactly ONE of it on purpose. A NULL never
 * matches anything, so `iso2 IS NOT NULL` would be dead code — but `iso2` is CHAR(2) and an
 * EMPTY value trims to '', which equals every root whose `country_code` is also blank and would
 * invent countries out of unlabelled rows, of which production has 234 at level 1 alone.
 * Guarding the destination side alone closes that, and a mirror guard on the reference side was
 * removed once mutation testing showed either one makes the other unreachable.
 */

/**
 * Returns a single row `{ n }`. Exported as a string so the route and its database-backed test
 * execute the SAME query — a test against a re-typed copy proves only that the copy works.
 *
 * ON THE CTE, HONESTLY. `destinations` carries one expression index, on
 * (lower(trim(name)), coalesce(dial_prefix,'')) from migration 059 — nothing on `parent_id`,
 * nothing on `country_code` — and 059's comment records an unindexed probe of this table
 * measuring 22 seconds, so a correlated EXISTS per reference country looked like a trap.
 * Measured at production scale (150,350 rows, 178 reference countries) it is not: the
 * correlated form ran in 28 ms and this CTE in 35 ms. The set is built once because naming
 * "the attached set" says what the rule is, NOT because it is faster — it is marginally
 * slower. Those figures come from PGlite and are indicative only; the real check is the
 * endpoint's response time in production.
 *
 * `IN` and never `NOT IN`: a NULL anywhere in the set makes NOT IN return no rows at all.
 * `IN` is also what makes the CTE's duplicates harmless — it is a semi-join, so a country whose
 * root appears twice, or whose root has forty children, is still counted once. A `DISTINCT`
 * here would be decoration: mutation testing showed removing it changes nothing. What must NOT
 * change is `IN` itself; rephrasing this as a counting JOIN double-counts, and there is a test
 * that says so.
 */
export const COUNTRY_KPI_SQL = `
  WITH attached AS (
    SELECT upper(trim(d.country_code)) AS iso
      FROM destinations d
      JOIN destinations ch ON ch.parent_id = d.id
     WHERE d.level = 1
       AND coalesce(trim(d.country_code), '') <> ''
  )
  SELECT count(*)::int AS n
    FROM countries c
   WHERE c.classification IN ('country','territory')
     AND upper(trim(c.iso2)) IN (SELECT iso FROM attached)
`;

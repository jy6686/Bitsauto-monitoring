/**
 * The Countries KPI — counted from the seeded reference, never inferred from the catalogue.
 *
 * DATABASE-BACKED. The query under test is the string the route ships, executed against the
 * real table shapes from migrations 063 (`countries`) and the canonical `destinations` table,
 * so what is proven here is the join itself rather than a description of it.
 *
 * WHY THIS QUERY AND NOT A SIMPLER ONE. Two earlier candidates were rejected against measured
 * production data:
 *
 *   · distinct `country_code` over level-1 rows answered 352, inflated by the ISO/dial twin
 *     roots that migration 064 leaves behind as childless husks.
 *   · distinct numeric `country_code` over level-2 rows answered 198, and 150,002 of those
 *     150,294 rows have no parent at all — "level 2" is a label, not a position in a hierarchy.
 *     It also collapses the whole NANP set into `1`.
 *
 * Migration 063 states the rule outright: a country code is a numbering plan, not a country —
 * `1` is 22 countries and `7` is Russia and Kazakhstan — so country identity must come from
 * outside the catalogue. 064 then made the ISO-coded root the survivor and set its
 * `country_code` to the reference `iso2`. That assignment IS the link this query joins on.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COUNTRY_KPI_SQL } from './country-kpi';

let db: PGlite;

/** Shapes from migration 063 and the canonical destinations table. */
beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE TABLE countries (
      id             SERIAL PRIMARY KEY,
      canonical_name VARCHAR(128) NOT NULL,
      iso2           CHAR(2),
      dial_code      VARCHAR(8)  NOT NULL,
      classification VARCHAR(24) NOT NULL
        CHECK (classification IN ('country','territory','international_service'))
    );
    CREATE TABLE destinations (
      id           SERIAL PRIMARY KEY,
      parent_id    INTEGER,
      level        INTEGER NOT NULL DEFAULT 1,
      name         VARCHAR(128) NOT NULL,
      country_code VARCHAR(4),
      dial_prefix  VARCHAR(32)
    );`);
});
afterEach(async () => { await db?.close(); });

const count = async (): Promise<number> =>
  Number(((await db.query(COUNTRY_KPI_SQL)) as any).rows[0].n);

const country = (name: string, iso2: string | null, dial: string, cls = 'country') =>
  db.exec(`INSERT INTO countries (canonical_name, iso2, dial_code, classification)
           VALUES ('${name}', ${iso2 === null ? 'NULL' : `'${iso2}'`}, '${dial}', '${cls}')`);

const root = (id: number, name: string, cc: string | null, level = 1) =>
  db.exec(`INSERT INTO destinations (id, parent_id, level, name, country_code)
           VALUES (${id}, NULL, ${level}, '${name}', ${cc === null ? 'NULL' : `'${cc}'`})`);

const child = (id: number, parent: number | null, name: string, cc: string | null, level = 2) =>
  db.exec(`INSERT INTO destinations (id, parent_id, level, name, country_code)
           VALUES (${id}, ${parent ?? 'NULL'}, ${level}, '${name}', ${cc === null ? 'NULL' : `'${cc}'`})`);

describe('a country counts when it has a root AND that root has a destination under it', () => {
  it('counts one country with an ISO root carrying a child', async () => {
    await country('Albania', 'AL', '355');
    await root(33, 'Albania', 'AL');
    await child(100, 33, 'Albania Mobile', 'AL');
    expect(await count()).toBe(1);
  });

  it('does NOT count a reference country whose root has no destinations', async () => {
    await country('Andorra', 'AD', '376');
    await root(40, 'Andorra', 'AD');
    expect(await count()).toBe(0);
  });

  it('does NOT count a reference country with no catalogue root at all', async () => {
    await country('Kiribati', 'KI', '686');
    expect(await count()).toBe(0);
  });

  it('counts a territory, not only a country', async () => {
    await country('Anguilla', 'AI', '1', 'territory');
    await root(50, 'Anguilla', 'AI');
    await child(101, 50, 'Anguilla Mobile', 'AI');
    expect(await count()).toBe(1);
  });
});

describe('the classification filter — a numbering-plan service is not a country', () => {
  it('excludes international_service even when it has a root with children', async () => {
    await country('Inmarsat', null, '870', 'international_service');
    await root(60, 'Inmarsat', null);
    await child(102, 60, 'Inmarsat Voice', null);
    expect(await count()).toBe(0);
  });

  it('excludes a reference row with no iso2 — there is nothing to join on', async () => {
    await country('Some Service', null, '888', 'country');
    await root(61, 'Some Service', null);
    await child(103, 61, 'A child', null);
    expect(await count()).toBe(0);
  });

  /**
   * The seed gives its six ITU services a NULL iso2, so the classification filter and the blank
   * guard currently overlap. This proves the classification filter ON ITS OWN: an
   * international_service that DOES carry an iso2 is still not a country.
   */
  it('excludes international_service even when it carries an iso2 and is fully attached', async () => {
    await country('Some Global Service', 'XX', '882', 'international_service');
    await root(62, 'Some Global Service', 'XX');
    await child(104, 62, 'Service child', 'XX');
    expect(await count()).toBe(0);
  });
});

describe('a blank code is not an identity', () => {
  /**
   * `iso2` is CHAR(2), so an empty value trims to '' rather than being NULL. Without a blank
   * guard it would equal every root whose `country_code` is also blank, and the KPI would
   * invent countries from unlabelled rows — of which production has 234 at level 1 alone.
   */
  it('a reference row with a blank iso2 matches nothing', async () => {
    await country('Blank Country', '  ', '999');
    await root(63, 'Unlabelled root', '  ');
    await child(105, 63, 'A child', null);
    expect(await count()).toBe(0);
  });

  it('a blank-coded root does not attach to a real country', async () => {
    await country('Albania', 'AL', '355');
    await root(64, 'Unlabelled root', '  ');
    await child(106, 64, 'A child', null);
    expect(await count()).toBe(0);
  });
});

describe('THE DECISIVE ONE: a dial code is not a country', () => {
  /**
   * Anguilla and Antigua both dial +1. Counting distinct dial codes answers 1; counting
   * reference identities answers 2. Migration 063 exists because of exactly this case, and
   * the NANP set is 25 entries — an implementation that regresses to dial codes loses 24
   * countries here and the tile drops by that much without anything looking broken.
   */
  it('counts two NANP countries sharing dial code 1 as TWO', async () => {
    await country('Anguilla', 'AI', '1', 'territory');
    await country('Antigua and Barbuda', 'AG', '1');
    await root(70, 'Anguilla', 'AI');
    await child(110, 70, 'Anguilla Mobile', 'AI');
    await root(71, 'Antigua and Barbuda', 'AG');
    await child(111, 71, 'Antigua Mobile', 'AG');
    expect(await count()).toBe(2);
  });

  it('counts Russia and Kazakhstan, which share dial code 7, as TWO', async () => {
    await country('Russia', 'RU', '7');
    await country('Kazakhstan', 'KZ', '7');
    await root(72, 'Russia', 'RU');      await child(112, 72, 'Russia Mobile', 'RU');
    await root(73, 'Kazakhstan', 'KZ');  await child(113, 73, 'Kazakhstan Mobile', 'KZ');
    expect(await count()).toBe(2);
  });
});

describe('the 064 survivor/husk design is respected, not fought', () => {
  /**
   * 064 leaves the losing twin in place as a childless husk. It must neither add a second
   * count for the same country nor suppress the survivor's.
   */
  it('a dial-coded husk beside the ISO survivor still counts the country once', async () => {
    await country('Albania', 'AL', '355');
    await root(33, 'Albania', 'AL');
    await child(120, 33, 'Albania Mobile', 'AL');
    await root(2048, 'Albania', '355');          // the husk: no children
    expect(await count()).toBe(1);
  });

  it('two ISO roots for one country still count that country once', async () => {
    await country('United Arab Emirates', 'AE', '971');
    await root(80, 'UAE', 'AE');                 await child(121, 80, 'UAE Mobile', 'AE');
    await root(81, 'United Arab Emirates', 'AE'); await child(122, 81, 'UAE Fixed', 'AE');
    expect(await count()).toBe(1);
  });
});

describe('what must NOT be mistaken for an attachment', () => {
  /**
   * 150,002 of production's level-2 rows have no parent. A row that merely carries a code is
   * not a country's destination, and counting it is how 198 happened.
   */
  it('an orphan level-2 row carrying a code attaches nothing', async () => {
    await country('Afghanistan', 'AF', '93');
    await child(130, null, 'Afghanistan Mobile AWCC', '93');
    expect(await count()).toBe(0);
  });

  it('a root at the wrong level does not qualify, even with a child', async () => {
    await country('Bahrain', 'BH', '973');
    await root(90, 'Bahrain', 'BH', 2);
    await child(131, 90, 'Bahrain Mobile', 'BH', 3);
    expect(await count()).toBe(0);
  });

  it('a child of a DIFFERENT country does not attach to this one', async () => {
    await country('Bhutan', 'BT', '975');
    await root(91, 'Bhutan', 'BT');
    await root(92, 'Nepal', 'NP');
    await child(132, 92, 'Nepal Mobile', 'NP');
    expect(await count()).toBe(0);
  });
});

describe('matching is tolerant of stored formatting, and nothing else', () => {
  it('matches despite case and surrounding whitespace in country_code', async () => {
    await country('Albania', 'AL', '355');
    await root(33, 'Albania', ' al ');
    await child(140, 33, 'Albania Mobile', null);
    expect(await count()).toBe(1);
  });

  it('does not match on name — only on the ISO identity 064 wrote', async () => {
    await country('Albania', 'AL', '355');
    await root(34, 'Albania', '355');            // right name, dial code, no ISO
    await child(141, 34, 'Albania Mobile', null);
    expect(await count()).toBe(0);
  });
});

describe('a realistic mixed catalogue', () => {
  it('counts exactly the countries that are both referenced and attached', async () => {
    await country('Albania', 'AL', '355');
    await country('Anguilla', 'AI', '1', 'territory');
    await country('Antigua and Barbuda', 'AG', '1');
    await country('Andorra', 'AD', '376');            // root, no children
    await country('Kiribati', 'KI', '686');           // no root
    await country('Inmarsat', null, '870', 'international_service');

    await root(1, 'Albania', 'AL');             await child(201, 1, 'Albania Mobile', 'AL');
    await root(2, 'Albania', '355');            // husk
    await root(3, 'Anguilla', 'AI');            await child(202, 3, 'Anguilla Mobile', 'AI');
    await root(4, 'Antigua and Barbuda', 'AG'); await child(203, 4, 'Antigua Mobile', 'AG');
    await root(5, 'Andorra', 'AD');
    await child(204, null, 'Orphan carrying 93', '93');
    await root(6, 'PAK Mobile MOBLIN', null);   // a 059 legacy promotion

    expect(await count()).toBe(3);
  });

  it('an empty catalogue is zero, not an error', async () => {
    await country('Albania', 'AL', '355');
    expect(await count()).toBe(0);
  });
});

// ── The route ships this query and keeps its other five figures ──────────────

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const RM = strip(readFileSync(join(__dirname, '..', '..', 'routes-rate-manager.ts'), 'utf8'));

const KPI = () => {
  const at = RM.indexOf("app.get('/api/rate-manager/kpi'");
  expect(at, 'the guarded kpi route must exist').toBeGreaterThan(-1);
  const end = RM.indexOf("app.get('/api/rate-manager/export'", at);
  expect(end).toBeGreaterThan(at);
  return RM.slice(at, end);
};

describe('the handler ships THIS query, not a paraphrase of it', () => {
  it('returns totalCountries', () => {
    const body = KPI();
    expect(body.slice(body.indexOf('res.json({'))).toContain('totalCountries');
  });

  it('uses the shared constant rather than an inline copy that can drift', () => {
    expect(KPI()).toContain('COUNTRY_KPI_SQL');
  });

  it('never reverts to counting catalogue codes', () => {
    const k = KPI();
    expect(k).not.toMatch(/count\(distinct country_code\)/i);
    expect(k).not.toMatch(/FROM global_destinations/i);
  });

  it('keeps the other five figures untouched', () => {
    const body = KPI().slice(KPI().indexOf('res.json({'));
    for (const f of ['totalClients', 'totalDestinations', 'totalProducts', 'todayPushes', 'successRate']) {
      expect(body, f).toContain(f);
    }
  });

  it('keeps its own guard — admin, management, noc_operator, and now kam', () => {
    // `kam` added by the KAM authorization gate: a KAM reads the Rate Manager KPI strip.
    expect(KPI()).toMatch(/requireRole\(\['admin','management','noc_operator','kam'\]/);
  });

  /** One tile must not take the strip down: the count is wrapped like its neighbours. */
  it('a failing country count cannot break the whole KPI response', () => {
    expect((KPI().match(/catch\s*\{/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  /**
   * THE LINE THAT MATTERS ON FAILURE. If the query throws, the field must stay null so the UI
   * renders "—". Initialising to 0 instead would put "0 countries" on screen whenever the
   * database hiccups — the same confident falsehood the c9e07b6b deploy shipped, and the whole
   * reason this field was withheld for as long as it was.
   */
  it('starts as null, never 0, so a failure renders a dash and not a false zero', () => {
    const k = KPI();
    expect(k).toMatch(/let\s+totalCountries\s*:\s*number\s*\|\s*null\s*=\s*null\s*;/);
    expect(k).not.toMatch(/let\s+totalCountries[^\n]*=\s*0\s*;/);
  });
});

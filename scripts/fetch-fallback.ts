/**
 * Grab the real star catalogue and commit it to the repo so the app needs NO
 * network at runtime — it just loads public/fallback-stars.json.
 *
 *   npm run fetch-fallback
 *
 * Tries multiple independent TAP servers in order (ESA Gaia first, then the
 * GAVO / Heidelberg `gaia.dr3lite` mirror) and writes the first that responds.
 * Both expose standard Gaia column names, so the output is normalised to the
 * shape the app parses: { metadata: [{name}], data: [[...]] }.
 *
 * Requires network access from the machine you run it on (Node, no CORS).
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

interface Source {
  label: string;
  endpoint: string;
  adql: string;
}

const SOURCES: Source[] = [
  {
    label: 'ESA Gaia archive (gaiadr3.gaia_source)',
    endpoint: 'https://gea.esac.esa.int/tap-server/tap/sync',
    adql:
      'SELECT TOP 5000 source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag, bp_rp ' +
      'FROM gaiadr3.gaia_source ' +
      'WHERE parallax > 20 AND parallax_over_error > 10 AND phot_g_mean_mag < 10 ' +
      'ORDER BY phot_g_mean_mag ASC',
  },
  {
    label: 'GAVO Heidelberg mirror (gaia.dr3lite)',
    endpoint: 'https://dc.zah.uni-heidelberg.de/tap/sync',
    adql:
      'SELECT TOP 5000 source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag, bp_rp ' +
      'FROM gaia.dr3lite ' +
      'WHERE parallax > 20 AND phot_g_mean_mag < 10 ' +
      'ORDER BY phot_g_mean_mag ASC',
  },
];

const WANT = ['source_id', 'ra', 'dec', 'parallax', 'pmra', 'pmdec', 'phot_g_mean_mag', 'bp_rp'];

interface TapJson {
  metadata?: { name?: string }[];
  columns?: { name?: string }[];
  data?: (string | number | null)[][];
}

/** Reduce a TAP JSON payload to canonical { metadata, data } with WANT columns. */
function normalize(json: TapJson): { metadata: { name: string }[]; data: (string | number | null)[][] } {
  const colDefs = json.metadata ?? json.columns ?? [];
  const cols = colDefs.map((c) => String(c.name ?? '').toLowerCase());
  const rows = json.data ?? [];
  if (!rows.length) throw new Error('payload had 0 rows');

  const idx = WANT.map((w) => cols.indexOf(w));
  const missing = WANT.filter((_, i) => idx[i] < 0);
  if (missing.length) throw new Error(`missing columns: ${missing.join(', ')}`);

  const data = rows
    .map((r) => idx.map((i) => r[i]))
    .filter((r) => Number(r[3]) > 0); // parallax > 0

  return { metadata: WANT.map((name) => ({ name })), data };
}

async function trySource(s: Source): Promise<{ metadata: { name: string }[]; data: unknown[] }> {
  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'json',
    QUERY: s.adql,
  });

  let secs = 0;
  const heartbeat = setInterval(() => {
    secs += 5;
    console.log(`    … still waiting (${secs}s)`);
  }, 5000);

  try {
    const res = await fetch(s.endpoint, { method: 'POST', body });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = (await res.json()) as TapJson;
    return normalize(json);
  } finally {
    clearInterval(heartbeat);
  }
}

async function main(): Promise<void> {
  for (const s of SOURCES) {
    console.log(`\nQuerying ${s.label} …`);
    try {
      const out = await trySource(s);
      const here = dirname(fileURLToPath(import.meta.url));
      const outPath = resolve(here, '..', 'public', 'fallback-stars.json');
      await writeFile(outPath, JSON.stringify(out), 'utf8');
      console.log(`\n✅ Wrote ${out.data.length} stars from ${s.label}`);
      console.log(`   → ${outPath}`);
      return;
    } catch (err) {
      console.warn(`   ✗ ${s.label} failed: ${(err as Error).message}`);
    }
  }
  console.error('\nAll sources failed — try again later (Gaia TAP is sometimes overloaded).');
  process.exit(1);
}

main().catch((err) => {
  console.error('fetch-fallback failed:', err);
  process.exit(1);
});

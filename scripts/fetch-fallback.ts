/**
 * Regenerate public/fallback-stars.json from the live ESA Gaia archive.
 *
 *   npm run fetch-fallback
 *
 * The Gaia TAP endpoint already returns FORMAT=json as { metadata, data },
 * which is exactly the shape the app parses, so we save the response verbatim.
 * Run this whenever you want to refresh the committed offline dataset.
 *
 * Requires network access to https://gea.esac.esa.int (Node 18+ global fetch).
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const TAP_URL = 'https://gea.esac.esa.int/tap-server/tap/sync';

const ADQL =
  'SELECT TOP 5000 source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag, bp_rp ' +
  'FROM gaiadr3.gaia_source ' +
  'WHERE parallax > 20 AND parallax_over_error > 10 AND phot_g_mean_mag < 10 ' +
  'ORDER BY phot_g_mean_mag ASC';

async function main(): Promise<void> {
  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'json',
    QUERY: ADQL,
  });

  console.log('Querying Gaia DR3 …');

  const res = await fetch(TAP_URL, { method: 'POST', body });
  if (!res.ok) {
    throw new Error(`Gaia TAP HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: unknown[] };
  const rows = Array.isArray(json.data) ? json.data.length : 0;
  if (rows === 0) throw new Error('Gaia returned 0 rows — check the query.');

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '..', 'public', 'fallback-stars.json');
  await writeFile(outPath, JSON.stringify(json), 'utf8');

  console.log(`Wrote ${rows} stars to ${outPath}`);
}

main().catch((err) => {
  console.error('fetch-fallback failed:', err);
  process.exit(1);
});

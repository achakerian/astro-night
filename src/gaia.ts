import type { GaiaTapJson, LoadResult, NamedStar, Star } from './types';
import { angularSeparationDeg, distanceParsecs } from './transform';

const TAP_URL = 'https://gea.esac.esa.int/tap-server/tap/sync';

const ADQL = `SELECT TOP 5000
  source_id, ra, dec, parallax,
  pmra, pmdec,
  phot_g_mean_mag, bp_rp
FROM gaiadr3.gaia_source
WHERE parallax > 20
  AND parallax_over_error > 10
  AND phot_g_mean_mag < 10
ORDER BY phot_g_mean_mag ASC`;

const LIVE_TIMEOUT_MS = 8000;

/** Resolve a public asset URL honouring Vite's `base` (GitHub Pages subpath). */
function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/');
}

function buildTapUrl(): string {
  const params = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'json',
    QUERY: ADQL,
  });
  return `${TAP_URL}?${params.toString()}`;
}

/** Map a Gaia TAP JSON payload (or our fallback file) to normalised stars. */
export function parseGaiaJson(json: GaiaTapJson): Star[] {
  const cols = json.metadata.map((m) => m.name.toLowerCase());
  const idx = (name: string) => cols.indexOf(name);

  const iId = idx('source_id');
  const iRa = idx('ra');
  const iDec = idx('dec');
  const iPlx = idx('parallax');
  const iPmra = idx('pmra');
  const iPmdec = idx('pmdec');
  const iMag = idx('phot_g_mean_mag');
  const iBpRp = idx('bp_rp');

  if (iRa < 0 || iDec < 0 || iPlx < 0) {
    throw new Error('Gaia payload missing required columns (ra/dec/parallax)');
  }

  const stars: Star[] = [];
  for (const row of json.data) {
    const parallax = Number(row[iPlx]);
    if (!Number.isFinite(parallax) || parallax <= 0) continue; // guards against /0
    const ra = Number(row[iRa]);
    const dec = Number(row[iDec]);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;

    stars.push({
      sourceId: String(row[iId]),
      ra,
      dec,
      distancePc: distanceParsecs(parallax),
      pmra: Number(row[iPmra]) || 0,
      pmdec: Number(row[iPmdec]) || 0,
      mag: Number(row[iMag]),
      bpRp: row[iBpRp] == null ? null : Number(row[iBpRp]),
    });
  }
  return stars;
}

/** Fetch the live Gaia query with a hard timeout. Throws on any failure. */
async function fetchLive(): Promise<Star[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  const url = buildTapUrl();
  const t0 = performance.now();
  console.info(`[gaia] live query → ${TAP_URL} (timeout ${LIVE_TIMEOUT_MS} ms)`);
  console.debug('[gaia] ADQL:\n' + ADQL);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const dt = Math.round(performance.now() - t0);
    console.info(`[gaia] response: HTTP ${res.status} ${res.statusText} in ${dt} ms`);
    if (!res.ok) throw new Error(`Gaia TAP HTTP ${res.status} ${res.statusText}`);

    const json = (await res.json()) as GaiaTapJson;
    const stars = parseGaiaJson(json);
    if (stars.length === 0) throw new Error('Gaia returned 0 usable rows');
    console.info(`[gaia] ✅ live OK: ${stars.length} stars in ${Math.round(performance.now() - t0)} ms`);
    return stars;
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a fetch failure into a short, classified, human-readable reason. */
function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return `timed out after ${LIVE_TIMEOUT_MS} ms (slow network or unresponsive server)`;
  }
  // Browsers report CORS/connection failures as an opaque TypeError.
  if (err instanceof TypeError) {
    return `network or CORS blocked the request ("${err.message}") — the Gaia TAP endpoint did not return cross-origin headers for this site`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Load the bundled fallback dataset (committed copy of the same query). */
async function fetchFallback(): Promise<Star[]> {
  const res = await fetch(asset('fallback-stars.json'));
  if (!res.ok) throw new Error(`fallback HTTP ${res.status}`);
  const json = (await res.json()) as GaiaTapJson;
  return parseGaiaJson(json);
}

/** Load the bundled named-star lookup. Never throws — returns [] on failure. */
async function fetchNamedStars(): Promise<NamedStar[]> {
  try {
    const res = await fetch(asset('named-stars.json'));
    if (!res.ok) return [];
    return (await res.json()) as NamedStar[];
  } catch {
    return [];
  }
}

/**
 * Attach common names to stars. Each named entry is matched to the closest
 * star: by exact source_id when provided, otherwise by nearest sky position
 * within a small tolerance (robust for both live and fallback data, since we
 * do not control Gaia's exact source_ids in the curated fallback).
 */
function applyNames(stars: Star[], named: NamedStar[]): void {
  const byId = new Map<string, Star>();
  for (const s of stars) byId.set(s.sourceId, s);

  const TOL_DEG = 0.6;
  for (const n of named) {
    if (n.sourceId && byId.has(n.sourceId)) {
      byId.get(n.sourceId)!.name = n.name;
      continue;
    }
    let best: Star | null = null;
    let bestSep = TOL_DEG;
    for (const s of stars) {
      if (s.name) continue;
      const sep = angularSeparationDeg(n.ra, n.dec, s.ra, s.dec);
      if (sep < bestSep) {
        bestSep = sep;
        best = s;
      }
    }
    if (best) best.name = n.name;
  }
}

/**
 * Load the star catalogue: try live Gaia first, fall back to the bundled
 * dataset on any failure (network, CORS, timeout, empty result). Named-star
 * labels are applied in both cases.
 *
 * `forceOffline` (e.g. `?offline` in the URL) skips the live attempt — handy
 * for testing the resilience path on the open night.
 */
export async function loadStars(forceOffline = false): Promise<LoadResult> {
  const named = await fetchNamedStars();
  let reason: string | undefined;

  if (!forceOffline) {
    try {
      const stars = await fetchLive();
      applyNames(stars, named);
      return { stars, source: 'live' };
    } catch (err) {
      reason = describeError(err);
      console.warn(`[gaia] ⚠️ live query failed → using bundled fallback. Reason: ${reason}`);
      console.warn('[gaia] underlying error:', err);
    }
  } else {
    reason = 'forced offline via ?offline in the URL';
    console.info('[gaia] ?offline set — skipping live query.');
  }

  const stars = await fetchFallback();
  applyNames(stars, named);
  console.info(`[gaia] bundled fallback loaded: ${stars.length} stars.`);
  return { stars, source: 'offline', reason };
}

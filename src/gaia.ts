import type { GaiaTapJson, LoadResult, NamedStar, Star } from './types';
import { angularSeparationDeg, distanceParsecs } from './transform';

const TAP_URL = 'https://gea.esac.esa.int/tap-server/tap/sync';

// Single-line query: some firewalls/WAFs reset connections on URLs (or bodies)
// containing encoded newlines, so we keep it on one line.
const ADQL =
  'SELECT TOP 5000 source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag, bp_rp ' +
  'FROM gaiadr3.gaia_source ' +
  'WHERE parallax > 20 AND parallax_over_error > 10 AND phot_g_mean_mag < 10 ' +
  'ORDER BY phot_g_mean_mag ASC';

// The Gaia sync TAP query routinely needs 10–20 s (cold cache / server load),
// so give it real headroom before falling back. Override with ?timeout=<seconds>.
const DEFAULT_TIMEOUT_MS = 20000;

/** Resolve a public asset URL honouring Vite's `base` (GitHub Pages subpath). */
function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/');
}

/** Form-encoded TAP request body (POST avoids long, newline-bearing GET URLs). */
function tapBody(): URLSearchParams {
  return new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'json',
    QUERY: ADQL,
  });
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

/** Build the GET form of the query (used when going through a CORS proxy). */
function buildGetUrl(): string {
  return `${TAP_URL}?${tapBody().toString()}`;
}

/** Public CORS proxies that fetch a URL server-side and add CORS headers. */
const DEFAULT_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
];

interface Transport {
  label: string;
  url: string;
  init: RequestInit;
}

/** Ordered list of ways to reach Gaia: direct first, then via proxies. */
function transports(proxies: string[]): Transport[] {
  const list: Transport[] = [
    // Direct POST, no custom headers → stays a "simple" CORS request.
    { label: 'direct (POST)', url: TAP_URL, init: { method: 'POST', body: tapBody() } },
  ];
  const getUrl = buildGetUrl();
  for (const p of proxies) {
    list.push({ label: `proxy ${new URL(p).host}`, url: p + encodeURIComponent(getUrl), init: {} });
  }
  return list;
}

/** Run one transport with a timeout; parse + validate. Throws on any failure. */
async function fetchVia(t: Transport, timeoutMs: number): Promise<Star[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = performance.now();
  console.info(`[gaia] trying ${t.label} → ${t.url.slice(0, 80)}… (timeout ${timeoutMs} ms)`);
  try {
    const res = await fetch(t.url, { ...t.init, signal: controller.signal });
    const dt = Math.round(performance.now() - t0);
    console.info(`[gaia] ${t.label}: HTTP ${res.status} ${res.statusText} in ${dt} ms`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const json = (await res.json()) as GaiaTapJson;
    const stars = parseGaiaJson(json);
    if (stars.length === 0) throw new Error('0 usable rows');
    console.info(`[gaia] ✅ ${t.label} OK: ${stars.length} stars in ${Math.round(performance.now() - t0)} ms`);
    return stars;
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a fetch failure into a short, classified, human-readable reason. */
function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return `timed out after ${(timeoutMs / 1000).toFixed(0)} s (slow network or unresponsive server)`;
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

export interface LoadOptions {
  /** Skip the live attempt entirely (`?offline`). */
  forceOffline?: boolean;
  /** Per-attempt timeout in ms (`?timeout=<seconds>`). */
  timeoutMs?: number;
  /**
   * CORS proxy bases to try after the direct request. `false` disables proxies
   * (`?proxy=0`); a custom base (`?proxy=https://my.proxy/?url=`) replaces them.
   */
  proxies?: string[] | false;
}

/**
 * Load the star catalogue. Tries each transport in order — direct Gaia first,
 * then any CORS proxies — and uses the first that returns rows. Falls back to
 * the bundled dataset if all fail. Named-star labels are applied in all cases.
 */
export async function loadStars(opts: LoadOptions = {}): Promise<LoadResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const proxies = opts.proxies === undefined ? DEFAULT_PROXIES : opts.proxies || [];

  const named = await fetchNamedStars();
  let reason: string | undefined;

  if (opts.forceOffline) {
    reason = 'forced offline via ?offline in the URL';
    console.info('[gaia] ?offline set — skipping live query.');
  } else {
    for (const t of transports(proxies)) {
      try {
        const stars = await fetchVia(t, timeoutMs);
        applyNames(stars, named);
        return { stars, source: 'live' };
      } catch (err) {
        reason = `${t.label} → ${describeError(err, timeoutMs)}`;
        console.warn(`[gaia] ⚠️ ${reason}`);
      }
    }
    console.warn('[gaia] all live transports failed → using bundled fallback.');
  }

  const stars = await fetchFallback();
  applyNames(stars, named);
  console.info(`[gaia] bundled fallback loaded: ${stars.length} stars.`);
  return { stars, source: 'offline', reason };
}

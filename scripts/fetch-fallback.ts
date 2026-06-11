/**
 * Grab a real nearby-star catalogue and commit it to the repo, so the app needs
 * NO network at runtime — it just loads public/fallback-stars.json.
 *
 *   npm run fetch-fallback
 *
 * Source: the HYG database (Hipparcos + Yale Bright Star + Gliese), hosted as a
 * CSV on GitHub raw — no TAP server to be down/overloaded. We try a few known
 * file paths (the repo has been reorganised over the years), keep stars within
 * ~50 pc, transform to the canonical { metadata, data } shape the app parses,
 * and also harvest the catalogue's built-in proper names into named-stars.json.
 *
 * Requires network access from the machine you run it on (GitHub raw).
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Candidate locations for the HYG CSV. First that returns 200 + parses wins.
// The first is the current file (confirmed via the GitHub tree API); the rest
// are older layouts kept as fallbacks.
const CSV_URLS = [
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v3.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/master/hygdata_v3.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hygdata_v3.csv',
];

const MAX_DISTANCE_PC = 50; // the "solar neighbourhood"
const MAG_LIMIT = 10; // visually meaningful stars
const STAR_CAP = 8000;
const NAME_CAP = 500;
const WANT = ['source_id', 'ra', 'dec', 'parallax', 'pmra', 'pmdec', 'phot_g_mean_mag', 'bp_rp'];

/** Parse a single CSV line, honouring double-quoted fields. */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchCsv(): Promise<string> {
  for (const url of CSV_URLS) {
    process.stdout.write(`Trying ${url} … `);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      console.log(`ok (${(text.length / 1e6).toFixed(1)} MB)`);
      return text;
    } catch (err) {
      console.log(`failed (${(err as Error).message})`);
    }
  }
  throw new Error('no HYG CSV URL responded');
}

interface Row {
  sid: string;
  raDeg: number;
  dec: number;
  dist: number;
  pmra: number;
  pmdec: number;
  mag: number;
  ci: number | null;
  proper: string;
}

function build(csv: string): { stars: Row[]; raInHours: boolean } {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);

  const iId = [col('id'), col('hyg'), col('hip')].find((i) => i >= 0) ?? -1;
  const iRa = col('ra');
  const iDec = col('dec');
  const iDist = col('dist');
  const iPmra = col('pmra');
  const iPmdec = col('pmdec');
  const iMag = col('mag');
  const iCi = col('ci');
  const iProper = col('proper');
  if ([iRa, iDec, iDist, iMag].some((i) => i < 0)) {
    throw new Error(`unexpected HYG columns: ${header.slice(0, 20).join(',')}`);
  }

  // Detect RA units: HYG v3 stores RA in hours (0–24); ATHYG uses degrees.
  let maxRa = 0;
  for (let i = 1; i < lines.length; i++) {
    const v = Number(parseLine(lines[i])[iRa]);
    if (Number.isFinite(v) && v > maxRa) maxRa = v;
  }
  const raInHours = maxRa <= 24.5;

  const stars: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = parseLine(lines[i]);
    const dist = Number(f[iDist]);
    const mag = Number(f[iMag]);
    if (!Number.isFinite(dist) || dist <= 0 || dist > MAX_DISTANCE_PC) continue; // excludes the Sun (dist 0)
    if (!Number.isFinite(mag) || mag > MAG_LIMIT) continue;
    const ra = Number(f[iRa]);
    const dec = Number(f[iDec]);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    const ci = iCi >= 0 ? Number(f[iCi]) : NaN;

    stars.push({
      sid: (iId >= 0 ? f[iId] : '') || `hyg-${i}`,
      raDeg: raInHours ? ra * 15 : ra,
      dec,
      dist,
      pmra: Number(f[iPmra]) || 0,
      pmdec: Number(f[iPmdec]) || 0,
      mag,
      ci: Number.isFinite(ci) ? ci : null,
      proper: iProper >= 0 ? (f[iProper] ?? '').trim() : '',
    });
  }

  stars.sort((a, b) => a.mag - b.mag);
  return { stars: stars.slice(0, STAR_CAP), raInHours };
}

async function main(): Promise<void> {
  const csv = await fetchCsv();
  const { stars, raInHours } = build(csv);
  if (stars.length === 0) throw new Error('no stars passed the distance/magnitude cut');
  console.log(`Kept ${stars.length} stars within ${MAX_DISTANCE_PC} pc (RA parsed as ${raInHours ? 'hours' : 'degrees'}).`);

  // Canonical dataset: B−V (ci) stands in for Gaia's BP−RP (close enough for
  // the colour/temperature display, and Ballesteros' temp relation uses B−V).
  const data = stars.map((s) => [
    String(s.sid),
    round(s.raDeg, 5),
    round(s.dec, 5),
    round(1000 / s.dist, 3), // parallax mas
    round(s.pmra, 2),
    round(s.pmdec, 2),
    round(s.mag, 3),
    s.ci == null ? null : round(s.ci, 3),
  ]);
  const dataset = { metadata: WANT.map((name) => ({ name })), data };

  // Proper names → position-matched labels (brightest first).
  const names = stars
    .filter((s) => s.proper)
    .slice(0, NAME_CAP)
    .map((s) => ({ name: s.proper, ra: round(s.raDeg, 4), dec: round(s.dec, 4) }));

  const here = dirname(fileURLToPath(import.meta.url));
  const pub = resolve(here, '..', 'public');
  await writeFile(resolve(pub, 'fallback-stars.json'), JSON.stringify(dataset), 'utf8');
  await writeFile(resolve(pub, 'named-stars.json'), JSON.stringify(names, null, 2), 'utf8');

  console.log(`\n✅ Wrote ${data.length} stars → public/fallback-stars.json`);
  console.log(`✅ Wrote ${names.length} named stars → public/named-stars.json`);
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

main().catch((err) => {
  console.error('fetch-fallback failed:', err);
  process.exit(1);
});

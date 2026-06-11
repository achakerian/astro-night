import type { Star } from './types';

const DEG2RAD = Math.PI / 180;

/** Light-years per parsec. */
export const LY_PER_PC = 3.261563777;

/** Distance in parsecs from a parallax in milliarcseconds. */
export function distanceParsecs(parallaxMas: number): number {
  return 1000 / parallaxMas;
}

/**
 * Position of a star `years` into the future (or past, negative), in parsecs,
 * Sun at the origin.
 *
 * Proper motion is applied as a linear displacement of (ra, dec) — the
 * small-angle approximation described in the brief. pmra/pmdec are mas/yr, so a
 * `years` offset shifts the angles by `pm * years / 3.6e6` degrees
 * (3.6e6 = milliarcseconds per degree). This is not geodesically exact over
 * ±100 kyr, but it is cheap and makes high-proper-motion stars visibly drift,
 * which is the point. Distance is held constant (we ignore radial velocity).
 *
 * Writes into `out` (length-3) to avoid per-star allocation in the hot path.
 */
export function positionAt(star: Star, years: number, out: Float32Array | number[], offset = 0): void {
  const ra = (star.ra + (star.pmra * years) / 3.6e6) * DEG2RAD;
  const dec = (star.dec + (star.pmdec * years) / 3.6e6) * DEG2RAD;
  const d = star.distancePc;
  const cosDec = Math.cos(dec);
  out[offset] = d * cosDec * Math.cos(ra);
  out[offset + 1] = d * cosDec * Math.sin(ra);
  out[offset + 2] = d * Math.sin(dec);
}

/**
 * Approximate sRGB colour for a BP−RP index, mapped along a rough stellar
 * temperature ramp: blue-white (hot, low/negative bp_rp) → white → yellow →
 * orange → red (cool, high bp_rp). Writes r,g,b in [0,1] into `out`.
 */
export function colorFromBpRp(bpRp: number | null, out: Float32Array | number[], offset = 0): void {
  // Anchor colours along the index. Values chosen to look right on a dark bg.
  const stops: { x: number; c: [number, number, number] }[] = [
    { x: -0.4, c: [0.61, 0.74, 1.0] }, // O/B blue-white
    { x: 0.0, c: [0.79, 0.86, 1.0] }, // A white-blue
    { x: 0.6, c: [1.0, 0.97, 0.92] }, // F/G white
    { x: 1.0, c: [1.0, 0.9, 0.62] }, // K yellow
    { x: 1.8, c: [1.0, 0.74, 0.42] }, // early M orange
    { x: 3.5, c: [1.0, 0.5, 0.34] }, // late M red
  ];

  const x = bpRp ?? 0.6; // unknown colour → neutral white-ish
  if (x <= stops[0].x) {
    [out[offset], out[offset + 1], out[offset + 2]] = stops[0].c;
    return;
  }
  if (x >= stops[stops.length - 1].x) {
    const c = stops[stops.length - 1].c;
    [out[offset], out[offset + 1], out[offset + 2]] = c;
    return;
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      out[offset] = a.c[0] + (b.c[0] - a.c[0]) * t;
      out[offset + 1] = a.c[1] + (b.c[1] - a.c[1]) * t;
      out[offset + 2] = a.c[2] + (b.c[2] - a.c[2]) * t;
      return;
    }
  }
}

/**
 * Point size (world units fed to the shader) from G magnitude. Brighter
 * (smaller mag) → larger. Clamped to a sensible visual range.
 */
export function sizeFromMag(mag: number): number {
  const MIN = 0.16;
  const MAX = 1.5;
  // Map mag roughly [-1.5 (Sirius) .. 11 (faint)] → [MAX .. MIN].
  const t = (mag + 1.5) / 12.5;
  const clamped = Math.min(1, Math.max(0, t));
  return MAX + (MIN - MAX) * clamped;
}

/** Distance in light-years (for the tooltip / unit toggle). */
export function parsecsToLightYears(pc: number): number {
  return pc * LY_PER_PC;
}

/**
 * Rough effective temperature (K) from BP−RP, using Ballesteros' colour–temp
 * relation with bp_rp as a stand-in for B−V. Approximate, for display only.
 */
export function tempFromBpRp(bpRp: number | null): number | null {
  if (bpRp == null) return null;
  const x = 0.92 * bpRp;
  const t = 4600 * (1 / (x + 1.7) + 1 / (x + 0.62));
  return Math.round(t / 50) * 50; // round to nearest 50 K
}

/** Approximate Morgan–Keenan spectral class letter from BP−RP. */
export function spectralClassFromBpRp(bpRp: number | null): string {
  if (bpRp == null) return '—';
  if (bpRp < -0.02) return 'B';
  if (bpRp < 0.45) return 'A';
  if (bpRp < 0.78) return 'F';
  if (bpRp < 0.98) return 'G';
  if (bpRp < 1.45) return 'K';
  return 'M';
}

/** Angular separation in degrees between two (ra,dec) points, degrees in/out. */
export function angularSeparationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const r1 = ra1 * DEG2RAD;
  const d1 = dec1 * DEG2RAD;
  const r2 = ra2 * DEG2RAD;
  const d2 = dec2 * DEG2RAD;
  const cosSep = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) / DEG2RAD;
}

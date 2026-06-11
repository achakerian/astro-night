/** One star, normalised from a Gaia row into the units we render with. */
export interface Star {
  /** Gaia DR3 source_id (string to avoid 64-bit float precision loss). */
  sourceId: string;
  /** Right ascension at epoch, degrees. */
  ra: number;
  /** Declination at epoch, degrees. */
  dec: number;
  /** Distance from the Sun, parsecs (= 1000 / parallax_mas). */
  distancePc: number;
  /** Proper motion in RA (μα*, already includes cos δ), mas/yr. */
  pmra: number;
  /** Proper motion in Dec, mas/yr. */
  pmdec: number;
  /** Gaia G-band mean magnitude. */
  mag: number;
  /** BP−RP colour index (bluer ≈ 0 or negative, redder ≈ large), or null. */
  bpRp: number | null;
  /** Resolved common name, if this star matched the named-star lookup. */
  name?: string;
}

export type DataSource = 'live' | 'offline';

export interface LoadResult {
  stars: Star[];
  source: DataSource;
  /** Human-readable reason the live query was not used (offline only). */
  reason?: string;
}

/** A famous star to label, keyed by approximate sky position (and optional id). */
export interface NamedStar {
  name: string;
  /** Approximate RA, degrees (J2000). */
  ra: number;
  /** Approximate Dec, degrees (J2000). */
  dec: number;
  /** Gaia DR3 source_id, if known — takes priority over position matching. */
  sourceId?: string;
}

/** Raw ESA Gaia TAP `FORMAT=json` payload (also the shape of our fallback file). */
export interface GaiaTapJson {
  metadata: { name: string }[];
  data: (string | number | null)[][];
}

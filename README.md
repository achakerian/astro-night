# Gaia Local Neighbourhood — Interactive 3D Star Map

A static, browser-based 3D visualisation of the nearby stars, built for an
astronomy open night. Fly through the real solar neighbourhood (~50 parsecs),
hover to identify named stars, and drag a time slider to watch constellations
deform over ±100,000 years as proper motion carries the stars across the sky.

- **Zero backend** — pure static site, deployable to GitHub Pages.
- **Live data** from the [ESA Gaia DR3 archive](https://gea.esac.esa.int/) via a
  TAP/ADQL query, with a **bundled fallback dataset** so a flaky venue network
  never breaks the show.
- **Three.js** GPU point field; targets 60 fps with thousands of stars.

## Quick start

```bash
npm install
npm run dev      # serves a working 3D star field at http://localhost:5173
```

```bash
npm run build    # type-checks and produces dist/ (works from a subpath)
npm run preview  # serve the production build locally
```

## How it works

On load the app fires the bounded ADQL query below at the Gaia synchronous TAP
endpoint (8 s timeout). On success you see a green **“Live Gaia data”** chip; on
any failure (network, CORS, timeout, empty result) it silently falls back to
`public/fallback-stars.json` and shows an amber **“Offline sample data”** chip.

```sql
SELECT TOP 5000
  source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag, bp_rp
FROM gaiadr3.gaia_source
WHERE parallax > 20 AND parallax_over_error > 10 AND phot_g_mean_mag < 10
ORDER BY phot_g_mean_mag ASC
```

Each star is placed in 3D by converting `(ra, dec, distance = 1000/parallax)`
to Cartesian parsecs with the Sun at the origin. Colour comes from the `bp_rp`
index along a stellar-temperature ramp; point size from `phot_g_mean_mag`. The
time slider applies a linear proper-motion displacement to every star's
`(ra, dec)` and rewrites the GPU position buffer in place each frame.

### Controls

| Action | Control |
| --- | --- |
| Orbit | drag (left mouse / one finger) |
| Zoom | scroll / pinch |
| Pan | right-drag |
| Identify a star | hover (mouse) or tap (touch) |
| Time machine | drag the slider, or press ▶ to auto-animate (ping-pong) |
| Reset framing | **Reset view** |
| Jump to present | **Now (t=0)** |
| Distance units | **light-years** checkbox (pc ↔ ly) |

Append `?offline` to the URL to force the fallback path for testing.

## Data files

- `public/fallback-stars.json` — committed copy of the query result, in the Gaia
  TAP `FORMAT=json` shape (`{ metadata, data }`), parsed by the same code path as
  live data. The version in the repo is a **curated set of real nearby stars**
  (approximate, not science-grade) so the offline mode still looks like the real
  sky. Regenerate the full ~5000-star set with:

  ```bash
  npm run fetch-fallback   # needs network access to gea.esac.esa.int
  ```

- `public/named-stars.json` — editable lookup of famous nearby stars. Each entry
  is matched to the closest star by sky position (within ~0.6°), so it labels
  both live and fallback data without needing exact Gaia `source_id`s. Add your
  own entries as `{ "name": "...", "ra": <deg>, "dec": <deg> }`.

## Deploying to GitHub Pages

1. Push this repo to GitHub. The repo name must match `base` in
   `vite.config.ts` (currently `/astro-night/`). If your repo has a different
   name, update that one value.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub
   Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` runs
   `npm ci && npm run build` and publishes `dist/` via the official Pages flow.

## Project layout

```
src/
  main.ts          bootstrap, scene, render loop, resize
  gaia.ts          TAP query + fallback load + parse + named-star matching
  transform.ts     coordinate + proper-motion + colour/size maths
  stars.ts         THREE.Points field (custom shader) + Sun marker
  interaction.ts   OrbitControls + raycast picking + tooltip
  ui.ts            slider, play/reset/now, unit toggle, status chip
  types.ts         shared types
  style.css        dark full-screen UI
public/            fallback-stars.json, named-stars.json
scripts/           fetch-fallback.ts
.github/workflows/ deploy.yml
```

## Credits

- Star data: the **HYG database** (Hipparcos + Yale Bright Star + Gliese),
  compiled by David Nash / astronexus. Refresh with `npm run fetch-fallback`.
- Planet textures: **Solar System Scope** (solarsystemscope.com/textures),
  licensed **CC BY 4.0**. Download with `npm run fetch-textures` (saved to
  `public/textures/`). The inspector renders each star as a representative
  planet; the mapping is artistic, not physical.

## Notes & limitations

- Proper motion uses a linear small-angle displacement of `(ra, dec)` and ignores
  radial velocity — fine for visualising drift, not for precise positions at
  ±100 kyr.
- The live query magnitude limit (`G < 10`) excludes the faintest red dwarfs
  (e.g. Proxima Centauri), so not every famous neighbour appears in live mode.

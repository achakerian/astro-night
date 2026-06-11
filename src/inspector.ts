import * as THREE from 'three';
import type { Star } from './types';
import {
  parsecsToLightYears,
  spectralClassFromBpRp,
  tempFromBpRp,
} from './transform';
import { WikiPopup } from './wiki';

/** One spec row: label, value, and optional hover help + Wikipedia topic. */
interface SpecItem {
  k: string;
  v: string;
  explain?: string;
  wiki?: string;
}

/** Absolute G magnitude of the Sun, for luminosity estimates. */
const M_SUN_G = 4.67;
const T_SUN = 5772;

const BASE_Z = 3.0;
const FAR_Z = 7.6;
const INTRO_DUR = 1.1; // seconds for the zoom-in

/**
 * Full-screen "inspector": a detailed, slowly rotating render of the selected
 * object on the left and its specs on the right. Stars are visualised as
 * Terra-Genesis-style procedural planets (oceans, continents, ice caps,
 * clouds, atmosphere); the Sun is rendered as a glowing star. The camera zooms
 * in on open. Has its own little WebGL renderer/scene.
 */
export class StarInspector {
  private readonly overlay: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly unitsBtn: HTMLElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly planetMat: THREE.ShaderMaterial;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly coronaMat: THREE.ShaderMaterial;
  private readonly body: THREE.Mesh;
  private readonly group = new THREE.Group();

  private readonly wiki = new WikiPopup();
  private readonly tip: HTMLElement;

  private time = 0;
  private introT = 1;
  private canvasW = 0;
  private canvasH = 0;
  private useLightYears = false;
  private current: Star | 'sun' | null = null;

  open = false;

  constructor(onClose: () => void, onToggleUnits: () => void) {
    this.overlay = byId('inspector');
    this.canvas = byId<HTMLCanvasElement>('inspector-canvas');
    this.titleEl = byId('inspector-title');
    this.subEl = byId('inspector-sub');
    this.bodyEl = byId('inspector-body');
    this.unitsBtn = byId('inspector-units');
    byId('inspector-close').addEventListener('click', onClose);
    this.unitsBtn.addEventListener('click', onToggleUnits);

    // Hover tooltip for spec explanations.
    this.tip = document.createElement('div');
    this.tip.className = 'tooltip spec-tip';
    this.tip.hidden = true;
    this.overlay.appendChild(this.tip);

    // Row interactions (delegated, since rows are re-rendered each open):
    // hover → explanation tooltip, click → Wikipedia popup for the topic.
    this.bodyEl.addEventListener('pointermove', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.spec[data-explain]');
      if (row) {
        this.tip.textContent = row.dataset.explain ?? '';
        this.tip.style.left = `${e.clientX}px`;
        this.tip.style.top = `${e.clientY}px`;
        this.tip.hidden = false;
      } else {
        this.tip.hidden = true;
      }
    });
    this.bodyEl.addEventListener('pointerleave', () => (this.tip.hidden = true));
    this.bodyEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.spec[data-wiki]');
      if (row?.dataset.wiki) {
        this.tip.hidden = true;
        void this.wiki.show(row.dataset.wiki);
      }
    });

    // Clicking the object's name opens its own Wikipedia article.
    this.titleEl.addEventListener('click', () => {
      const w = this.titleEl.dataset.wiki;
      if (w) void this.wiki.show(w);
    });

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0, BASE_Z);

    this.planetMat = makePlanetMaterial();
    this.starMat = makeStarSurfaceMaterial();
    this.body = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), this.planetMat);
    this.group.add(this.body);

    this.coronaMat = makeCoronaMaterial();
    const corona = new THREE.Mesh(new THREE.SphereGeometry(1.3, 48, 48), this.coronaMat);
    this.group.add(corona);

    this.group.rotation.z = 0.32; // axial tilt so ice caps + rotation read
    this.scene.add(this.group);
  }

  setUnits(useLightYears: boolean): void {
    this.useLightYears = useLightYears;
    this.unitsBtn.textContent = useLightYears ? 'Show in parsecs' : 'Show in light-years';
    if (this.current === 'sun') this.renderSunSpecs();
    else if (this.current) this.renderStarSpecs(this.current);
  }

  close(): void {
    this.open = false;
    this.current = null;
    this.overlay.hidden = true;
  }

  openSun(): void {
    this.current = 'sun';
    // The Sun is a star — render it glowing, not as a planet.
    this.body.material = this.starMat;
    this.starMat.uniforms.uColor.value.setRGB(1.0, 0.93, 0.74);
    this.starMat.uniforms.uSpots.value = 0.25;
    this.coronaMat.uniforms.uColor.value.setRGB(1.0, 0.85, 0.55);
    this.coronaMat.uniforms.uIntensity.value = 1.0;
    this.renderSunSpecs();
    this.show();
  }

  openStar(star: Star): void {
    this.current = star;
    this.body.material = this.planetMat;
    this.configurePlanet(star);
    this.renderStarSpecs(star);
    this.show();
  }

  /** Advance + render the inspector scene (called each frame while open). */
  update(dt: number): void {
    if (!this.open) return;
    this.syncSize();
    this.time += dt;
    this.planetMat.uniforms.uTime.value = this.time;
    this.starMat.uniforms.uTime.value = this.time;
    this.group.rotation.y += dt * 0.12;

    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / INTRO_DUR);
      const e = 1 - Math.pow(1 - this.introT, 3); // ease-out cubic
      this.camera.position.z = FAR_Z + (BASE_Z - FAR_Z) * e;
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ---- internals ----------------------------------------------------------

  private show(): void {
    this.overlay.hidden = false;
    this.open = true;
    this.time = 0;
    this.introT = 0; // trigger the zoom-in
    this.camera.position.z = FAR_Z;
    this.group.rotation.y = 0;
    this.syncSize(true);
  }

  /** Pick a plausible world appearance from the star's physical properties. */
  private configurePlanet(star: Star): void {
    const u = this.planetMat.uniforms;
    const seed = hashStr(star.sourceId) % 1000;
    const temp = tempFromBpRp(star.bpRp) ?? 5200;

    // Biome by temperature: cool → icy ocean world, temperate → green/blue,
    // warm → savannah, hot → arid/desert, very hot → molten rock (no water).
    let veg: [number, number, number];
    let iceAmount: number;
    let hasWater: number;
    let seaLevel = 0.46 + ((seed % 17) / 17) * 0.12 - 0.06; // 0.40–0.52 jitter

    if (temp < 3800) {
      veg = [0.32, 0.46, 0.5];
      iceAmount = 0.7;
      hasWater = 1;
    } else if (temp < 5200) {
      veg = [0.2, 0.42, 0.22];
      iceAmount = 0.45;
      hasWater = 1;
    } else if (temp < 7000) {
      veg = [0.26, 0.5, 0.2];
      iceAmount = 0.32;
      hasWater = 1;
    } else if (temp < 9500) {
      veg = [0.55, 0.42, 0.22];
      iceAmount = 0.16;
      hasWater = 1;
      seaLevel -= 0.1; // drier
    } else {
      veg = [0.45, 0.22, 0.12];
      iceAmount = 0.0;
      hasWater = 0; // molten / rocky
    }

    u.uSeed.value = seed * 1.37;
    u.uSeaLevel.value = seaLevel;
    u.uVegTint.value.setRGB(veg[0], veg[1], veg[2]);
    u.uIceAmount.value = iceAmount;
    u.uHasWater.value = hasWater;
    u.uLava.value = hasWater === 0 ? 1 : 0;

    // Atmosphere colour: watery worlds get a blue halo, arid worlds a thin
    // tan one, molten worlds a hot orange glow.
    if (hasWater === 0) this.coronaMat.uniforms.uColor.value.setRGB(1.0, 0.45, 0.2);
    else if (temp > 7000) this.coronaMat.uniforms.uColor.value.setRGB(0.7, 0.6, 0.45);
    else this.coronaMat.uniforms.uColor.value.setRGB(0.45, 0.66, 1.0);
    this.coronaMat.uniforms.uIntensity.value = 0.7;
  }

  private syncSize(force = false): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!force && w === this.canvasW && h === this.canvasH) return;
    if (w === 0 || h === 0) return;
    this.canvasW = w;
    this.canvasH = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private renderSunSpecs(): void {
    this.titleEl.textContent = 'The Sun';
    this.titleEl.dataset.wiki = 'Sun';
    this.titleEl.classList.add('inspector__title--link');
    this.subEl.textContent = 'G2V · main-sequence · ≈ 4.6 Gyr old';
    this.bodyEl.innerHTML = specRows([
      { k: 'Spectral class', v: 'G2V (yellow dwarf)', explain: EXPLAIN.spectral, wiki: 'Stellar_classification' },
      { k: 'Distance', v: '0 — you are here', explain: EXPLAIN.distance, wiki: 'Parsec' },
      { k: 'Apparent magnitude', v: '≈ −26.7 (from Earth)', explain: EXPLAIN.appMag, wiki: 'Apparent_magnitude' },
      { k: 'Absolute magnitude', v: `${M_SUN_G.toFixed(2)} (G)`, explain: EXPLAIN.absMag, wiki: 'Absolute_magnitude' },
      { k: 'Surface temperature', v: `≈ ${T_SUN.toLocaleString('en-US')} K`, explain: EXPLAIN.temp, wiki: 'Effective_temperature' },
      { k: 'Luminosity', v: '1 L☉ (by definition)', explain: EXPLAIN.lum, wiki: 'Solar_luminosity' },
      { k: 'Radius', v: '1 R☉ ≈ 696,000 km', explain: EXPLAIN.radius, wiki: 'Solar_radius' },
      { k: 'Mass', v: '1 M☉ ≈ 1.989 × 10³⁰ kg', explain: 'The Sun’s mass, the standard unit for stellar masses (M☉).', wiki: 'Solar_mass' },
    ]);
  }

  private renderStarSpecs(star: Star): void {
    this.titleEl.textContent = star.name ?? 'Unnamed star';
    // Named stars link to their own Wikipedia article; unnamed ones don't.
    if (star.name) {
      this.titleEl.dataset.wiki = star.name;
      this.titleEl.classList.add('inspector__title--link');
    } else {
      delete this.titleEl.dataset.wiki;
      this.titleEl.classList.remove('inspector__title--link');
    }

    const cls = spectralClassFromBpRp(star.bpRp);
    const temp = tempFromBpRp(star.bpRp);
    const pc = star.distancePc;
    const ly = parsecsToLightYears(pc);

    this.subEl.textContent =
      `${cls === '—' ? 'Unknown class' : `${cls}-type star`} · ` +
      `${this.useLightYears ? `${ly.toFixed(1)} ly` : `${pc.toFixed(1)} pc`} away`;

    const haveMag = Number.isFinite(star.mag) && pc > 0;
    const absMag = haveMag ? star.mag - 5 * Math.log10(pc) + 5 : null;
    const lum = absMag == null ? null : Math.pow(10, (M_SUN_G - absMag) / 2.5);
    const radius = lum != null && temp ? Math.sqrt(lum) * Math.pow(T_SUN / temp, 2) : null;
    const totalPm = Math.hypot(star.pmra, star.pmdec);

    const dist = this.useLightYears
      ? `${ly.toFixed(2)} ly (${pc.toFixed(2)} pc)`
      : `${pc.toFixed(2)} pc (${ly.toFixed(2)} ly)`;

    this.bodyEl.innerHTML = specRows([
      { k: 'Spectral class', v: cls === '—' ? 'unknown' : `${cls}-type`, explain: EXPLAIN.spectral, wiki: 'Stellar_classification' },
      { k: 'Distance', v: dist, explain: EXPLAIN.distance, wiki: 'Parsec' },
      { k: 'Apparent magnitude', v: haveMag ? `${star.mag.toFixed(2)} (G)` : '—', explain: EXPLAIN.appMag, wiki: 'Apparent_magnitude' },
      { k: 'Absolute magnitude', v: absMag == null ? '—' : `${absMag.toFixed(2)} (G)`, explain: EXPLAIN.absMag, wiki: 'Absolute_magnitude' },
      { k: 'Est. temperature', v: temp ? `≈ ${temp.toLocaleString('en-US')} K` : '—', explain: EXPLAIN.temp, wiki: 'Effective_temperature' },
      { k: 'Est. luminosity', v: lum == null ? '—' : `≈ ${fmtRatio(lum)} L☉`, explain: EXPLAIN.lum, wiki: 'Luminosity' },
      { k: 'Est. radius', v: radius == null ? '—' : `≈ ${fmtRatio(radius)} R☉`, explain: EXPLAIN.radius, wiki: 'Solar_radius' },
      { k: 'Colour index (BP−RP)', v: star.bpRp == null ? '—' : star.bpRp.toFixed(2), explain: EXPLAIN.color, wiki: 'Color_index' },
      { k: 'Proper motion', v: `${totalPm.toFixed(0)} mas/yr`, explain: EXPLAIN.pm, wiki: 'Proper_motion' },
      { k: '  ↳ RA / Dec', v: `${star.pmra.toFixed(0)} / ${star.pmdec.toFixed(0)} mas/yr`, explain: EXPLAIN.pmComponents, wiki: 'Proper_motion' },
      { k: 'Sky position', v: `RA ${star.ra.toFixed(2)}°, Dec ${star.dec.toFixed(2)}°`, explain: EXPLAIN.skyPos, wiki: 'Equatorial_coordinate_system' },
    ]);
  }
}

function fmtRatio(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v.toExponential(1);
}

/** Short, plain-language explanations shown on hover for each spec row. */
const EXPLAIN = {
  spectral: 'A star’s class (O B A F G K M), ordered hottest to coolest, set by its temperature and spectral lines.',
  distance: 'How far away the star is. 1 parsec ≈ 3.26 light-years; a light-year is the distance light travels in a year.',
  appMag: 'How bright the star looks from Earth (Gaia G band). Smaller — even negative — means brighter.',
  absMag: 'How bright the star would appear from a standard 10 parsecs: its true brightness on the magnitude scale.',
  temp: 'The star’s surface (effective) temperature in kelvin, estimated here from its colour.',
  lum: 'Total energy the star radiates, relative to the Sun (L☉). Estimated from its brightness and distance.',
  radius: 'The star’s physical size relative to the Sun (R☉), inferred from its luminosity and temperature.',
  color: 'The blue minus red Gaia magnitude. Larger values mean a redder, cooler star; near zero is white-blue.',
  pm: 'How fast the star drifts across the sky each year, in milliarcseconds per year (1 mas = 1/3,600,000°).',
  pmComponents: 'The proper motion split into east–west (RA) and north–south (Dec) components.',
  skyPos: 'Right ascension and declination — the sky’s longitude and latitude — locating the star on the celestial sphere.',
} as const;

function specRows(items: SpecItem[]): string {
  return items
    .map((it) => {
      const cls = it.wiki ? 'spec spec--link' : 'spec';
      const attrs =
        (it.explain ? ` data-explain="${escapeAttr(it.explain)}"` : '') +
        (it.wiki ? ` data-wiki="${escapeAttr(it.wiki)}"` : '');
      return `<div class="${cls}"${attrs}><span class="spec__k">${escapeHtml(it.k)}</span><span class="spec__v">${escapeHtml(it.v)}</span></div>`;
    })
    .join('');
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// ---- shaders --------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
  float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x),
                   mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                   mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*vnoise(p); p*=2.04; a*=0.5; } return v; }
`;

/** Terra-Genesis-style procedural planet: oceans, land, ice caps, clouds. */
function makePlanetMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uSeaLevel: { value: 0.46 },
      uVegTint: { value: new THREE.Color(0.2, 0.45, 0.2) },
      uIceAmount: { value: 0.4 },
      uHasWater: { value: 1 },
      uLava: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vWorldN;
      void main(){
        vObj = position;
        vWorldN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vWorldN;
      uniform float uTime, uSeed, uSeaLevel, uIceAmount, uHasWater, uLava;
      uniform vec3 uVegTint;
      ${NOISE_GLSL}
      void main(){
        vec3 p = normalize(vObj);
        vec3 sp = p * 1.8 + vec3(uSeed);
        float h = fbm(sp * 1.7) * 0.6 + fbm(sp * 4.5) * 0.4;

        float lat = abs(p.y);
        float caps = smoothstep(0.74 - uIceAmount*0.4, 0.9 - uIceAmount*0.4, lat + fbm(sp*7.0)*0.07);

        vec3 col;
        float water = 0.0;
        if (uLava > 0.5) {
          // molten world: glowing cracks of lava through dark rock
          float lava = smoothstep(0.45, 0.62, fbm(sp*3.0 + vec3(uTime*0.05)));
          vec3 rock = vec3(0.18, 0.10, 0.09);
          vec3 hot  = mix(vec3(0.9,0.25,0.05), vec3(1.0,0.85,0.3), lava);
          col = mix(rock, hot, lava);
        } else if (uHasWater > 0.5 && h < uSeaLevel) {
          float d = (uSeaLevel - h) / max(uSeaLevel, 0.001);
          col = mix(vec3(0.0,0.42,0.55), vec3(0.01,0.09,0.30), d);
          water = 1.0;
        } else {
          float land = (h - uSeaLevel) / (1.0 - uSeaLevel + 0.001);
          vec3 beach = vec3(0.82,0.74,0.52);
          vec3 rock  = vec3(0.42,0.36,0.30);
          vec3 snow  = vec3(0.95,0.96,1.0);
          col = mix(beach, uVegTint, smoothstep(0.02, 0.2, land));
          col = mix(col, rock, smoothstep(0.45, 0.72, land));
          col = mix(col, snow, smoothstep(0.78, 0.93, land));
        }
        col = mix(col, vec3(0.95,0.97,1.0), caps);

        // drifting clouds (skip for molten worlds)
        if (uLava < 0.5) {
          float cloud = smoothstep(0.56, 0.74, fbm(sp*2.6 + vec3(uTime*0.02, 0.0, uTime*0.013)));
          col = mix(col, vec3(1.0), cloud * 0.55);
        }

        // day/night lighting (fixed light, planet rotates underneath)
        vec3 L = normalize(vec3(0.7, 0.42, 0.55));
        float diff = max(dot(normalize(vWorldN), L), 0.0);
        float emissive = uLava * 0.6; // lava self-glows on the night side
        col *= clamp(0.06 + diff + emissive, 0.0, 1.35);
        col += water * pow(diff, 24.0) * 0.6; // specular sun-glint on oceans
        // warm terminator band
        float term = smoothstep(0.0,0.22,diff) * (1.0 - smoothstep(0.22,0.55,diff));
        col += vec3(0.3,0.14,0.05) * term * 0.35;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Self-luminous star surface: granulation, sunspots, limb darkening. */
function makeStarSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uTime: { value: 0 },
      uSpots: { value: 0.3 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main(){
        vObj = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        vNormalV = normalMatrix * normal;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uSpots;
      ${NOISE_GLSL}
      void main(){
        vec3 dir = normalize(vObj);
        float large = fbm(dir*4.0 + vec3(0.0, uTime*0.04, 0.0));
        float fine  = fbm(dir*13.0 + vec3(uTime*0.08, 0.0, 0.0));
        float surface = mix(large, fine, 0.45);
        vec3 col = uColor * (0.72 + 0.55*surface);
        col += uColor * 0.35 * smoothstep(0.72, 1.0, surface);
        float spot = smoothstep(0.52, 0.34, fbm(dir*6.0 + 11.0));
        col *= 1.0 - uSpots * 0.7 * spot;
        float ndv = clamp(dot(normalize(vNormalV), normalize(-vViewPos)), 0.0, 1.0);
        col *= mix(0.4, 1.05, pow(ndv, 0.6));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Additive rim-glow shell — corona for stars, atmosphere for planets. */
function makeCoronaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Color(0.45, 0.66, 1.0) },
      uIntensity: { value: 0.7 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        vNormalV = normalMatrix * normal;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      uniform vec3 uColor;
      uniform float uIntensity;
      void main(){
        float ndv = clamp(dot(normalize(vNormalV), normalize(-vViewPos)), 0.0, 1.0);
        float rim = pow(1.0 - ndv, 2.6);
        gl_FragColor = vec4(uColor, rim * uIntensity);
      }
    `,
  });
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function escapeAttr(s: string): string {
  return s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!);
}

import * as THREE from 'three';
import type { Star } from './types';
import {
  colorFromBpRp,
  parsecsToLightYears,
  spectralClassFromBpRp,
  tempFromBpRp,
} from './transform';

/** Absolute G magnitude of the Sun, for luminosity estimates. */
const M_SUN_G = 4.67;
const T_SUN = 5772;

/**
 * Full-screen "inspector": a detailed, slowly rotating render of the selected
 * star on the left (procedural surface + corona, driven by the star's colour
 * and temperature) and its specifications on the right. Has its own little
 * WebGL renderer/scene so it can show the object large and close-up.
 */
export class StarInspector {
  private readonly overlay: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly bodyEl: HTMLElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly coronaMat: THREE.ShaderMaterial;
  private readonly starMesh: THREE.Mesh;
  private readonly group = new THREE.Group();

  private time = 0;
  private canvasW = 0;
  private canvasH = 0;
  private useLightYears = false;
  private current: Star | 'sun' | null = null;

  open = false;

  constructor(onClose: () => void) {
    this.overlay = byId('inspector');
    this.canvas = byId<HTMLCanvasElement>('inspector-canvas');
    this.titleEl = byId('inspector-title');
    this.subEl = byId('inspector-sub');
    this.bodyEl = byId('inspector-body');
    byId('inspector-close').addEventListener('click', onClose);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.2);

    this.starMat = makeStarSurfaceMaterial();
    this.starMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), this.starMat);
    this.group.add(this.starMesh);

    this.coronaMat = makeCoronaMaterial();
    const corona = new THREE.Mesh(new THREE.SphereGeometry(1.35, 48, 48), this.coronaMat);
    this.group.add(corona);

    this.group.rotation.z = 0.25; // slight tilt so rotation reads
    this.scene.add(this.group);
  }

  setUnits(useLightYears: boolean): void {
    this.useLightYears = useLightYears;
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
    this.configureAppearance([1.0, 0.93, 0.74], T_SUN, 0.25);
    this.renderSunSpecs();
    this.show();
  }

  openStar(star: Star): void {
    this.current = star;
    const rgb = new Float32Array(3);
    colorFromBpRp(star.bpRp, rgb, 0);
    const temp = tempFromBpRp(star.bpRp) ?? 5000;
    // Cooler stars get more/darker spots and stronger granulation.
    const spots = THREE.MathUtils.clamp((5800 - temp) / 3200, 0, 0.9);
    this.configureAppearance([rgb[0], rgb[1], rgb[2]], temp, spots);
    this.renderStarSpecs(star);
    this.show();
  }

  /** Advance + render the inspector scene (called each frame while open). */
  update(dt: number): void {
    if (!this.open) return;
    this.syncSize();
    this.time += dt;
    this.starMat.uniforms.uTime.value = this.time;
    this.group.rotation.y += dt * 0.15;
    this.renderer.render(this.scene, this.camera);
  }

  // ---- internals ----------------------------------------------------------

  private show(): void {
    this.overlay.hidden = false;
    this.open = true;
    this.time = 0;
    this.group.rotation.y = 0;
    this.syncSize(true);
  }

  private configureAppearance(rgb: [number, number, number], temp: number, spots: number): void {
    const c = new THREE.Color(rgb[0], rgb[1], rgb[2]);
    this.starMat.uniforms.uColor.value.copy(c);
    this.starMat.uniforms.uSpots.value = spots;
    this.coronaMat.uniforms.uColor.value.copy(c);
    // Hotter stars: tighter, brighter corona.
    this.coronaMat.uniforms.uIntensity.value = THREE.MathUtils.clamp(temp / 9000, 0.35, 1.1);
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
    this.subEl.textContent = 'G2V · main-sequence · ≈ 4.6 Gyr old';
    this.bodyEl.innerHTML = specRows([
      ['Spectral class', 'G2V (yellow dwarf)'],
      ['Distance', '0 — you are here'],
      ['Apparent magnitude', '≈ −26.7 (from Earth)'],
      ['Absolute magnitude', `${M_SUN_G.toFixed(2)} (G)`],
      ['Surface temperature', `≈ ${T_SUN.toLocaleString('en-US')} K`],
      ['Luminosity', '1 L☉ (by definition)'],
      ['Radius', '1 R☉ ≈ 696,000 km'],
      ['Mass', '1 M☉ ≈ 1.989 × 10³⁰ kg'],
    ]);
  }

  private renderStarSpecs(star: Star): void {
    this.titleEl.textContent = star.name ?? 'Unnamed star';

    const cls = spectralClassFromBpRp(star.bpRp);
    const temp = tempFromBpRp(star.bpRp);
    const pc = star.distancePc;
    const ly = parsecsToLightYears(pc);

    this.subEl.textContent =
      `${cls === '—' ? 'Unknown class' : `${cls}-type star`} · ` +
      `${this.useLightYears ? `${ly.toFixed(1)} ly` : `${pc.toFixed(1)} pc`} away`;

    // Derived physics (rough, G-band, for display): absolute magnitude →
    // luminosity → radius via Stefan–Boltzmann.
    const haveMag = Number.isFinite(star.mag) && pc > 0;
    const absMag = haveMag ? star.mag - 5 * Math.log10(pc) + 5 : null;
    const lum = absMag == null ? null : Math.pow(10, (M_SUN_G - absMag) / 2.5);
    const radius = lum != null && temp ? Math.sqrt(lum) * Math.pow(T_SUN / temp, 2) : null;
    const totalPm = Math.hypot(star.pmra, star.pmdec);

    const dist = this.useLightYears
      ? `${ly.toFixed(2)} ly (${pc.toFixed(2)} pc)`
      : `${pc.toFixed(2)} pc (${ly.toFixed(2)} ly)`;

    this.bodyEl.innerHTML = specRows([
      ['Spectral class', cls === '—' ? 'unknown' : `${cls}-type`],
      ['Distance', dist],
      ['Apparent magnitude', haveMag ? `${star.mag.toFixed(2)} (G)` : '—'],
      ['Absolute magnitude', absMag == null ? '—' : `${absMag.toFixed(2)} (G)`],
      ['Est. temperature', temp ? `≈ ${temp.toLocaleString('en-US')} K` : '—'],
      ['Est. luminosity', lum == null ? '—' : `≈ ${fmtRatio(lum)} L☉`],
      ['Est. radius', radius == null ? '—' : `≈ ${fmtRatio(radius)} R☉`],
      ['Colour index (BP−RP)', star.bpRp == null ? '—' : star.bpRp.toFixed(2)],
      ['Proper motion', `${totalPm.toFixed(0)} mas/yr`],
      ['  ↳ RA / Dec', `${star.pmra.toFixed(0)} / ${star.pmdec.toFixed(0)} mas/yr`],
      ['Sky position', `RA ${star.ra.toFixed(2)}°, Dec ${star.dec.toFixed(2)}°`],
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

function specRows(items: [string, string][]): string {
  return items
    .map(
      ([k, v]) =>
        `<div class="spec"><span class="spec__k">${escapeHtml(k)}</span><span class="spec__v">${escapeHtml(v)}</span></div>`,
    )
    .join('');
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
  float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
`;

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
        // bright granule cores
        col += uColor * 0.35 * smoothstep(0.72, 1.0, surface);
        // sunspots in low-noise regions, scaled by spottiness
        float spot = smoothstep(0.52, 0.34, fbm(dir*6.0 + 11.0));
        col *= 1.0 - uSpots * 0.7 * spot;

        // limb darkening
        float ndv = clamp(dot(normalize(vNormalV), normalize(-vViewPos)), 0.0, 1.0);
        col *= mix(0.4, 1.05, pow(ndv, 0.6));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Additive rim-glow corona shell around the star. */
function makeCoronaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uIntensity: { value: 0.8 },
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

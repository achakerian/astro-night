import * as THREE from 'three';
import './style.css';
import { loadStars } from './gaia';
import { StarInspector } from './inspector';
import { setupInteraction, type Selection } from './interaction';
import { StarField } from './stars';
import { Ui } from './ui';

// Initial framing: pulled back along +Z and slightly up, looking at the Sun at
// the origin, so the local star field fills the view with the galactic-plane
// spread running across the screen.
const INITIAL_CAM = new THREE.Vector3(0, 14, 34);

async function main(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0x05060a, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060a, 0.006);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.copy(INITIAL_CAM);
  camera.lookAt(0, 0, 0);

  // A faint distant starfield backdrop so the volume doesn't sit in pure black.
  scene.add(makeBackdrop());

  // ---- Load data (live Gaia → bundled fallback) -------------------------
  const params = new URLSearchParams(location.search);
  // Static by default: the committed catalogue loads with no network. Opt into
  // a live Gaia query with ?live (kept for when the archive is healthy).
  const wantLive = params.has('live');
  const timeoutSec = Number(params.get('timeout'));
  const timeoutMs = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : undefined;

  // ?proxy=0 disables CORS proxies; ?proxy=<base?url=> uses a custom one.
  const proxyParam = params.get('proxy');
  let proxies: string[] | false | undefined;
  if (proxyParam === '0' || proxyParam === 'off') proxies = false;
  else if (proxyParam) proxies = [proxyParam];

  // Only the (slow) live path needs an elapsed-time countdown.
  const loadingText = document.querySelector<HTMLElement>('.loading__text');
  let elapsed = 0;
  const ticker = wantLive
    ? window.setInterval(() => {
        elapsed += 1;
        if (loadingText) {
          loadingText.textContent = `Contacting the Gaia archive… ${elapsed}s (this can take 10–20s)`;
        }
      }, 1000)
    : undefined;

  let result;
  try {
    result = await loadStars({ live: wantLive, timeoutMs, proxies });
  } finally {
    if (ticker !== undefined) window.clearInterval(ticker);
  }
  const { stars, source, reason } = result;

  const field = new StarField(stars);
  scene.add(field.object);

  const tooltipEl = document.getElementById('tooltip') as HTMLElement;

  // ---- Selection: fly-to camera animation + follow the selected star ----
  const tmp = new THREE.Vector3();
  const flight = new CameraFlight(camera);
  let selected: Selection = null;
  const followPos = new THREE.Vector3();

  function focusTarget(sel: Exclude<Selection, null>): THREE.Vector3 {
    if (sel === 'sun') return tmp.set(0, 0, 0);
    return field.getPosition(sel, tmp);
  }

  function deselect(): void {
    selected = null;
    inspector.close();
  }

  function selectObject(sel: Selection): void {
    if (sel === null) return; // clicking empty space keeps the current selection
    selected = sel;
    const target = focusTarget(sel).clone();
    followPos.copy(target);
    // Dolly toward the object underneath the inspector overlay, so closing the
    // inspector leaves you parked next to it.
    const dist = sel === 'sun' ? 7 : 4;
    flight.flyTo(target, dist, interaction.controls.target);
    if (sel === 'sun') inspector.openSun();
    else inspector.openStar(field.stars[sel]);
  }

  // Single source of truth for distance units, kept in sync across the corner
  // checkbox, the hover tooltip, and the inspector's own toggle button.
  let useLightYears = false;
  function applyUnits(value: boolean): void {
    useLightYears = value;
    ui.syncUnits(value);
    interaction.setUnits(value);
    inspector.setUnits(value);
  }

  const inspector = new StarInspector(
    () => deselect(),
    () => applyUnits(!useLightYears),
  );
  const interaction = setupInteraction(renderer, camera, field, tooltipEl, selectObject);

  // ---- UI ---------------------------------------------------------------
  // Slider recompute is throttled to one update per animation frame: the
  // handler only records the target year; the render loop applies it once.
  let pendingYear = 0;
  let appliedYear = NaN;

  const ui = new Ui({
    onTimeChange: (years) => {
      pendingYear = years;
    },
    onUnitsChange: (useLy) => applyUnits(useLy),
    onFilterChange: (mode) => field.setFilter(mode),
  });

  ui.hideLoading();

  // Inspectable from the console: `__astroNight`
  (window as unknown as Record<string, unknown>).__astroNight = {
    source,
    reason,
    starCount: stars.length,
    named: stars.filter((s) => s.name).length,
  };

  // ---- Render loop ------------------------------------------------------
  const clock = new THREE.Clock();
  function frame(): void {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);

    ui.tick(dt); // advances the slider when playing

    if (pendingYear !== appliedYear) {
      field.update(pendingYear);
      appliedYear = pendingYear;
    }

    if (flight.active) {
      // During a fly-to, drive camera + target directly (no orbit damping).
      flight.update(dt, interaction.controls.target);
      if (!flight.active && selected !== null && selected !== 'sun') {
        followPos.copy(field.getPosition(selected, tmp)); // resync after arrival
      }
    } else {
      // Follow a moving selected star: translate the whole rig by its drift so
      // it stays centred even while the time slider runs.
      if (selected !== null && selected !== 'sun') {
        const live = field.getPosition(selected, tmp);
        camera.position.add(live.clone().sub(followPos));
        interaction.controls.target.add(live.clone().sub(followPos));
        followPos.copy(live);
      }
      interaction.controls.update();
    }

    renderer.render(scene, camera);
    inspector.update(dt); // renders the inspector's own canvas when open
  }
  frame();

  // ---- Resize -----------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  console.info(
    `[astro-night] ${stars.length} stars loaded (source: ${source}` +
      `${reason ? `, reason: ${reason}` : ''}). Inspect window.__astroNight for details.`,
  );
}

/**
 * Smooth camera fly-to. Lerps both the camera position and the orbit target
 * over a short duration; OrbitControls picks up cleanly afterwards because its
 * update() re-derives state from the live camera/target each frame.
 */
class CameraFlight {
  active = false;
  private t = 0;
  private readonly dur = 0.8;
  private readonly fromPos = new THREE.Vector3();
  private readonly toPos = new THREE.Vector3();
  private readonly fromTarget = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  flyTo(targetPos: THREE.Vector3, dist: number, currentTarget: THREE.Vector3): void {
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(currentTarget);
    // Keep the current viewing angle: approach along camera→target direction.
    this.dir.copy(this.fromPos).sub(targetPos);
    if (this.dir.lengthSq() < 1e-6) this.dir.set(0, 0.3, 1);
    this.dir.normalize();
    this.toTarget.copy(targetPos);
    this.toPos.copy(targetPos).addScaledVector(this.dir, dist);
    this.t = 0;
    this.active = true;
  }

  update(dt: number, controlsTarget: THREE.Vector3): void {
    this.t = Math.min(1, this.t + dt / this.dur);
    const e = easeInOut(this.t);
    this.camera.position.lerpVectors(this.fromPos, this.toPos, e);
    controlsTarget.lerpVectors(this.fromTarget, this.toTarget, e);
    if (this.t >= 1) this.active = false;
  }

  cancel(): void {
    this.active = false;
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Thousands of dim, static far-away points for depth — purely decorative. */
function makeBackdrop(): THREE.Points {
  const count = 1500;
  const radius = 900;
  const pos = new Float32Array(count * 3);
  // Deterministic scatter (no Math.random dependency for reproducible builds).
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963; // golden-angle spiral on a sphere
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    pos[i * 3] = Math.cos(a) * r * radius;
    pos[i * 3 + 1] = y * radius;
    pos[i * 3 + 2] = Math.sin(a) * r * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x4a5a82,
    size: 1.1,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

main().catch((err) => {
  console.error('[astro-night] fatal:', err);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.innerHTML =
      '<div class="loading__text">Could not start the star map.<br>See the console for details.</div>';
  }
});

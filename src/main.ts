import * as THREE from 'three';
import './style.css';
import { loadStars } from './gaia';
import { setupInteraction } from './interaction';
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
  const forceOffline = new URLSearchParams(location.search).has('offline');
  const { stars, source } = await loadStars(forceOffline);

  const field = new StarField(stars);
  scene.add(field.object);

  const tooltipEl = document.getElementById('tooltip') as HTMLElement;
  const interaction = setupInteraction(renderer, camera, field, tooltipEl);

  // ---- UI ---------------------------------------------------------------
  // Slider recompute is throttled to one update per animation frame: the
  // handler only records the target year; the render loop applies it once.
  let pendingYear = 0;
  let appliedYear = NaN;

  const ui = new Ui({
    onTimeChange: (years) => {
      pendingYear = years;
    },
    onReset: () => {
      interaction.controls.target.set(0, 0, 0);
      camera.position.copy(INITIAL_CAM);
      interaction.controls.update();
    },
    onUnitsChange: (useLy) => interaction.setUnits(useLy),
  });

  ui.setStatus(source);
  ui.hideLoading();

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

    interaction.controls.update();
    renderer.render(scene, camera);
  }
  frame();

  // ---- Resize -----------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  console.info(`[astro-night] ${stars.length} stars loaded (${source}).`);
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

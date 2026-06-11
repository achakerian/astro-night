import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StarField } from './stars';
import { colorFromBpRp, parsecsToLightYears } from './transform';
import type { Star } from './types';

export interface InteractionHandle {
  controls: OrbitControls;
  /** Switch tooltip distance units; refreshes any visible tooltip. */
  setUnits(useLightYears: boolean): void;
}

/**
 * Wires up OrbitControls plus pointer raycasting against the star field, and
 * drives the HTML tooltip. Works for both mouse and touch.
 */
export function setupInteraction(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  field: StarField,
  tooltipEl: HTMLElement,
): InteractionHandle {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.6;
  controls.minDistance = 1.5;
  controls.maxDistance = 400;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerActive = false;
  let useLightYears = false;
  let hovered: Star | null = null;
  let lastClientX = 0;
  let lastClientY = 0;

  const swatch = new Float32Array(3);

  function tooltipDistance(star: Star): string {
    if (useLightYears) {
      return `${parsecsToLightYears(star.distancePc).toFixed(1)} ly`;
    }
    return `${star.distancePc.toFixed(1)} pc`;
  }

  function renderTooltip(star: Star, clientX: number, clientY: number): void {
    colorFromBpRp(star.bpRp, swatch, 0);
    const css = `rgb(${(swatch[0] * 255) | 0}, ${(swatch[1] * 255) | 0}, ${(swatch[2] * 255) | 0})`;
    const name = star.name ?? 'Unnamed star';
    tooltipEl.innerHTML =
      `<div class="tooltip__name"><span class="tooltip__swatch" style="color:${css};background:${css}"></span>${escapeHtml(name)}</div>` +
      `<div class="tooltip__meta">${tooltipDistance(star)}</div>`;
    tooltipEl.style.left = `${clientX}px`;
    tooltipEl.style.top = `${clientY}px`;
    tooltipEl.hidden = false;
  }

  function clearTooltip(): void {
    hovered = null;
    tooltipEl.hidden = true;
  }

  function pick(clientX: number, clientY: number): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    // Scale the pick radius with how far we are zoomed out, so picking stays
    // comfortable whether you're skimming the Sun or viewing the whole volume.
    const camDist = camera.position.length();
    raycaster.params.Points.threshold = THREE.MathUtils.clamp(camDist * 0.012, 0.12, 2.2);
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObject(field.points, false);
    if (hits.length === 0) {
      clearTooltip();
      return;
    }
    // Prefer the star closest to the cursor ray, not merely nearest the camera.
    hits.sort((a, b) => (a.distanceToRay ?? Infinity) - (b.distanceToRay ?? Infinity));
    const index = hits[0].index;
    if (index == null) {
      clearTooltip();
      return;
    }
    hovered = field.stars[index];
    renderTooltip(hovered, clientX, clientY);
  }

  const dom = renderer.domElement;

  dom.addEventListener('pointermove', (e) => {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    // While dragging the camera, suppress the tooltip to avoid flicker.
    if ((e.buttons & 0b11) !== 0) {
      clearTooltip();
      return;
    }
    pointerActive = true;
    pick(e.clientX, e.clientY);
  });

  dom.addEventListener('pointerleave', clearTooltip);
  dom.addEventListener('pointerdown', clearTooltip);

  // Touch: tap to identify, then the tooltip lingers until the next interaction.
  dom.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType === 'touch') {
        pick(e.clientX, e.clientY);
      }
    },
    { passive: true },
  );

  return {
    controls,
    setUnits(value: boolean) {
      useLightYears = value;
      // Refresh a visible tooltip in the new units.
      if (pointerActive && hovered && !tooltipEl.hidden) {
        renderTooltip(hovered, lastClientX, lastClientY);
      }
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

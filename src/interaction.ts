import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StarField } from './stars';
import { colorFromBpRp, parsecsToLightYears } from './transform';
import type { Star } from './types';

/** What a click resolved to: a star index, the Sun, or empty space. */
export type Selection = number | 'sun' | null;

export interface InteractionHandle {
  controls: OrbitControls;
  /** Switch tooltip distance units; refreshes any visible tooltip. */
  setUnits(useLightYears: boolean): void;
}

/**
 * Wires up OrbitControls, pointer raycasting for the hover tooltip, and
 * click/tap selection (reported via `onSelect`). Works for mouse and touch.
 */
export function setupInteraction(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  field: StarField,
  tooltipEl: HTMLElement,
  onSelect: (selection: Selection) => void,
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

  // Click-vs-drag tracking, so orbiting the camera never triggers a selection.
  let downX = 0;
  let downY = 0;
  let dragging = false;
  const CLICK_SLOP = 5; // px of movement still counted as a click

  const swatch = new Float32Array(3);

  function tooltipDistance(star: Star): string {
    if (useLightYears) return `${parsecsToLightYears(star.distancePc).toFixed(1)} ly`;
    return `${star.distancePc.toFixed(1)} pc`;
  }

  function renderTooltip(star: Star, clientX: number, clientY: number): void {
    colorFromBpRp(star.bpRp, swatch, 0);
    const css = `rgb(${(swatch[0] * 255) | 0}, ${(swatch[1] * 255) | 0}, ${(swatch[2] * 255) | 0})`;
    const name = star.name ?? 'Unnamed star';
    tooltipEl.innerHTML =
      `<div class="tooltip__name"><span class="tooltip__swatch" style="color:${css};background:${css}"></span>${escapeHtml(name)}</div>` +
      `<div class="tooltip__meta">${tooltipDistance(star)} · click for details</div>`;
    tooltipEl.style.left = `${clientX}px`;
    tooltipEl.style.top = `${clientY}px`;
    tooltipEl.hidden = false;
  }

  function clearTooltip(): void {
    hovered = null;
    tooltipEl.hidden = true;
  }

  function setPointer(clientX: number, clientY: number): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    // Pick radius scales with zoom so picking stays comfortable at any scale.
    const camDist = camera.position.length();
    raycaster.params.Points.threshold = THREE.MathUtils.clamp(camDist * 0.012, 0.12, 2.2);
    raycaster.setFromCamera(pointer, camera);
  }

  /** Nearest star index under the cursor (by distance to the ray), or null. */
  function pickStarIndex(): number | null {
    const hits = raycaster.intersectObject(field.points, false);
    if (hits.length === 0) return null;
    hits.sort((a, b) => (a.distanceToRay ?? Infinity) - (b.distanceToRay ?? Infinity));
    for (const h of hits) {
      if (h.index != null && field.isVisible(h.index)) return h.index; // skip filtered-out stars
    }
    return null;
  }

  // ---- Hover tooltip ------------------------------------------------------
  function hover(clientX: number, clientY: number): void {
    setPointer(clientX, clientY);
    const index = pickStarIndex();
    if (index == null) {
      clearTooltip();
      return;
    }
    hovered = field.stars[index];
    renderTooltip(hovered, clientX, clientY);
  }

  // ---- Click / tap selection ---------------------------------------------
  function select(clientX: number, clientY: number): void {
    setPointer(clientX, clientY);
    const starHits = raycaster.intersectObject(field.points, false);
    starHits.sort((a, b) => (a.distanceToRay ?? Infinity) - (b.distanceToRay ?? Infinity));
    const starHit = starHits.find((h) => h.index != null && field.isVisible(h.index)) ?? null;
    const sunHit = raycaster.intersectObject(field.sun, true)[0];

    if (sunHit && (!starHit || sunHit.distance < starHit.distance)) {
      onSelect('sun');
    } else if (starHit && starHit.index != null) {
      onSelect(starHit.index);
    }
    // Clicking empty space leaves the current selection untouched.
  }

  const dom = renderer.domElement;

  dom.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    dragging = false;
    clearTooltip();
  });

  dom.addEventListener('pointermove', (e) => {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if ((e.buttons & 0b11) !== 0) {
      if (Math.abs(e.clientX - downX) > CLICK_SLOP || Math.abs(e.clientY - downY) > CLICK_SLOP) {
        dragging = true;
      }
      clearTooltip(); // suppress tooltip mid-orbit
      return;
    }
    pointerActive = true;
    hover(e.clientX, e.clientY);
  });

  dom.addEventListener('pointerleave', clearTooltip);

  dom.addEventListener('pointerup', (e) => {
    const moved = Math.abs(e.clientX - downX) > CLICK_SLOP || Math.abs(e.clientY - downY) > CLICK_SLOP;
    if (!dragging && !moved) {
      select(e.clientX, e.clientY);
      if (e.pointerType === 'touch') hover(e.clientX, e.clientY);
    }
    dragging = false;
  });

  return {
    controls,
    setUnits(value: boolean) {
      useLightYears = value;
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

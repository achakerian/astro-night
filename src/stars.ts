import * as THREE from 'three';
import type { Star } from './types';
import { colorFromBpRp, positionAt, sizeFromMag } from './transform';

/**
 * Owns the THREE.Points star field plus the Sun marker. Positions live in a
 * BufferGeometry attribute that we rewrite in place when the time slider moves
 * (never rebuilding the scene), per the performance brief.
 */
export class StarField {
  readonly object = new THREE.Group();
  readonly points: THREE.Points;
  readonly sun: THREE.Object3D;
  readonly stars: Star[];

  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;

  constructor(stars: Star[]) {
    this.stars = stars;
    const n = stars.length;

    this.positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      positionAt(stars[i], 0, this.positions, i * 3);
      colorFromBpRp(stars[i].bpRp, colors, i * 3);
      sizes[i] = sizeFromMag(stars[i].mag);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.geometry.computeBoundingSphere();

    this.points = new THREE.Points(this.geometry, makeStarMaterial());
    this.points.frustumCulled = false; // positions move far under the slider
    this.object.add(this.points);

    this.sun = makeSunMarker();
    this.object.add(this.sun);
  }

  /** Current world position of star `index` (read from the live buffer). */
  getPosition(index: number, target: THREE.Vector3): THREE.Vector3 {
    const o = index * 3;
    return target.set(this.positions[o], this.positions[o + 1], this.positions[o + 2]);
  }

  /** Rewrite every star position for a given year offset and flag for upload. */
  update(years: number): void {
    const stars = this.stars;
    const pos = this.positions;
    for (let i = 0; i < stars.length; i++) {
      positionAt(stars[i], years, pos, i * 3);
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Round, soft-edged, distance-attenuated points with per-vertex colour and
 * size. A tiny ShaderMaterial because THREE.PointsMaterial can't do per-point
 * size + attenuation together cleanly.
 */
function makeStarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      // px scale so points keep a sensible on-screen size as you zoom.
      uScale: { value: 380.0 },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      uniform float uScale;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (uScale / -mv.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        // circular sprite with a soft glow falloff
        vec2 uv = gl_PointCoord - vec2(0.5);
        float r = length(uv);
        if (r > 0.5) discard;
        float core = smoothstep(0.5, 0.0, r);
        float glow = pow(core, 2.2);
        gl_FragColor = vec4(vColor, glow);
      }
    `,
    vertexColors: true,
  });
}

/** A small, distinct glowing marker at the origin for the Sun. */
function makeSunMarker(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'sun';

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff2c4 }),
  );
  core.name = 'sun-core';
  group.add(core);

  // Soft additive halo via a radial-gradient sprite texture. (A plain
  // SpriteMaterial with no map renders as an opaque square — the "yellow box".)
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xffe7a0,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.scale.setScalar(4.5);
  group.add(halo);

  return group;
}

let cachedGlow: THREE.CanvasTexture | null = null;

/** A 128px radial-gradient sprite, opaque centre fading to transparent edge. */
function glowTexture(): THREE.CanvasTexture {
  if (cachedGlow) return cachedGlow;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,238,180,0.85)');
  g.addColorStop(0.55, 'rgba(255,210,120,0.35)');
  g.addColorStop(1.0, 'rgba(255,200,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  cachedGlow = new THREE.CanvasTexture(canvas);
  cachedGlow.needsUpdate = true;
  return cachedGlow;
}

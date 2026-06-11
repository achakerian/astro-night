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
    this.object.add(makeSunMarker());
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
    new THREE.SphereGeometry(0.45, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2c4 }),
  );
  group.add(core);

  // Faint additive halo so it reads as "the Sun" against the star field.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: 0xffe79a,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.scale.setScalar(3.2);
  group.add(halo);

  return group;
}

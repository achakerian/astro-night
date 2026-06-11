/**
 * Download HD planet texture maps and commit them to public/textures/, so the
 * inspector can render realistic, lit planets with no runtime network.
 *
 *   npm run fetch-textures
 *
 * Source: Solar System Scope (https://www.solarsystemscope.com/textures),
 * distributed under CC BY 4.0. Attribution is noted in the README.
 *
 * Requires network access from the machine you run it on.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE = 'https://www.solarsystemscope.com/textures/download/';

const FILES = [
  '2k_sun.jpg', // HD star-surface granulation, recoloured per star
  '2k_mercury.jpg',
  '2k_venus_surface.jpg',
  '2k_earth_daymap.jpg',
  '2k_earth_clouds.jpg',
  '2k_mars.jpg',
  '2k_jupiter.jpg',
  '2k_saturn.jpg',
  '2k_uranus.jpg',
  '2k_neptune.jpg',
  '2k_moon.jpg',
];

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, '..', 'public', 'textures');
  await mkdir(outDir, { recursive: true });

  let ok = 0;
  for (const file of FILES) {
    process.stdout.write(`${file} … `);
    try {
      const res = await fetch(BASE + file);
      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(resolve(outDir, file), buf);
      console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
      ok++;
    } catch (err) {
      console.log(`failed (${(err as Error).message})`);
    }
  }

  console.log(`\n${ok}/${FILES.length} textures saved → public/textures/`);
  if (ok === 0) process.exit(1);
}

main().catch((err) => {
  console.error('fetch-textures failed:', err);
  process.exit(1);
});

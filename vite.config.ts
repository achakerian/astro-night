import { defineConfig } from 'vite';

// Set `base` to your repository name so asset URLs resolve when served from
// https://<user>.github.io/<repo>/ on GitHub Pages. If you rename the repo,
// update this value (and nothing else needs to change).
export default defineConfig({
  base: '/astro-night/',
  build: {
    target: 'es2020',
  },
});

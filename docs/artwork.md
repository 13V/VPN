# Velora faceted globe — 2026-09-27

The hero uses a low-poly globe in Velora's green, ivory and warm beige palette. Its broad triangular ocean faces, raised ivory land and shallow beige coast edges follow the user's faceted style reference. The reference photograph is not embedded, traced or used as a texture. The globe is decorative, with no locations or indicators that imply verified VPN coverage.

The artwork is built from real coastline data and code. `scripts/build-faceted-globe.mjs` creates an icosphere, clips each face against the local land mask, and raises the land slightly above the ocean. It writes `src/faceted-globe.json` and projects the same triangles into `public/hero-sculpture-fallback.svg`. The low polygon count intentionally simplifies small islands and coastal details. Orientation checks use known land and ocean coordinates.

`src/hero-sculpture.js` renders the model with locally bundled Three.js, matte face colours and directional light. It makes one slow rotation in about 140 seconds. Rendering pauses while off screen or in a hidden document, is limited to 30 frames per second, and caps pixel density at 1.75. Reduced motion holds the designed Atlantic-facing pose. The matching SVG appears immediately and remains usable if WebGL fails or its context is lost. The scene has no textures, environment maps, post-processing or external asset requests.

## Rebuild

```sh
npm run build:hero
```

This regenerates the mesh and fallback before bundling the browser script. `npm start` and the Vercel build run the same command automatically. The browser bundle is ignored; the mesh, SVG, generators and renderer source are checked in. `node scripts/build-hero-fallback.js` also regenerates the mesh and still together.

The coastline source `src/earth-land.json` is a locally simplified copy of [world-atlas v2 land at 1:50m](https://github.com/topojson/world-atlas), derived from [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/). `scripts/prepare-earth-land.js` documents its simplification. To regenerate it, download `world-atlas@2.0.2/land-50m.json`, run `node scripts/prepare-earth-land.js path/to/land-50m.json`, then rebuild the hero. Natural Earth describes its data as public domain; the world-atlas ISC licence is at `public/world-atlas-license.txt`. Three.js's MIT licence is at `public/threejs-license.txt`.

An earlier glass image generated for visual exploration is not used by this version. No stock image or generated bitmap is shipped in the hero.

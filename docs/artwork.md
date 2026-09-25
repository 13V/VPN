# Velora hero artwork — 2026-09-25

The landing hero presents a conceptual terrestrial globe as a small studio object. Its warm mineral body, forest-green inlaid land, muted brass orbit and stone display base are decorative. They do not represent VPN coverage, server locations, live access, connection quality or product performance.

The final scene is built in [Three.js](https://threejs.org/) from editable source in `src/hero-sculpture.js`. The globe uses a local canvas colour, relief and roughness texture; the coastlines come from `src/earth-land.json`. The narrow orbit is a shaped 3D ribbon, so the globe occludes its rear segment. The scene uses broad environment and direct light without a glowing atmosphere. It stops drawing when hidden, caps frame rate and pixel density, and holds a deliberate still composition for reduced motion.

Two quick page studies compared green land on ivory with a tonal engraved version. The latter lacked enough contrast against Velora's warm page. Two further studio-object studies were generated with the built-in image-generation tool to examine material and lighting. They were visual references only; no generated bitmap appears on the website. The final hero uses geographical source data and code-native materials.

## Rebuild

`npm run build:hero` bundles the Three.js module to the ignored `public/hero-sculpture.js`. The local `npm start` command and the Vercel build also bundle it. The static `public/hero-sculpture-fallback.svg` uses the same geography and palette, so it is available before WebGL initializes and when WebGL cannot run. After changing the land source or fallback design, regenerate it with:

```sh
node scripts/build-hero-fallback.js
```

The coastline source is a locally simplified copy of [world-atlas v2 land at 1:50m](https://github.com/topojson/world-atlas), derived from [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/). `scripts/prepare-earth-land.js` documents the simplification. To regenerate the source, download the fixed `world-atlas@2.0.2/land-50m.json` file from the world-atlas package and run `node scripts/prepare-earth-land.js path/to/land-50m.json`, then rebuild the SVG and JS. Natural Earth describes its map data as public domain; the world-atlas redistribution carries the licence shipped at `public/world-atlas-license.txt`. Three.js's MIT licence is shipped at `public/threejs-license.txt`. No third-party asset request is made by the page.

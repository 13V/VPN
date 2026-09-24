# Website artwork

The landing hero card uses a locally rendered Three.js globe in `src/hero-sculpture.js`. Its glazed forest-green sphere, fine latitude and longitude lines, and three satin-metal orbits are conceptual artwork. They do not depict network coverage, server locations, connection quality, or an available VPN service.

`scripts/build-hero-sculpture.js` bundles the module into `public/hero-sculpture.js` for both the local server and Vercel build. The bundle is generated, so it is not checked into Git. Three.js is MIT licensed; its licence is shipped at `public/threejs-license.txt`.

The static `public/hero-sculpture-fallback.svg` shows the same composition when WebGL is unavailable. The scene stops rendering when out of view or when the page is hidden, limits frame rate and pixel density, and shows a still frame when the visitor prefers reduced motion.

The earlier `public/connection-sculpture.jpg` is retained in the repository as an unused design exploration. It is no longer included in the landing page.

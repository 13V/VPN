'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Vercel gives a static index.html precedence over a root rewrite. Publish the
// landing page at that path; the Node handler continues to serve /portal.
const source = path.join(__dirname, '..', 'public');
const output = path.join(__dirname, '..', 'dist', 'public');
fs.mkdirSync(output, { recursive: true });
// Older builds published the prototype scripts. Remove them from an existing
// output directory as well as omitting them from fresh deployments.
for (const name of ['app.js', 'style.css', 'instrument-serif-italic.woff2']) fs.rmSync(path.join(output, name), { force: true });
for (const name of ['landing.css', 'landing.js', 'access.css', 'brand.css', 'connection-sculpture.jpg', 'velora-logo.svg', 'velora-logo-light.svg', 'velora-mark.svg', 'favicon.svg', 'icons.svg', 'manrope-latin.woff2', 'newsreader-roman.woff2', 'newsreader-italic.woff2']) {
  fs.copyFileSync(path.join(source, name), path.join(output, name));
}
fs.copyFileSync(path.join(source, 'landing.html'), path.join(output, 'index.html'));

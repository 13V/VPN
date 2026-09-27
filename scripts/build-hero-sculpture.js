'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

execFileSync(process.execPath, [path.join(__dirname, 'build-faceted-globe.mjs')], { stdio: 'inherit' });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'hero-sculpture.js')],
  outfile: path.join(__dirname, '..', 'public', 'hero-sculpture.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'eof',
  banner: { js: '/*! Velora globe: Three.js MIT /threejs-license.txt; world-atlas ISC /world-atlas-license.txt */' },
});

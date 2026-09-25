'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function build() {
  const { geoOrthographic, geoPath } = await import('d3-geo');
  const { feature } = await import('topojson-client');
  const topology = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'earth-land.json'), 'utf8'));
  const land = feature(topology, topology.objects.land);
  const projection = geoOrthographic()
    .rotate([-77, -8, -10])
    .translate([280, 220])
    .scale(164)
    .precision(0.45);
  const coast = geoPath(projection).digits(2)(land);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 560" role="presentation">
  <!-- Natural Earth land, redistributed by world-atlas v2; licence: /world-atlas-license.txt -->
  <defs>
    <radialGradient id="body" cx="32%" cy="24%" r="78%">
      <stop stop-color="#416957"/><stop offset=".5" stop-color="#254c3c"/><stop offset="1" stop-color="#173428"/>
    </radialGradient>
    <radialGradient id="shading" cx="28%" cy="22%" r="78%">
      <stop stop-color="#fffaf0" stop-opacity=".18"/><stop offset=".5" stop-color="#fffaf0" stop-opacity="0"/><stop offset="1" stop-color="#1b291d" stop-opacity=".28"/>
    </radialGradient>
    <linearGradient id="stone" x1="0" y1="0" x2=".4" y2="1">
      <stop stop-color="#e7dfce"/><stop offset="1" stop-color="#c8c0b0"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#736745"/><stop offset=".45" stop-color="#d6c5a0"/><stop offset="1" stop-color="#877657"/>
    </linearGradient>
    <radialGradient id="shadow"><stop stop-color="#4e5749" stop-opacity=".27"/><stop offset="1" stop-color="#4e5749" stop-opacity="0"/></radialGradient>
    <clipPath id="sphere"><circle cx="280" cy="220" r="164"/></clipPath>
    <filter id="soft"><feGaussianBlur stdDeviation="8"/></filter>
  </defs>
  <ellipse cx="280" cy="439" rx="140" ry="18" fill="#606c5c" opacity=".14" filter="url(#soft)"/>
  <path d="M135 439v35c0 27 290 27 290 0v-35Z" fill="url(#stone)" stroke="#b8ae9d" stroke-width=".8"/>
  <ellipse cx="280" cy="439" rx="145" ry="28" fill="#e7dfce" stroke="#b8ae9d" stroke-width=".8"/>
  <ellipse cx="280" cy="437" rx="87" ry="14" fill="url(#shadow)"/>
  <ellipse cx="280" cy="220" rx="125" ry="214" transform="rotate(-28 280 220)" fill="none" stroke="#a28f6c" stroke-width="3" opacity=".55"/>
  <circle cx="280" cy="220" r="164" fill="url(#body)" stroke="#d5d1c4" stroke-width=".7"/>
  <g clip-path="url(#sphere)">
    <path d="${coast}" fill="#e9e2d2" fill-rule="evenodd" stroke="#a79572" stroke-width="1.05" stroke-linejoin="round"/>
    <circle cx="280" cy="220" r="164" fill="url(#shading)"/>
  </g>
  <ellipse cx="280" cy="220" rx="125" ry="214" transform="rotate(-28 280 220)" fill="none" stroke="url(#metal)" stroke-width="3.2" stroke-dasharray="380 900" stroke-dashoffset="-252"/>
</svg>`;
  const output = path.join(__dirname, '..', 'public', 'hero-sculpture-fallback.svg');
  fs.writeFileSync(output, svg);
  process.stdout.write(`Wrote ${output} (${Buffer.byteLength(svg)} bytes)\n`);
}
build().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });

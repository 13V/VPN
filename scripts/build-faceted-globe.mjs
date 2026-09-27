import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const topology = JSON.parse(fs.readFileSync(path.join(root, 'src/earth-land.json'), 'utf8'));
const arcs = topology.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [x * topology.transform.scale[0] + topology.transform.translate[0],
      y * topology.transform.scale[1] + topology.transform.translate[1]];
  });
});
const rings = [];
for (const geometry of topology.objects.land.geometries) {
  for (const polygon of geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs) {
    for (const ring of polygon) {
      const points = ring.flatMap((index) => index < 0 ? [...arcs[~index]].reverse() : arcs[index]);
      rings.push({ points, minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
        minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) });
    }
  }
}
function contains(lon, lat) {
  let inside = false;
  for (const ring of rings) {
    if (lon < ring.minX || lon > ring.maxX || lat < ring.minY || lat > ring.maxY) continue;
    const p = ring.points;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > lat) !== (p[j][1] > lat)
        && lon < (p[j][0] - p[i][0]) * (lat - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
    }
  }
  return inside;
}
function onLand(v) {
  return contains(Math.atan2(v.x, v.z) * 180 / Math.PI, Math.asin(v.y / v.length()) * 180 / Math.PI);
}
// Guard map orientation before generating any artwork.
for (const [lon, lat, expected] of [[20, 0, true], [-30, 0, false], [135, -25, true], [-100, 35, true], [0, 0, false]]) {
  if (contains(lon, lat) !== expected) throw new Error(`Land mask failed at ${lon},${lat}`);
}
const triangles = [];
let seed = 914;
function jitter() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
function add(points, color) {
  const values = points.flatMap(p => [p.x, p.y, p.z].map(v => +v.toFixed(5)));
  triangles.push([color, ...values]);
}
function crossing(a, b, isA) {
  let low = 0, high = 1;
  for (let i = 0; i < 15; i++) {
    const t = (low + high) / 2;
    if (onLand(a.clone().lerp(b, t)) === isA) low = t; else high = t;
  }
  return a.clone().lerp(b, (low + high) / 2);
}
function makeFace(vertices, depth = 0) {
  const flags = vertices.map(onLand);
  const center = vertices.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(3);
  if (depth < 1 && flags.every(v => v === flags[0]) && onLand(center) !== flags[0]) {
    const [a,b,c] = vertices;
    const ab = a.clone().add(b).normalize(), bc = b.clone().add(c).normalize(), ca = c.clone().add(a).normalize();
    for (const face of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]]) makeFace(face, depth + 1);
    return;
  }
  const ocean = new THREE.Color('#477e65').multiplyScalar(0.84 + jitter() * 0.30);
  add(vertices, ocean.getHexString());
  if (flags.every(v => !v) && !onLand(center)) return;
  const clipped = [], coast = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (flags[i]) clipped.push(vertices[i]);
    if (flags[i] !== flags[j]) {
      const boundary = crossing(vertices[i], vertices[j], flags[i]);
      clipped.push(boundary); coast.push(boundary);
    }
  }
  if (clipped.length < 3) return;
  const lifted = clipped.map(v => v.clone().multiplyScalar(1.025));
  const ivory = new THREE.Color('#f4efe2').multiplyScalar(0.91 + jitter() * 0.13);
  for (let i = 1; i < lifted.length - 1; i++) add([lifted[0], lifted[i], lifted[i + 1]], ivory.getHexString());
  if (coast.length === 2) {
    const [a,b] = coast, aa = a.clone().multiplyScalar(1.025), bb = b.clone().multiplyScalar(1.025);
    add([a,b,bb], 'bba988'); add([a,bb,aa], 'bba988');
  }
}
const geometry = new THREE.IcosahedronGeometry(1, 5);
const points = geometry.getAttribute('position');
for (let i = 0; i < points.count; i += 3) makeFace([0,1,2].map(j => new THREE.Vector3().fromBufferAttribute(points, i+j)));
geometry.dispose();
const model = { rotation: [0.08, 0.28, -0.12], triangles };
fs.writeFileSync(path.join(root, 'src/faceted-globe.json'), JSON.stringify(model));

// The fallback is projected from the same triangles and the same resting pose.
const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...model.rotation));
const light = new THREE.Vector3(-3, 5, 4).normalize();
const faces = triangles.map(([hex, ...coordinates]) => {
  const p = [0,3,6].map(i => new THREE.Vector3(...coordinates.slice(i, i+3)).applyMatrix4(rotation));
  const normal = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
  const shade = 0.55 + Math.max(0, normal.dot(light)) * 0.86;
  const color = new THREE.Color(`#${hex}`).multiplyScalar(shade).getHexString();
  return { depth: (p[0].z+p[1].z+p[2].z)/3, visible: normal.z > 0,
    svg: `<path d="M${p.map(v => `${(280+v.x*228).toFixed(2)},${(270-v.y*228).toFixed(2)}`).join('L')}Z" fill="#${color}" stroke="#${color}" stroke-width=".4"/>` };
}).filter(f => f.visible).sort((a,b) => a.depth-b.depth);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 560" role="presentation"><!-- Velora faceted atlas. Natural Earth / world-atlas; /world-atlas-license.txt -->${faces.map(f=>f.svg).join('')}</svg>`;
fs.writeFileSync(path.join(root, 'public/hero-sculpture-fallback.svg'), svg);
console.log(`Built ${triangles.length} triangles and matching SVG fallback.`);

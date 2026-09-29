'use strict';

// Run manually with a locally downloaded world-atlas v2 land-50m.json.
// The output keeps the original TopoJSON topology while reducing points
// that cannot be seen in the landing-page globe.
const fs = require('node:fs');
const path = require('node:path');

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/prepare-earth-land.js path/to/land-50m.json');
const topology = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
if (!Array.isArray(topology.arcs) || !topology.transform || !topology.objects?.land) {
  throw new Error('Expected world-atlas land TopoJSON.');
}

function distanceSquared(point, start, end) {
  const sx = start[0]; const sy = start[1] * 0.49;
  const ex = end[0]; const ey = end[1] * 0.49;
  const px = point[0]; const py = point[1] * 0.49;
  const dx = ex - sx; const dy = ey - sy;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy))) : 0;
  return (px - sx - t * dx) ** 2 + (py - sy - t * dy) ** 2;
}
function simplify(points, thresholdSquared) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let largest = thresholdSquared;
    let selected = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance = distanceSquared(points[i], points[start], points[end]);
      if (distance > largest) { largest = distance; selected = i; }
    }
    if (selected !== -1) {
      keep[selected] = 1;
      stack.push([start, selected], [selected, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

topology.arcs = topology.arcs.map((arc) => {
  let x = 0; let y = 0;
  const absolute = arc.map(([dx, dy]) => { x += dx; y += dy; return [x, y]; });
  const points = simplify(absolute, 22 ** 2);
  let previousX = 0; let previousY = 0;
  return points.map(([nextX, nextY]) => {
    const delta = [nextX - previousX, nextY - previousY];
    previousX = nextX; previousY = nextY;
    return delta;
  });
});
const output = path.join(__dirname, '..', 'src', 'earth-land.json');
fs.writeFileSync(output, JSON.stringify(topology));
process.stdout.write(`Wrote ${output} (${fs.statSync(output).size} bytes)\n`);

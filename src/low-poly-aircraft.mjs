// Original low-poly model, +Y forward and +Z up. Shared by WebGL and the still.
export function aircraftTriangles() {
  const result = [];
  function solid(vertices, faces, palette) {
    const center = [0, 1, 2].map(axis => vertices.reduce((sum, p) => sum + p[axis], 0) / vertices.length);
    faces.forEach((face, index) => {
      for (let i = 1; i < face.length - 1; i++) {
        let [a, b, c] = [vertices[face[0]], vertices[face[i]], vertices[face[i + 1]]];
        const u = b.map((v, j) => v - a[j]), v = c.map((value, j) => value - a[j]);
        const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        const outward = a.map((value, j) => (value + b[j] + c[j]) / 3 - center[j]);
        if (normal.reduce((sum, value, j) => sum + value*outward[j], 0) < 0) [b,c] = [c,b];
        result.push([palette[index % palette.length], ...a, ...b, ...c]);
      }
    });
  }
  const fuselage = [[0, 0.158, 0]];
  for (const [y, width, height] of [[0.074,0.021,0.028],[-0.040,0.018,0.021],[-0.123,0.007,0.009]]) {
    for (let i = 0; i < 6; i++) fuselage.push([Math.sin(i*Math.PI/3)*width,y,Math.cos(i*Math.PI/3)*height]);
  }
  fuselage.push([0,-0.148,0]);
  const bodyFaces = [];
  for (let i = 0; i < 6; i++) {
    const next = (i+1)%6;
    bodyFaces.push([0,1+i,1+next]);
    for (let ring = 0; ring < 2; ring++) bodyFaces.push([1+ring*6+i,1+ring*6+next,7+ring*6+next,7+ring*6+i]);
    bodyFaces.push([19,13+next,13+i]);
  }
  solid(fuselage, bodyFaces, ['f4efe2','e2dbc9','c9c8b8','eee8d9','fbf7ed','dad7c8']);
  function wing(outline, ridge, palette) {
    const points = outline.map(([x,y]) => [x,y,0.003]);
    points.push(...outline.map(([x,y]) => [x,y,-0.008]), ridge);
    solid(points, [[0,1,8],[1,2,8],[2,3,8],[3,0,8],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]], palette);
  }
  for (const side of [-1,1]) {
    wing([[0.015,0.044],[0.147,-0.038],[0.147,-0.061],[0.014,-0.041]].map(([x,y]) => [x*side,y]),
      [side*0.061,-0.019,0.018], ['f4efdf','d7d3c2','ebe6d7','faf6eb','91a08c','c1b698']);
    wing([[0.007,-0.081],[0.067,-0.114],[0.067,-0.132],[0.006,-0.123]].map(([x,y]) => [x*side,y]),
      [side*0.028,-0.112,0.012], ['e7e2d2','bec8b5','f4efdf','dad7c8']);
  }
  // A triangular upright fin and a small faceted cockpit give volume at hero size.
  solid([[-0.003,-0.081,0.013],[-0.003,-0.120,0.070],[-0.003,-0.140,0.008],
    [0.003,-0.081,0.013],[0.003,-0.120,0.070],[0.003,-0.140,0.008]],
  [[0,1,2],[3,5,4],[0,3,4,1],[1,4,5,2],[2,5,3,0]], ['49745d','91a58b','c0c6ad']);
  solid([[-0.012,0.070,0.020],[0.012,0.070,0.020],[0.009,0.101,0.018],[-0.009,0.101,0.018],[0,0.083,0.034]],
    [[0,1,4],[1,2,4],[2,3,4],[3,0,4],[0,3,2,1]], ['365d4c','63816a','86a08a','4b725c']);
  return result;
}

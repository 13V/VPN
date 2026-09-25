import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import land from './earth-land.json';

const mount = document.getElementById('velora-sculpture');
const canvas = mount?.querySelector('canvas');
const palette = {
  ocean: '#dfd8c8',
  land: '#254c3c',
  coast: '#aa9875',
  orbit: 0xa79572,
};

// Natural Earth coastlines, distributed by world-atlas. See docs/artwork.md.
// Build both textures locally; the scene makes no external requests.
function earthTextures() {
  const width = 1536;
  const height = 768;
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  const context = surface.getContext('2d');
  const relief = document.createElement('canvas');
  relief.width = surface.width;
  relief.height = surface.height;
  const bump = relief.getContext('2d');
  const finish = document.createElement('canvas');
  finish.width = surface.width;
  finish.height = surface.height;
  const roughness = finish.getContext('2d');
  context.fillStyle = palette.ocean;
  context.fillRect(0, 0, width, height);
  bump.fillStyle = '#707070';
  bump.fillRect(0, 0, width, height);
  roughness.fillStyle = '#bdbdbd';
  roughness.fillRect(0, 0, width, height);
  const arcs = land.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [
        (x * land.transform.scale[0] + land.transform.translate[0] + 180) / 360 * width,
        (90 - y * land.transform.scale[1] - land.transform.translate[1]) / 180 * height,
      ];
    });
  });
  const outline = new Path2D();
  for (const geometry of land.objects.land.geometries) {
    const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        let first = true;
        for (const index of ring) {
          const points = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
          for (const [x, y] of points) {
            if (first) outline.moveTo(x, y);
            else outline.lineTo(x, y);
            first = false;
          }
        }
        outline.closePath();
      }
    }
  }
  context.fillStyle = palette.land;
  context.fill(outline, 'evenodd');
  context.save();
  context.clip(outline, 'evenodd');
  const enamel = context.createLinearGradient(0, height, width, 0);
  enamel.addColorStop(0, '#1b352d');
  enamel.addColorStop(0.48, '#345a45');
  enamel.addColorStop(1, '#63745b');
  context.globalAlpha = 0.14;
  context.fillStyle = enamel;
  context.fillRect(0, 0, width, height);
  let veinSeed = 139;
  context.strokeStyle = '#e6dfbf';
  context.lineWidth = 0.9;
  context.globalAlpha = 0.09;
  for (let i = 0; i < 3200; i += 1) {
    veinSeed = (veinSeed * 16807) % 2147483647;
    const x = veinSeed % width;
    veinSeed = (veinSeed * 16807) % 2147483647;
    const y = veinSeed % height;
    const length = 9 + (veinSeed % 25);
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(x + length * 0.35, y - length * 0.24, x + length, y - length * 0.12);
    context.stroke();
  }
  context.restore();
  context.strokeStyle = palette.coast;
  context.lineWidth = 1.8;
  context.stroke(outline);
  bump.fillStyle = '#989898';
  bump.fill(outline, 'evenodd');
  roughness.fillStyle = '#d9d9d9';
  roughness.fill(outline, 'evenodd');
  // A fine deterministic grain softens the computer-perfect material.
  let seed = 17;
  context.globalAlpha = 0.018;
  for (let i = 0; i < 26000; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const x = seed % width;
    seed = (seed * 16807) % 2147483647;
    const y = seed % height;
    context.fillStyle = i % 2 ? '#ffffff' : '#000000';
    context.fillRect(x, y, 1, 1);
  }
  const color = new THREE.CanvasTexture(surface);
  color.colorSpace = THREE.SRGBColorSpace;
  color.anisotropy = 4;
  return [color, new THREE.CanvasTexture(relief), new THREE.CanvasTexture(finish)];
}

function stoneTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#c9bea9';
  context.fillRect(0, 0, 512, 512);
  let seed = 191;
  for (let i = 0; i < 6200; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const x = seed % 512;
    seed = (seed * 16807) % 2147483647;
    const y = seed % 512;
    context.fillStyle = i % 5 ? '#8c8577' : '#faf4e6';
    context.globalAlpha = i % 5 ? 0.09 : 0.13;
    context.beginPath();
    context.arc(x, y, i % 11 === 0 ? 1.3 : 0.55, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ribbonGeometry(radius, width = 0.026, depth = 0.006, segments = 256) {
  const positions = [];
  const indices = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (const z of [depth / 2, -depth / 2]) {
      for (const r of [radius - width / 2, radius + width / 2]) {
        positions.push(c * r, s * r, z);
      }
    }
  }
  for (let index = 0; index < segments; index += 1) {
    const a = index * 4;
    const b = (index + 1) * 4;
    for (const [u, v] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      indices.push(a + u, a + v, b + v, a + u, b + v, b + u);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

if (mount && canvas) {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, powerPreference: 'low-power',
    });
    renderer.setClearColor(0xffffff, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.91;
    const scene = new THREE.Scene();
    let environmentTarget;
    try {
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      environmentTarget = pmrem.fromScene(room);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.32;
      room.dispose();
      pmrem.dispose();
    } catch {
      // The soft direct lights still render the globe.
    }
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    camera.position.set(0, 0.35, 4.7);
    camera.lookAt(0, -0.12, 0);
    scene.add(new THREE.HemisphereLight(0xfffcf2, 0x8f9181, 0.85));
    const key = new THREE.DirectionalLight(0xfff7eb, 1.75);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xd8e3d5, 0.75);
    rim.position.set(3, 1, -2);
    scene.add(rim);

    const resources = [];
    const [map, bumpMap, roughnessMap] = earthTextures();
    const geometry = new THREE.SphereGeometry(1, 256, 160);
    const material = new THREE.MeshPhysicalMaterial({
      map, bumpMap, roughnessMap, displacementMap: bumpMap,
      bumpScale: 0.011,
      displacementScale: 0.018,
      displacementBias: -0.008,
      roughness: 0.82,
      metalness: 0,
      clearcoat: 0.14,
      clearcoatRoughness: 0.6,
    });
    resources.push(map, bumpMap, roughnessMap, geometry, material);
    const earth = new THREE.Mesh(geometry, material);
    earth.rotation.set(0.12, 3.15, -0.18);
    const sculpture = new THREE.Group();
    sculpture.add(earth);
    sculpture.position.y = 0.16;
    scene.add(sculpture);

    const orbit = new THREE.Group();
    orbit.rotation.set(0.68, 0.87, -0.38);
    const orbitShape = ribbonGeometry(1.27);
    const orbitFinish = new THREE.MeshPhysicalMaterial({
      color: palette.orbit, metalness: 0.76, roughness: 0.31,
      side: THREE.DoubleSide,
    });
    resources.push(orbitShape, orbitFinish);
    orbit.add(new THREE.Mesh(orbitShape, orbitFinish));
    sculpture.add(orbit);

    const stoneMap = stoneTexture();
    const plinthGeometry = new THREE.CylinderGeometry(0.93, 0.96, 0.17, 96, 1);
    const plinthMaterial = new THREE.MeshPhysicalMaterial({
      map: stoneMap, metalness: 0, roughness: 0.96,
    });
    const plinth = new THREE.Mesh(plinthGeometry, plinthMaterial);
    plinth.position.y = -1.22;
    scene.add(plinth);
    resources.push(stoneMap, plinthGeometry, plinthMaterial);

    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext('2d');
    const gradient = shadowContext.createRadialGradient(64, 64, 5, 64, 64, 64);
    gradient.addColorStop(0, '#2c362c99');
    gradient.addColorStop(1, '#2c362c00');
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 128, 128);
    const shadowMap = new THREE.CanvasTexture(shadowCanvas);
    const shadowGeometry = new THREE.PlaneGeometry(1.45, 1.45);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowMap, transparent: true, depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.129;
    scene.add(shadow);
    resources.push(shadowMap, shadowGeometry, shadowMaterial);

    let visible = true;
    let lastFrame = 0;
    let elapsed = 0;
    let targetYaw = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    function sizeAndRender() {
      const { width, height } = mount.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = camera.aspect < 1.05 ? 4.95 : 4.7;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      mount.classList.add('is-rendered');
    }
    function animate(time) {
      if (time - lastFrame < 32) return;
      const delta = lastFrame ? Math.min((time - lastFrame) / 1000, 0.06) : 0;
      lastFrame = time;
      elapsed += delta;
      earth.rotation.y = 3.15 + elapsed * 0.075;
      sculpture.rotation.y += (targetYaw - sculpture.rotation.y) * 0.065;
      orbit.rotation.y = 0.87 + Math.sin(elapsed * 0.16) * 0.055;
      renderer.render(scene, camera);
    }
    function updateMotion() {
      lastFrame = 0;
      renderer.setAnimationLoop(visible && !document.hidden && !reduceMotion.matches ? animate : null);
      if (reduceMotion.matches) {
        earth.rotation.set(0.12, 3.15, -0.18);
        sculpture.rotation.y = 0;
        sculpture.position.y = 0.16;
        orbit.rotation.set(0.68, 0.87, -0.38);
        renderer.render(scene, camera);
      }
    }
    function onPointerMove(event) {
      if (!finePointer.matches || reduceMotion.matches) return;
      const bounds = mount.getBoundingClientRect();
      targetYaw = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.22;
    }
    function onPointerLeave() { targetYaw = 0; }
    const resizeObserver = new ResizeObserver(sizeAndRender);
    resizeObserver.observe(mount);
    const visibilityObserver = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      updateMotion();
    });
    visibilityObserver.observe(mount);
    reduceMotion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateMotion);
    mount.addEventListener('pointermove', onPointerMove, { passive: true });
    mount.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      renderer.setAnimationLoop(null);
      mount.classList.remove('is-rendered');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      sizeAndRender();
      updateMotion();
    });
    window.addEventListener('pagehide', (event) => {
      renderer.setAnimationLoop(null);
      if (event.persisted) return;
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      resources.forEach((resource) => resource.dispose());
      environmentTarget?.dispose();
      renderer.dispose();
    });
    window.addEventListener('pageshow', updateMotion);
    sizeAndRender();
    updateMotion();
  } catch {
    // Coastline artwork remains visible if WebGL cannot initialize.
    mount.classList.remove('is-rendered');
  }
}

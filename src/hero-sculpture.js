import * as THREE from 'three';
import model from './faceted-globe.json';
import flights from './globe-orbits.json';

const mount = document.getElementById('velora-sculpture');
const canvas = mount?.querySelector('canvas');

if (mount && canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0xffffff, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, 0.1, 20);
    camera.position.z = 5;
    const positions = [], colors = [];
    for (const [hex, ...vertices] of model.triangles) {
      positions.push(...vertices);
      const color = new THREE.Color(`#${hex}`);
      for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const globe = new THREE.Mesh(geometry, material);
    globe.rotation.set(...model.rotation);
    globe.position.y = 0.045;
    scene.add(globe);
    const orbitResources = [];
    const aircraftShape = new THREE.Shape(flights.aircraft.map(([x,y]) => new THREE.Vector2(x,y)));
    const aircraftGeometry = new THREE.ExtrudeGeometry(aircraftShape, {
      depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002,
      bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    const aircraftTop = new THREE.MeshLambertMaterial({ color: '#fffaf0' });
    const aircraftEdge = new THREE.MeshLambertMaterial({ color: '#36594b' });
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(
      flights.aircraft.map(([x,y]) => new THREE.Vector3(x,y,0.011)));
    const outlineMaterial = new THREE.LineBasicMaterial({ color: '#36594b' });
    orbitResources.push(aircraftGeometry, aircraftTop, aircraftEdge, outlineGeometry, outlineMaterial);
    const routes = flights.paths.map(path => {
      const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...path.rotation));
      const track = new THREE.TorusGeometry(path.radius, 0.0024, 5, 192);
      const trackMaterial = new THREE.MeshBasicMaterial({ color: path.color });
      const ring = new THREE.Mesh(track, trackMaterial);
      ring.rotation.set(...path.rotation); ring.position.y = globe.position.y; scene.add(ring);
      const aircraft = new THREE.Group();
      aircraft.add(new THREE.Mesh(aircraftGeometry, [aircraftTop, aircraftEdge]));
      aircraft.add(new THREE.LineLoop(outlineGeometry, outlineMaterial));
      scene.add(aircraft);
      orbitResources.push(track, trackMaterial);
      return { ...path, rotation, aircraft, position: new THREE.Vector3(), tangent: new THREE.Vector3() };
    });
    function placeAircraft(time) {
      for (const route of routes) {
        const angle = route.phase + time * route.speed;
        route.position.set(Math.cos(angle) * route.radius, Math.sin(angle) * route.radius, 0).applyMatrix4(route.rotation);
        route.tangent.set(-Math.sin(angle), Math.cos(angle), 0).transformDirection(route.rotation).multiplyScalar(Math.sign(route.speed));
        route.aircraft.position.copy(route.position); route.aircraft.position.y += globe.position.y;
        route.aircraft.rotation.set(0, 0, Math.atan2(-route.tangent.x, route.tangent.y));
      }
    }
    placeAircraft(0);
    scene.add(new THREE.AmbientLight(0xfffaf5, 1.6));
    const key = new THREE.DirectionalLight(0xfffcf8, 2.7);
    key.position.set(-3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xb3cbbb, 0.15);
    fill.position.set(3, 0, -2); scene.add(fill);
    let visible = true, disposed = false, lost = false, frame = 0, elapsed = 0, last = 0;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    function render() {
      if (disposed || lost) return;
      renderer.render(scene, camera); mount.classList.add('is-rendered');
    }
    function resize() {
      const { width, height } = mount.getBoundingClientRect();
      if (width < 1 || height < 1 || disposed || lost) return;
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const vertical = aspect < 1 ? flights.cameraHalf / aspect : flights.cameraHalf;
      camera.left = -vertical * aspect; camera.right = vertical * aspect;
      camera.top = vertical; camera.bottom = -vertical;
      camera.updateProjectionMatrix(); render();
    }
    function animate(time) {
      frame = requestAnimationFrame(animate);
      if (time - last < 1000 / 30) return;
      elapsed += last ? Math.min((time - last) / 1000, 0.07) : 0;
      last = time;
      globe.rotation.y = model.rotation[1] + elapsed * 0.045; placeAircraft(elapsed); render();
    }
    function updateMotion() {
      cancelAnimationFrame(frame); frame = 0; last = 0;
      if (disposed || lost) return;
      if (reducedMotion.matches) { globe.rotation.set(...model.rotation); placeAircraft(0); render(); }
      else if (visible && !document.hidden) frame = requestAnimationFrame(animate);
    }
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(mount);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting; updateMotion();
    });
    intersectionObserver.observe(mount);
    reducedMotion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateMotion);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); lost = true; cancelAnimationFrame(frame); mount.classList.remove('is-rendered');
    });
    canvas.addEventListener('webglcontextrestored', () => { lost = false; resize(); updateMotion(); });
    window.addEventListener('pagehide', event => {
      cancelAnimationFrame(frame);
      if (event.persisted) return;
      disposed = true; resizeObserver.disconnect(); intersectionObserver.disconnect();
      reducedMotion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateMotion);
      geometry.dispose(); material.dispose(); orbitResources.forEach(resource => resource.dispose()); renderer.dispose();
    });
    window.addEventListener('pageshow', updateMotion);
    resize(); updateMotion();
  } catch {
    renderer?.dispose(); mount.classList.remove('is-rendered');
  }
}

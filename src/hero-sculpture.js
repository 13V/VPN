import * as THREE from 'three';
import model from './faceted-globe.json';

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
      const vertical = aspect < 1 ? 1.23 / aspect : 1.23;
      camera.left = -vertical * aspect; camera.right = vertical * aspect;
      camera.top = vertical; camera.bottom = -vertical;
      camera.updateProjectionMatrix(); render();
    }
    function animate(time) {
      frame = requestAnimationFrame(animate);
      if (time - last < 1000 / 30) return;
      elapsed += last ? Math.min((time - last) / 1000, 0.07) : 0;
      last = time;
      globe.rotation.y = model.rotation[1] + elapsed * 0.045; render();
    }
    function updateMotion() {
      cancelAnimationFrame(frame); frame = 0; last = 0;
      if (disposed || lost) return;
      if (reducedMotion.matches) { globe.rotation.set(...model.rotation); render(); }
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
      geometry.dispose(); material.dispose(); renderer.dispose();
    });
    window.addEventListener('pageshow', updateMotion);
    resize(); updateMotion();
  } catch {
    renderer?.dispose(); mount.classList.remove('is-rendered');
  }
}

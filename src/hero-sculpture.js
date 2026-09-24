import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const mount = document.getElementById('velora-sculpture');
const canvas = mount?.querySelector('canvas');

if (mount && canvas) {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, powerPreference: 'low-power',
    });
    renderer.setClearColor(0xffffff, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    let environmentTarget;
    try {
      const environment = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      environmentTarget = pmrem.fromScene(environment);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.45;
      environment.dispose();
      pmrem.dispose();
    } catch {
      // Direct lighting is enough if environment lighting is unavailable.
    }
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    camera.position.set(0, 0, 4.6);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x567365, 2));
    const key = new THREE.DirectionalLight(0xfff7e7, 3.8);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xd1e8db, 2.3);
    rim.position.set(3, 1, -3);
    scene.add(rim);

    const resources = [];
    const globe = new THREE.Group();
    const sphereGeometry = new THREE.SphereGeometry(0.78, 64, 48);
    const sphereMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x173f33, metalness: 0.25, roughness: 0.29,
      clearcoat: 0.82, clearcoatRoughness: 0.18,
    });
    resources.push(sphereGeometry, sphereMaterial);
    globe.add(new THREE.Mesh(sphereGeometry, sphereMaterial));

    // Fine parallels and meridians give the sphere its globe silhouette.
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0xb3c6ac, transparent: true, opacity: 0.42, depthWrite: false,
    });
    const equatorMaterial = new THREE.LineBasicMaterial({
      color: 0xe2d1a9, transparent: true, opacity: 0.72, depthWrite: false,
    });
    resources.push(gridMaterial, equatorMaterial);
    const gridRadius = 0.786;
    function addLine(points, material) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      resources.push(geometry);
      globe.add(new THREE.LineLoop(geometry, material));
    }
    for (const latitude of [-60, -30, 0, 30, 60]) {
      const phi = THREE.MathUtils.degToRad(latitude);
      addLine(Array.from({ length: 128 }, (_, index) => {
        const theta = index / 128 * Math.PI * 2;
        return new THREE.Vector3(
          gridRadius * Math.cos(phi) * Math.cos(theta),
          gridRadius * Math.sin(phi),
          gridRadius * Math.cos(phi) * Math.sin(theta),
        );
      }), latitude === 0 ? equatorMaterial : gridMaterial);
    }
    for (let longitude = 0; longitude < 6; longitude += 1) {
      const theta = longitude / 6 * Math.PI;
      addLine(Array.from({ length: 128 }, (_, index) => {
        const phi = index / 128 * Math.PI * 2;
        return new THREE.Vector3(
          gridRadius * Math.cos(phi) * Math.cos(theta),
          gridRadius * Math.sin(phi),
          gridRadius * Math.cos(phi) * Math.sin(theta),
        );
      }), gridMaterial);
    }

    const sculpture = new THREE.Group();
    globe.rotation.set(0.12, -0.4, -0.12);
    sculpture.add(globe);
    const orbitConfigs = [
      { radius: 1.07, tilt: [-0.4, 0.35, -0.18], color: 0xb1a077, phase: 0.55, size: 0.042 },
      { radius: 1.16, tilt: [0.54, -0.32, 0.28], color: 0x6b8a78, phase: 2.75, size: 0.029 },
      { radius: 1.24, tilt: [0.13, 0.68, -0.5], color: 0xd8c8a1, phase: 4.6, size: 0.024 },
    ];
    const orbits = [];
    for (const config of orbitConfigs) {
      const orbit = new THREE.Group();
      orbit.rotation.set(...config.tilt);
      const geometry = new THREE.TorusGeometry(config.radius, 0.007, 6, 144);
      const material = new THREE.MeshStandardMaterial({
        color: config.color, metalness: 0.74, roughness: 0.27,
      });
      const markerGeometry = new THREE.SphereGeometry(config.size, 14, 10);
      const markerMaterial = new THREE.MeshPhysicalMaterial({
        color: config.color, metalness: 0.55, roughness: 0.22, clearcoat: 0.8,
      });
      resources.push(geometry, material, markerGeometry, markerMaterial);
      orbit.add(new THREE.Mesh(geometry, material));
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(
        config.radius * Math.cos(config.phase),
        config.radius * Math.sin(config.phase),
        0,
      );
      orbit.add(marker);
      sculpture.add(orbit);
      orbits.push(orbit);
    }
    sculpture.rotation.set(-0.04, -0.18, 0);
    sculpture.position.y = 0.04;
    scene.add(sculpture);

    let visible = true;
    let lastFrame = 0;
    let targetYaw = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    function sizeAndRender() {
      const { width, height } = mount.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      mount.classList.add('is-rendered');
    }
    function animate(time) {
      if (time - lastFrame < 32) return;
      lastFrame = time;
      globe.rotation.y = -0.4 + time * 0.00012;
      sculpture.rotation.y += (-0.18 + targetYaw - sculpture.rotation.y) * 0.07;
      sculpture.rotation.x = -0.04 + Math.sin(time * 0.00024) * 0.025;
      sculpture.position.y = 0.04 + Math.sin(time * 0.00045) * 0.014;
      orbits[0].rotation.z = orbitConfigs[0].tilt[2] + Math.sin(time * 0.00016) * 0.035;
      orbits[1].rotation.y = orbitConfigs[1].tilt[1] + Math.sin(time * 0.00013) * 0.04;
      renderer.render(scene, camera);
    }
    function updateMotion() {
      renderer.setAnimationLoop(
        visible && !document.hidden && !reduceMotion.matches ? animate : null,
      );
      if (reduceMotion.matches) {
        globe.rotation.set(0.12, -0.4, -0.12);
        sculpture.rotation.set(-0.04, -0.18, 0);
        sculpture.position.y = 0.04;
        orbits.forEach((orbit, index) => orbit.rotation.set(...orbitConfigs[index].tilt));
        renderer.render(scene, camera);
      }
    }
    function onPointerMove(event) {
      if (!finePointer.matches || reduceMotion.matches) return;
      const bounds = mount.getBoundingClientRect();
      targetYaw = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.12;
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
    canvas.addEventListener('webglcontextlost', () => {
      renderer.setAnimationLoop(null);
      mount.classList.remove('is-rendered');
    });
    window.addEventListener('pagehide', () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      resources.forEach((resource) => resource.dispose());
      environmentTarget?.dispose();
      renderer.dispose();
    }, { once: true });
    sizeAndRender();
    updateMotion();
  } catch {
    // The SVG remains visible when WebGL cannot initialize.
    mount.classList.remove('is-rendered');
  }
}

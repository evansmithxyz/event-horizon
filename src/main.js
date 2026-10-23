import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import GUI from 'lil-gui';

import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import blackHoleFrag from './shaders/blackhole.frag.glsl?raw';
import finishFrag from './shaders/finish.frag.glsl?raw';

const MAX_PIXEL_RATIO = 1.5;
const MIN_RENDER_SCALE = 0.4;

const params = {
  gravity: 1,
  stepScale: 0.06,
  diskInner: 3,
  diskOuter: 14,
  diskIntensity: 1.5,
  diskTemp: 6000,
  diskDensity: 0.9,
  diskSpeed: 1,
  doppler: 0.5,
  stars: 1,
  galaxy: 1,
  autoRotate: true,
  exposure: 1,
  bloomStrength: 0.7,
  bloomRadius: 0.45,
  bloomThreshold: 0.75,
  grain: 0.035,
  vignette: 1,
  adaptive: true,
  renderScale: 1,
};

// ---------------------------------------------------------------------------
// Renderer, camera, controls

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
camera.position.setFromSphericalCoords(80, THREE.MathUtils.degToRad(52), -1.1);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 5;
controls.maxDistance = 90;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.6;
controls.autoRotateSpeed = 0.25;

// ---------------------------------------------------------------------------
// The black hole: a single full-screen quad whose fragment shader traces a
// light ray per pixel. The camera is only used for its pose and projection.

const uniforms = {
  uTime: { value: 0 },
  uCamPos: { value: camera.position },
  uCamWorld: { value: camera.matrixWorld },
  uProjInv: { value: camera.projectionMatrixInverse },
  uEscape: { value: 60 },
  uGravity: { value: params.gravity },
  uStepScale: { value: params.stepScale },
  uDiskInner: { value: params.diskInner },
  uDiskOuter: { value: params.diskOuter },
  uDiskIntensity: { value: params.diskIntensity },
  uDiskTemp: { value: params.diskTemp },
  uDiskDensity: { value: params.diskDensity },
  uDiskSpeed: { value: params.diskSpeed },
  uDoppler: { value: params.doppler },
  uStars: { value: params.stars },
  uGalaxy: { value: params.galaxy },
};

const scene = new THREE.Scene();
const quad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: blackHoleFrag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  }),
);
quad.frustumCulled = false;
scene.add(quad);

// ---------------------------------------------------------------------------
// Post-processing: HDR bloom -> ACES tone mapping -> lens finish

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight));
composer.addPass(bloom);
composer.addPass(new OutputPass());

const finish = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uGrain: { value: params.grain },
    uVignette: { value: params.vignette },
  },
  vertexShader: fullscreenVert,
  fragmentShader: finishFrag,
});
composer.addPass(finish);

function resize() {
  const pixelRatio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO) * params.renderScale;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth, innerHeight);
  finish.uniforms.uResolution.value.set(innerWidth * pixelRatio, innerHeight * pixelRatio);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Camera flights (intro and view presets). User input cancels a flight.

const flight = {
  active: false,
  t: 0,
  duration: 1,
  from: new THREE.Spherical(),
  to: new THREE.Spherical(),
  current: new THREE.Spherical(),
};

function flyTo(radius, elevationDeg, azimuth, duration = 3) {
  flight.from.setFromVector3(camera.position);
  const theta = azimuth ?? flight.from.theta;
  // Take the short way around.
  const turn = THREE.MathUtils.euclideanModulo(theta - flight.from.theta + Math.PI, Math.PI * 2) - Math.PI;
  flight.to.set(radius, THREE.MathUtils.degToRad(90 - elevationDeg), flight.from.theta + turn);
  flight.t = 0;
  flight.duration = duration;
  flight.active = true;
}

function updateFlight(dt) {
  flight.t = Math.min(flight.t + dt / flight.duration, 1);
  const k = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
  const { from, to, current } = flight;
  current.set(
    THREE.MathUtils.lerp(from.radius, to.radius, k),
    THREE.MathUtils.lerp(from.phi, to.phi, k),
    THREE.MathUtils.lerp(from.theta, to.theta, k),
  );
  camera.position.setFromSpherical(current);
  camera.lookAt(controls.target);
  if (flight.t >= 1) flight.active = false;
}

controls.addEventListener('start', () => {
  flight.active = false;
});

// ---------------------------------------------------------------------------
// UI

const actions = {
  cinematic: () => flyTo(24, 5),
  overhead: () => flyTo(34, 68),
  edgeOn: () => flyTo(24, 0.4),
  closeOrbit: () => flyTo(10, 16),
  toggleGravity,
};

const gui = new GUI({ title: 'Event Horizon' });

const views = gui.addFolder('Views');
views.add(actions, 'cinematic').name('Cinematic');
views.add(actions, 'overhead').name('Overhead');
views.add(actions, 'edgeOn').name('Edge-on');
views.add(actions, 'closeOrbit').name('Close orbit');
const autoRotateCtrl = views.add(params, 'autoRotate').name('Auto-rotate');

const spacetime = gui.addFolder('Spacetime');
const gravityCtrl = spacetime.add(params, 'gravity', 0, 1, 0.01).name('Gravity (lensing)');
spacetime.add(actions, 'toggleGravity').name('Toggle gravity  [G]');
spacetime.add(params, 'stepScale', 0.02, 0.15, 0.005).name('Ray step size');

const diskFolder = gui.addFolder('Accretion disk');
diskFolder.add(params, 'diskInner', 1.5, 6, 0.05).name('Inner radius');
diskFolder.add(params, 'diskOuter', 6, 30, 0.1).name('Outer radius');
diskFolder.add(params, 'diskIntensity', 0, 8, 0.05).name('Brightness');
diskFolder.add(params, 'diskTemp', 2000, 15000, 100).name('Temperature (K)');
diskFolder.add(params, 'diskDensity', 0.1, 2, 0.01).name('Opacity');
diskFolder.add(params, 'diskSpeed', 0, 4, 0.05).name('Orbital speed');
diskFolder.add(params, 'doppler', 0, 1, 0.01).name('Doppler beaming');

const sky = gui.addFolder('Sky').close();
sky.add(params, 'stars', 0, 3, 0.05).name('Stars');
sky.add(params, 'galaxy', 0, 3, 0.05).name('Galaxy');

const post = gui.addFolder('Camera & post').close();
post.add(params, 'exposure', 0.2, 3, 0.01).name('Exposure');
post.add(params, 'bloomStrength', 0, 3, 0.01).name('Bloom strength');
post.add(params, 'bloomRadius', 0, 1, 0.01).name('Bloom radius');
post.add(params, 'bloomThreshold', 0, 2, 0.01).name('Bloom threshold');
post.add(params, 'grain', 0, 0.15, 0.005).name('Film grain');
post.add(params, 'vignette', 0, 1, 0.01).name('Vignette');

const perfFolder = gui.addFolder('Performance').close();
perfFolder.add(params, 'adaptive').name('Adaptive resolution');
perfFolder.add(params, 'renderScale', MIN_RENDER_SCALE, 1, 0.01).name('Render scale').onChange(resize).listen();

if (innerWidth < 720) gui.close();

function toggleGravity() {
  params.gravity = params.gravity > 0.5 ? 0 : 1;
  gravityCtrl.updateDisplay();
}

addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  switch (event.key.toLowerCase()) {
    case 'g':
      toggleGravity();
      break;
    case 'h':
      gui.show(!document.body.classList.toggle('ui-hidden'));
      break;
    case ' ':
      event.preventDefault();
      params.autoRotate = !params.autoRotate;
      autoRotateCtrl.updateDisplay();
      break;
  }
});

// ---------------------------------------------------------------------------
// Adaptive resolution: ray tracing is fill-rate bound, so trade pixels for
// frame rate on slower GPUs. Never climbs back above a scale that was too slow.

const hud = document.getElementById('hud');
const perf = { frames: 0, time: 0, warmup: 2, ceiling: 1, goodStreak: 0 };

function trackPerformance(dt) {
  perf.frames++;
  perf.time += dt;
  if (perf.time < 1) return;

  const fps = perf.frames / perf.time;
  perf.frames = 0;
  perf.time = 0;
  hud.textContent = `${Math.round(fps)} fps · ${renderer.domElement.width}×${renderer.domElement.height}`;

  if (perf.warmup > 0) {
    perf.warmup--;
    return;
  }
  if (!params.adaptive || document.hidden) return;

  if (fps < 45 && params.renderScale > MIN_RENDER_SCALE) {
    perf.ceiling = params.renderScale;
    params.renderScale = Math.max(MIN_RENDER_SCALE, params.renderScale * 0.85);
    perf.goodStreak = 0;
    resize();
  } else if (fps > 57 && params.renderScale < perf.ceiling * 0.95) {
    if (++perf.goodStreak >= 3) {
      params.renderScale = Math.min(perf.ceiling * 0.95, params.renderScale * 1.1);
      perf.goodStreak = 0;
      resize();
    }
  } else {
    perf.goodStreak = 0;
  }
}

// Background tabs are throttled; don't mistake that for a slow GPU.
document.addEventListener('visibilitychange', () => {
  perf.frames = 0;
  perf.time = 0;
  perf.warmup = 1;
});

// ---------------------------------------------------------------------------
// Frame loop

let last = performance.now();
let elapsed = 0;

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  if (flight.active) {
    updateFlight(dt);
  } else {
    controls.autoRotate = params.autoRotate;
    controls.update(dt);
  }

  // Ease gravity so toggling it visibly un-bends (and re-bends) spacetime.
  uniforms.uGravity.value += (params.gravity - uniforms.uGravity.value) * (1 - Math.exp(-dt * 2.5));
  uniforms.uTime.value = elapsed;
  uniforms.uEscape.value = Math.max(60, camera.position.length() * 2);
  uniforms.uStepScale.value = params.stepScale;
  uniforms.uDiskInner.value = params.diskInner;
  uniforms.uDiskOuter.value = params.diskOuter;
  uniforms.uDiskIntensity.value = params.diskIntensity;
  uniforms.uDiskTemp.value = params.diskTemp;
  uniforms.uDiskDensity.value = params.diskDensity;
  uniforms.uDiskSpeed.value = params.diskSpeed;
  uniforms.uDoppler.value = params.doppler;
  uniforms.uStars.value = params.stars;
  uniforms.uGalaxy.value = params.galaxy;

  renderer.toneMappingExposure = params.exposure;
  bloom.strength = params.bloomStrength;
  bloom.radius = params.bloomRadius;
  bloom.threshold = params.bloomThreshold;
  finish.uniforms.uTime.value = elapsed;
  finish.uniforms.uGrain.value = params.grain;
  finish.uniforms.uVignette.value = params.vignette;

  composer.render(dt);
  trackPerformance(dt);
});

flyTo(24, 5, 0.35, 7);

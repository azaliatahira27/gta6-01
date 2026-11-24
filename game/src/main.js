// Azura Bay — boot, game loop and state machine.
//
// The loop runs the simulation in fixed 1/60 s steps (several in a slow frame, none
// in a fast one) and renders every frame. The game moves between four screens:
// menu, playing, paused and over. Every system registers through registerSystem()
// and gets update(dt, ctx) each step, in registration order — see
// docs/INTERFACES.md for the init order and the shared state shape.
//
// ?seed=N fixes the city. ?shot=start|play|end (with &seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady for a
// screenshot. window.__game exposes the live state for debugging.
import * as THREE from 'three';
import { CAMERA, CLOCK, MAX_FRAME, PLAYER, RADIO, REP_RANKS, SAVE_KEY, STEP, WEAPONS } from './config.js';
import { buildCity, clampToMap, worldToMap } from './city.js';
import { clamp, formatCash, formatClock, lerp, lerpAngle, repRankFor, resolveCircleBox, wantedStars } from './utils.js';
import { stageShot } from './shots.js';

// --- SYSTEM IMPORTS -------------------------------------------------------------
// Later builders add their module here (one import + one registerSystem call in
// bootSystems, in the order docs/INTERFACES.md prescribes). Nothing is imported
// that does not exist yet, so the skeleton runs standalone.
import { createHud } from './hud.js';            // Builder B: HUD + minimap
import { createVehicles } from './vehicles.js';  // Builder B: cars + driving
import { createTraffic } from './traffic.js';    // Builder C: traffic + peds
import { createPolice } from './police.js';      // Builder C: wanted + ABPD
import { createCombat } from './combat.js';      // Builder D: fists + guns
import { createMissions } from './missions.js';  // Builder D: story + dialogue
import { createCollectibles } from './collectibles.js'; // Builder G: Sun Shells
import { createMap } from './map.js';                // Builder G: city map
import { createAudio } from './audio.js';        // Builder E: radio + sfx
import { createSave } from './save.js';          // Builder E: localStorage save

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261118;

/** The one shared state object. Every system reads and writes this; see INTERFACES.md. */
export const state = {
  screen: 'menu',
  time: 0,
  clockMinutes: CLOCK.startHour * 60 + CLOCK.startMinute,
  seed,
  player: {
    x: -48, z: 120, heading: Math.PI, speed: 0,
    onFoot: true, inCar: null,
    health: PLAYER.maxHealth, armor: 0,
    cash: PLAYER.startCash, rep: 0, wanted: 0,
    weapon: 'fists', ammo: {},
  },
  mission: { id: null, stage: 0, title: 'Free Roam', text: 'Explore Azura Bay. Steal a car, meet the crew, make a name.' },
  camera: { yaw: 0, pitch: 0.32, yawOffset: 0, dist: CAMERA.onFootDist },
  radio: { station: 0, muted: false },
  events: [],
  stats: { carsStolen: 0, missionsDone: 0, distanceDriven: 0, copsLost: 0, enemiesDown: 0 },
};

/** Systems registered for the fixed-step update, in order. */
const systems = [];
export function registerSystem(system) {
  systems.push(system);
}

/** Queue a game event (systems drain state.events after each step). */
export function emit(type, data = {}) {
  state.events.push({ type, data, at: state.time });
}

// --- DOM -------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  scene: $('scene'), hud: $('hud'), minimap: $('minimap-canvas'),
  district: $('district-label'), missionPanel: $('mission-panel'), missionText: $('mission-text'),
  policePanel: $('police-panel'), policeText: $('police-text'),
  cash: $('cash'), stars: $('stars'), clock: $('clock'), rep: $('rep'),
  healthFill: $('health-fill'), armorFill: $('armor-fill'),
  weaponSlots: $('weapon-slots'), speedo: $('speedo'), carCondition: $('car-condition'),
  radio: $('radio'), dialogue: $('dialogue-box'), toast: $('toast'),
  startScreen: $('start-screen'), pauseMenu: $('pause-menu'), status: $('status'),
};
const minimapCtx = els.minimap.getContext('2d');

// --- Three.js setup ----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
els.scene.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(-120, 60, 160);

const city = buildCity(scene, seed);
const colliders = city.getColliders();
const spawn = city.getSpawnPoints().player;
state.player.x = spawn.x;
state.player.z = spawn.z;
state.player.heading = spawn.heading;

// Placeholder player: a capsule in Mara's sunset jacket. The character builder
// replaces this mesh; the state shape stays the same.
const playerMesh = new THREE.Group();
const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff7e5f, roughness: 0.7 });
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.0, 4, 10), bodyMat);
body.position.y = 1.05;
body.castShadow = true;
playerMesh.add(body);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
  new THREE.MeshStandardMaterial({ color: 0xc98a5a, roughness: 0.7 }));
head.position.y = 1.95;
head.castShadow = true;
playerMesh.add(head);
const cap = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x2b1b4d, roughness: 0.8 }));
cap.position.y = 2.0;
playerMesh.add(cap);
scene.add(playerMesh);

// --- Input -------------------------------------------------------------------------
const keys = new Set();
const mouse = { down: false, x: 0, y: 0 };
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Escape') togglePause();
  if (e.code === 'Enter' && state.screen === 'menu') startGame();
  if (e.code === 'KeyQ') cycleRadio();
  if (e.code === 'KeyN') toggleMute();
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= WEAPONS.length) state.player.weapon = WEAPONS[n - 1].id;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('pointerdown', (e) => { mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('pointerup', () => { mouse.down = false; });
window.addEventListener('pointermove', (e) => {
  if (!mouse.down) return;
  state.camera.yawOffset -= (e.clientX - mouse.x) * 0.005;
  state.camera.pitch = clamp(state.camera.pitch + (e.clientY - mouse.y) * 0.003, 0.08, 1.1);
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function cycleRadio() {
  state.radio.station = (state.radio.station + 1) % RADIO.length;
  emit('radio', { station: RADIO[state.radio.station].name });
  showToast(RADIO[state.radio.station].name + ' — ' + RADIO[state.radio.station].tagline);
}
function toggleMute() {
  state.radio.muted = !state.radio.muted;
  emit('mute', { muted: state.radio.muted });
  showToast(state.radio.muted ? 'Sound muted' : 'Sound on');
}

// --- Save (minimal stub; save.js extends this with missions + garage) ---------------
function saveGame() {
  try {
    const p = state.player;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: p.cash, rep: p.rep, health: p.health, armor: p.armor,
      x: p.x, z: p.z, heading: p.heading, wanted: p.wanted,
      missionId: state.mission.id, clockMinutes: state.clockMinutes, stats: state.stats,
    }));
  } catch { /* Storage can be off: the run then lasts this visit only. */ }
}
function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    const p = state.player;
    p.cash = s.cash ?? p.cash;
    p.rep = s.rep ?? 0;
    p.health = s.health ?? PLAYER.maxHealth;
    p.armor = s.armor ?? 0;
    p.x = s.x ?? p.x;
    p.z = s.z ?? p.z;
    p.heading = s.heading ?? p.heading;
    p.wanted = s.wanted ?? 0;
    state.clockMinutes = s.clockMinutes ?? state.clockMinutes;
    if (s.stats) state.stats = s.stats;
    return true;
  } catch {
    return false;
  }
}

// --- HUD stub (hud.js takes this over; same element ids, richer rendering) ----------
let toastTimer = 0;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 3200);
}
function announce(message) {
  els.status.textContent = message;
}

const hudCache = {};
function setText(el, key, value) {
  if (hudCache[key] !== value) {
    hudCache[key] = value;
    el.textContent = value;
  }
}
// --- Player stub (vehicles.js + combat.js extend movement; state shape is final) -----
function stepPlayer(dt) {
  const p = state.player;
  if (state.screen !== 'playing') {
    p.speed = 0;
    return;
  }
  // While driving, vehicles.js owns movement; the stub only mirrors the mesh.
  if (!p.onFoot) {
    playerMesh.position.set(p.x, 0, p.z);
    playerMesh.rotation.y = p.heading;
    playerMesh.visible = false;
    city.followSun(p.x, p.z);
    return;
  }
  playerMesh.visible = true;
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const turn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
  p.heading += turn * PLAYER.turnSpeed * dt;
  const target = fwd * (running ? PLAYER.runSpeed : PLAYER.walkSpeed);
  p.speed = lerp(p.speed, target, Math.min(1, dt * 10));
  const nx = p.x + Math.sin(p.heading) * p.speed * dt;
  const nz = p.z + Math.cos(p.heading) * p.speed * dt;
  const pos = clampToMap(nx, nz);
  for (const box of colliders) resolveCircleBox(pos, PLAYER.radius, box);
  p.x = pos.x;
  p.z = pos.z;
  playerMesh.position.set(p.x, 0, p.z);
  playerMesh.rotation.y = p.heading;
  // Bob while moving; lean into the run.
  const moving = Math.abs(p.speed) > 0.5;
  body.position.y = 1.05 + (moving ? Math.abs(Math.sin(state.time * 10)) * 0.06 : 0);
  body.rotation.x = moving ? 0.08 : 0;
  city.followSun(p.x, p.z);
}

// --- Camera --------------------------------------------------------------------------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(-120, 60, 160);
function stepCamera(dt) {
  const p = state.player;
  if (state.screen === 'menu') {
    // Slow establishing orbit over the city for the start screen.
    const t = state.time * 0.03;
    camTarget.set(0, 12, 0);
    camPos.set(Math.sin(t) * 190 - 60, 85, Math.cos(t) * 190);
    camera.position.lerp(camPos, Math.min(1, dt * 1.5));
    camera.lookAt(camTarget);
    city.followSun(0, 0);
    return;
  }
  const dist = p.inCar ? CAMERA.carDist : CAMERA.onFootDist;
  const height = p.inCar ? CAMERA.carHeight : CAMERA.onFootHeight;
  const yaw = p.heading + state.camera.yawOffset;
  const px = p.x - Math.sin(yaw) * dist;
  const pz = p.z - Math.cos(yaw) * dist;
  camPos.set(px, height + Math.sin(state.camera.pitch) * dist * 0.4, pz);
  camera.position.lerp(camPos, Math.min(1, dt * CAMERA.smooth));
  camTarget.set(
    p.x + Math.sin(p.heading) * CAMERA.lookAhead,
    1.6,
    p.z + Math.cos(p.heading) * CAMERA.lookAhead,
  );
  camera.lookAt(camTarget);
}

// --- Screens ---------------------------------------------------------------------------
function startGame() {
  if (state.screen === 'playing') return;
  state.screen = 'playing';
  els.startScreen.classList.add('hidden');
  els.pauseMenu.classList.add('hidden');
  announce('Playing. ' + city.getDistrictAt(state.player.x, state.player.z) + '.');
  emit('gameStart', {});
}
function togglePause() {
  if (state.screen === 'playing') {
    state.screen = 'paused';
    els.pauseMenu.classList.remove('hidden');
    saveGame();
    announce('Paused.');
  } else if (state.screen === 'paused') {
    state.screen = 'playing';
    els.pauseMenu.classList.add('hidden');
    announce('Playing.');
  }
}
function restartRun() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  const p = state.player;
  p.x = spawn.x;
  p.z = spawn.z;
  p.heading = spawn.heading;
  p.health = PLAYER.maxHealth;
  p.armor = 0;
  p.cash = PLAYER.startCash;
  p.rep = 0;
  p.wanted = 0;
  p.onFoot = true;
  p.inCar = null;
  state.mission = { id: null, stage: 0, title: 'Free Roam', text: 'Explore Azura Bay. Steal a car, meet the crew, make a name.' };
  state.clockMinutes = CLOCK.startHour * 60 + CLOCK.startMinute;
  state.screen = 'playing';
  els.pauseMenu.classList.add('hidden');
  els.startScreen.classList.add('hidden');
  announce('New run. Welcome back to Azura Bay.');
}
els.startButton = $('start-button');
els.startButton.addEventListener('click', startGame);
$('resume-button').addEventListener('click', togglePause);
$('restart-button').addEventListener('click', restartRun);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.screen === 'playing') togglePause();
});

// --- Systems boot ------------------------------------------------------------------------
function bootSystems() {
  // Order is the contract (INTERFACES.md): city ambient, then player, then the
  // systems later builders register here in the same order.
  registerSystem({ name: 'city', update: (dt) => city.update(dt, state.time) });
  registerSystem({ name: 'player', update: (dt) => stepPlayer(dt) });
  registerSystem(createVehicles(ctx));
  registerSystem(createTraffic(ctx));
  registerSystem(createPolice(ctx));
  registerSystem(createCombat(ctx));
  registerSystem(createMissions(ctx));
  registerSystem(createMap(ctx));
  registerSystem(createCollectibles(ctx));
  registerSystem(createAudio(ctx));
  registerSystem(createSave(ctx));
  registerSystem(createHud(ctx));
  registerSystem({ name: 'camera', update: (dt) => stepCamera(dt) });
}

// --- Fixed-step loop -----------------------------------------------------------------------
function stepWorld(dt) {
  state.time += dt;
  if (state.screen === 'playing') {
    state.clockMinutes += CLOCK.minutesPerRealSecond * dt;
  }
  for (const sys of systems) sys.update(dt, ctx);
  // Drain events: toasts and announcements live here until hud.js owns them.
  for (const ev of state.events) {
    if (ev.type === 'toast') showToast(ev.data.text);
    if (ev.type === 'announce') announce(ev.data.text);
  }
  state.events.length = 0;
}

const ctx = {
  state, scene, camera, renderer, city, playerMesh,
  emit, registerSystem, showToast, announce, saveGame, loadGame,
  stepWorld, keys, colliders,
};

function runGame() {
  loadGame();
  playerMesh.position.set(state.player.x, 0, state.player.z);
  playerMesh.rotation.y = state.player.heading;
  bootSystems();
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    if (state.screen === 'menu' || state.screen === 'playing') {
      while (accumulator >= STEP) {
        stepWorld(STEP);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    if (state.screen === 'playing') {
      saveTimer += 1 / 60;
      if (saveTimer > 30) {
        saveTimer = 0;
        saveGame();
      }
    }
    renderer.render(scene, camera);
  }
  announce('Azura Bay. Press Enter or Start Engine to play.');
  requestAnimationFrame(frame);
}

function runShot(name) {
  bootSystems();
  const sceneInfo = stageShot(name, ctx);
  let painted = 0;
  function paint() {
    renderer.render(scene, camera);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  state.screen = sceneInfo.screen;
  if (sceneInfo.screen === 'menu') els.startScreen.classList.remove('hidden');
  else els.startScreen.classList.add('hidden');
  stepWorld(0);
  requestAnimationFrame(paint);
}

// Debug + screenshot hooks. Screenshot staging reads window.__game; the harness
// waits for window.__shotReady.
window.__game = {
  state, city, scene, camera, renderer, playerMesh,
  stepWorld, saveGame, loadGame, startGame, togglePause,
  emit, registerSystem, systems,
};

if (shot) runShot(shot);
else runGame();

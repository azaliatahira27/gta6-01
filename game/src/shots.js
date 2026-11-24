// Screenshot scenes behind ?shot=<name>: real play forward from a fresh world.
import * as THREE from 'three';
import { MISSIONS, STEP } from './config.js';

const START_SECONDS = 3;
const PLAY_SECONDS = 9;
const END_SECONDS = 4;
const CHASE_DRIVE = 3.5; // seconds at 3 stars so units close in
const CHASE_END = 0.3;   // seconds at 4 stars + mission, dialogue still fresh
const STREET_WALK = 6;   // seconds on foot down the Old Town street
const CITY_SETTLE = 4;   // seconds for the orbit camera to settle

function holdKeys(ctx, codes, seconds) {
  for (const code of codes) ctx.keys.add(code);
  for (let t = 0; t < seconds; t += STEP) ctx.stepWorld(STEP);
  for (const code of codes) ctx.keys.delete(code);
}

function stageStart(ctx) {
  const { state } = ctx;
  state.screen = 'menu';
  for (let t = 0; t < START_SECONDS; t += STEP) ctx.stepWorld(STEP);
  return { screen: 'menu' };
}

function stagePlay(ctx) {
  const { state } = ctx;
  const p = state.player;
  p.x = -168;
  p.z = 60;
  p.heading = Math.PI;
  p.cash = 1240;
  p.rep = 120;
  p.health = 86;
  p.armor = 40;
  p.wanted = 0;
  state.mission = {
    id: MISSIONS[0].id,
    stage: 1,
    title: MISSIONS[0].name,
    text: 'Drive Rosa to the Marina. Lose any tail on the way.',
  };
  state.screen = 'playing';
  holdKeys(ctx, ['KeyW', 'ShiftLeft'], PLAY_SECONDS);
  return { screen: 'playing' };
}

function stageEnd(ctx) {
  const { state } = ctx;
  const p = state.player;
  p.x = 48;
  p.z = -24;
  p.heading = Math.PI / 2;
  p.cash = 18450;
  p.rep = 820;
  p.health = 24;
  p.armor = 0;
  p.wanted = 5;
  p.weapon = 'smg';
  state.mission = {
    id: MISSIONS[5].id,
    stage: 3,
    title: MISSIONS[5].name,
    text: 'The vault is open. Get to the Sunset Heights lookout — now.',
  };
  state.screen = 'playing';
  holdKeys(ctx, ['KeyW', 'ShiftLeft'], END_SECONDS);
  return { screen: 'playing' };
}

function tapKey(ctx, code) {
  ctx.keys.add(code);
  ctx.stepWorld(STEP);
  ctx.keys.delete(code);
  ctx.stepWorld(STEP);
}

// Drive with W held, steering toward a waypoint (bang-bang on heading error).
function driveTo(ctx, seconds, tx, tz) {
  for (let t = 0; t < seconds; t += STEP) {
    const p = ctx.state.player;
    const want = Math.atan2(tx - p.x, tz - p.z);
    let err = want - p.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    ctx.keys.add('KeyW');
    if (err > 0.05) ctx.keys.add('KeyA');
    else ctx.keys.delete('KeyA');
    if (err < -0.05) ctx.keys.add('KeyD');
    else ctx.keys.delete('KeyD');
    ctx.stepWorld(STEP);
  }
  ctx.keys.delete('KeyW');
  ctx.keys.delete('KeyA');
  ctx.keys.delete('KeyD');
}

/** Step the world with no keys held (coast to a stop, let the camera catch up). */
function coast(ctx, seconds) {
  for (let t = 0; t < seconds; t += STEP) ctx.stepWorld(STEP);
}

// Pull real traffic cars + peds into the frame ahead of the player: cars on
// the road in alternating lanes (oncoming ones flipped), peds on the sidewalks.
function cluster(ctx, nCars, nPeds, d0) {
  const p = ctx.state.player;
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
  let ci = 0, pi = 0;
  ctx.scene.traverse((o) => {
    if (!o.isGroup) return;
    const u = o.userData;
    if (u.kind === 'car' && String(u.id).startsWith('tcar') && ci < nCars) {
      const d = d0 + ci * 6, w = ci % 2 ? 1 : -1;
      o.position.set(p.x + fx * d + rx * 2.5 * w, 0, p.z + fz * d + rz * 2.5 * w);
      o.rotation.y = p.heading + (ci % 2) * Math.PI;
      ci += 1;
    } else if (u.kind === 'ped' && pi < nPeds) {
      const d = d0 + pi * 4, w = pi % 2 ? 1 : -1;
      o.position.set(p.x + fx * d + rx * 7.5 * w, 0, p.z + fz * d + rz * 7.5 * w);
      pi += 1;
    }
  });
}

// Park the real police units + heli in view (police.js holds the stage).
function stagePursuit(ctx, d0, hd, hy, hs, fl) {
  const p = ctx.state.player;
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
  const at = (d, s) => ({ x: p.x + fx * d + rx * s, z: p.z + fz * d + rz * s });
  const u = [at(d0, -4), at(d0 + 9, 4)];
  if (fl) u.push(at(4, fl));
  ctx.state.police.stage = {
    units: u.map((q, i) => ({ ...q, h: i === 2 ? p.heading : Math.atan2(p.x - q.x, p.z - q.z) })),
    heli: { ...at(hd || 20, hs ?? 6), y: hy || 13 },
  };
}

function stageCombat(ctx) {
  const { state } = ctx;
  const p = state.player;
  // On foot, pistol out, interceptors + low heli ahead; the last F-hold fires
  // one shot so the flash + tracer freeze in the frame.
  p.x = 0; p.z = 144; p.heading = -Math.PI / 2;
  p.cash = 1240; p.rep = 120; p.health = 100; p.armor = 0;
  p.ammo = { pistol: 60 }; p.weapon = 'pistol'; p.wanted = 3;
  state.camera.yawOffset = 0.3;
  state.camera.pitch = 0.5;
  ctx.camera.fov = 50; ctx.camera.updateProjectionMatrix(); // zoom in
  state.screen = 'playing';
  state.mission = { id: MISSIONS[3].id, stage: 2 }; // Heat Wave: live job + briefing
  coast(ctx, 1.5);
  state.clockMinutes = 17 * 60 + 30; // golden hour, brighter than the 18:42 dusk
  ctx.city.sun.intensity = 3.4;
  ctx.renderer.toneMappingExposure = 1.25;
  stagePursuit(ctx, 10, 26, 8, 6, -6); // heli in the zoomed frame, flank unit blocking the lane
  holdKeys(ctx, ['KeyF'], 0.25);
  // Staged on-foot enemies: 3 peds + red health bars above them.
  let n = 0;
  const a = Math.sin(p.heading), b = Math.cos(p.heading);
  ctx.scene.traverse((o) => {
    if (n > 2 || !o.isGroup || o.userData.kind !== 'ped') return;
    const s = [[7, -2], [8, 3], [9, 0]][n++];
    o.position.set(p.x + a * s[0] + b * s[1], 0, p.z + b * s[0] - a * s[1]);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.9), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    bar.position.set(o.position.x, 2.1, o.position.z);
    ctx.scene.add(bar);
  });
  cluster(ctx, 2, 0, 20); // traffic held up behind the police line
  return { screen: 'paused' }; // freeze peds in place
}

function stageMap(ctx) {
  const { state } = ctx;
  const p = state.player;
  // A mid-game map: 2 missions done, 7 shells collected, then M opens the map.
  p.x = -48; p.z = 120; p.heading = Math.PI;
  p.cash = 18450; p.rep = 820; p.health = 90; p.armor = 80;
  Object.assign(state.stats, { missionsDone: 2, carsStolen: 7, copsLost: 4, enemiesDown: 12 });
  state.saveData = { missionsDone: ['m1', 'm2'] };
  state.screen = 'playing';
  const list = state.shells?.list ?? [];
  for (let i = 0; i < 7 && i < list.length; i += 1) {
    p.x = list[i][0]; p.z = list[i][1];
    coast(ctx, 0.1);
  }
  p.x = -48; p.z = 120;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
  return { screen: 'paused' };
}

function stageChase(ctx) {
  const { state } = ctx;
  const p = state.player;
  // Cover: steal the pink Cielo GT, run west into the sunset at 4 stars.
  p.x = 6;
  p.z = 150;
  p.heading = -Math.PI / 2;
  p.cash = 18450;
  p.rep = 820;
  p.health = 90;
  p.armor = 80;
  p.ammo = { pistol: 48, smg: 128, rifle: 18 };
  p.weapon = 'smg';
  state.screen = 'playing';
  tapKey(ctx, 'KeyE'); // steal the Cielo (carStolen raises wanted to 1)
  p.wanted = 3; // heli + 3 units
  driveTo(ctx, CHASE_DRIVE, -168, 144);
  state.camera.pitch = 0.14; // lower camera
  ctx.camera.fov = 66; ctx.camera.updateProjectionMatrix(); // wider FOV
  coast(ctx, 0.7);
  p.wanted = 4; // roadblock spawns ~40 units ahead — close, not yet reached
  state.mission = { id: MISSIONS[3].id, stage: 2 }; // Heat Wave: survive the heat
  coast(ctx, CHASE_END);
  state.clockMinutes = 17 * 60 + 30; // golden hour, brighter than the 18:43 dusk
  ctx.city.sun.intensity = 3.4;
  ctx.renderer.toneMappingExposure = 1.25;
  stagePursuit(ctx, 10, 20, 9, -6, -6); // flank alongside + heli close, open sky
  cluster(ctx, 4, 4, 20); // civilian cars ahead, peds on the sidewalks
  return { screen: 'playing' };
}

function stageStreet(ctx) {
  const { state } = ctx;
  const p = state.player;
  // On foot down an Old Town street at golden hour — peds, traffic, storefronts.
  p.x = 0;
  p.z = 144;
  p.heading = -Math.PI / 2;
  p.cash = 1240;
  p.rep = 120;
  p.health = 100;
  p.armor = 0;
  p.ammo = { pistol: 60 };
  p.weapon = 'pistol';
  state.screen = 'playing';
  holdKeys(ctx, ['KeyW'], STREET_WALK);
  holdKeys(ctx, ['KeyF'], 0.25);
  return { screen: 'playing' };
}

function stageMission(ctx) {
  const { state } = ctx;
  const p = state.player;
  // First Fare briefing: walk toward the gold beacon marking the Marlin, and
  // stop short of the 8-unit reach radius so the stage-1 briefing stays up.
  p.x = -48;
  p.z = 118;
  p.heading = Math.PI;
  p.cash = 250;
  p.rep = 0;
  p.health = 100;
  p.armor = 0;
  state.mission = { id: MISSIONS[0].id, stage: 1 };
  state.screen = 'playing';
  holdKeys(ctx, ['KeyW', 'ShiftLeft'], 1);
  state.clockMinutes = 17 * 60 + 30; // golden hour, brighter than the 18:42 dusk
  ctx.city.sun.intensity = 3.4;
  ctx.renderer.toneMappingExposure = 1.25;
  ctx.camera.fov = 55; ctx.camera.updateProjectionMatrix(); // slight zoom in
  cluster(ctx, 3, 5, 10); // cars passing, peds on both sidewalks
  return { screen: 'playing' };
}

// Busy street: cluster the real traffic cars + peds ahead, freeze 'paused'.
function stageStreet2(ctx) {
  const { state } = ctx;
  const p = state.player;
  p.x = 0; p.z = 144; p.heading = -Math.PI / 2;
  p.cash = 1240; p.rep = 120; p.health = 100; p.armor = 0;
  state.screen = 'playing';
  coast(ctx, 2);
  state.clockMinutes = 17 * 60 + 30;
  ctx.city.sun.intensity = 3.4;
  ctx.renderer.toneMappingExposure = 1.25;
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
  const cars = [], peds = [];
  ctx.scene.traverse((o) => {
    const u = o.userData;
    if (!o.isGroup) return;
    if (u.kind === 'car' && u.id.startsWith('tcar')) cars.push(o);
    else if (u.kind === 'ped') peds.push(o);
  });
  for (let i = 0; i < 6; i += 1) {
    const e = i % 2, d = 9 + i * 5, w = e ? 1 : -1;
    const bx = p.x + fx * d, bz = p.z + fz * d;
    cars[i].position.set(bx + rx * 2.5 * w, 0, bz + rz * 2.5 * w);
    cars[i].rotation.y = p.heading + e * Math.PI;
    peds[i].position.set(bx + rx * 7.5 * w, 0, bz + rz * 7.5 * w);
  }
  return { screen: 'paused' };
}

function stageCity(ctx) {
  const { state } = ctx;
  const p = state.player;
  // Aerial: park the menu orbit camera south-west over the ocean, let it
  // settle, then return 'playing' — the dt=0 step keeps the camera where the
  // orbit left it and swings the view onto the player in the Marina.
  p.x = -96;
  p.z = -96;
  p.heading = Math.PI / 2;
  p.cash = 18450;
  p.rep = 820;
  p.health = 90;
  p.armor = 80;
  state.time = (Math.PI * 1.75) / 0.03;
  state.screen = 'menu';
  for (let t = 0; t < CITY_SETTLE; t += STEP) ctx.stepWorld(STEP);
  state.clockMinutes = 17 * 60 + 30; // golden hour, brighter than the 18:42 dusk
  ctx.city.sun.intensity = 3.4;
  ctx.renderer.toneMappingExposure = 1.25;
  return { screen: 'playing' };
}

// Set the world to the named scene and return the screen main.js should show.
export function stageShot(name, ctx) {
  if (name === 'play') return stagePlay(ctx);
  if (name === 'end') return stageEnd(ctx);
  if (name === 'chase') return stageChase(ctx);
  if (name === 'street') return stageStreet(ctx);
  if (name === 'mission') return stageMission(ctx);
  if (name === 'city') return stageCity(ctx);
  if (name === 'combat') return stageCombat(ctx);
  if (name === 'map') return stageMap(ctx);
  if (name === 'street2') return stageStreet2(ctx);
  return stageStart(ctx);
}

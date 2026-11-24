// Azura Bay cars — parked spawns, stealing, arcade driving and damage.
// While driving, state.player mirrors the car, so the camera, minimap and
// police all read the player fields. No imports from other builder modules.
import * as THREE from 'three';
import { CARS } from './config.js';
import { clamp, dist2, resolveCircleBox } from './utils.js';
import { clampToMap as clampMap } from './city.js';

const CAR_R = 1.6;
const MPH_TO_UNITS = 0.32;
const STEAL_DIST = 3.2;
const CRASH_DELTA = 12;

const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9ad1ff, roughness: 0.15, metalness: 0.4 });
const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xffedb0, emissiveIntensity: 2.2 });
const smokeMat = new THREE.MeshBasicMaterial({ color: 0x555560, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
const smokeGeo = new THREE.PlaneGeometry(1.1, 1.1);

function buildCarMesh(def) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.35, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), paint);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.0), paint);
  cabin.position.set(0, 1.05, -0.25);
  cabin.castShadow = true;
  g.add(cabin);
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.55), glassMat);
  shield.position.set(0, 1.05, 0.78);
  shield.rotation.x = -0.35;
  g.add(shield);
  for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    wheel.castShadow = true;
    g.add(wheel);
  }
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  for (const sx of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.1), lightMat);
    lamp.position.set(sx, 0.62, 2.12);
    g.add(lamp);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 6, 12, 1, true), coneMat);
    cone.rotation.x = Math.PI / 2;
    cone.position.set(sx, 0.55, 5.1);
    g.add(cone);
  }
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 1.6 });
  for (const sx of [-0.6, 0.6]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.1), tailMat);
    tail.position.set(sx, 0.62, -2.12);
    g.add(tail);
  }
  if (def.id === 'cielo') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), paint);
    wing.position.set(0, 1.18, -1.95);
    wing.castShadow = true;
    g.add(wing);
    const strutGeo = new THREE.BoxGeometry(0.08, 0.32, 0.3);
    for (const sx of [-0.7, 0.7]) {
      const strut = new THREE.Mesh(strutGeo, paint);
      strut.position.set(sx, 0.98, -1.95);
      g.add(strut);
    }
  }
  return g;
}

function makeSmoke() {
  const group = new THREE.Group();
  const puffs = [];
  for (let i = 0; i < 5; i += 1) {
    const p = new THREE.Mesh(smokeGeo, smokeMat.clone());
    p.position.set((i - 2) * 0.25, 1.2 + i * 0.5, 0);
    p.visible = false;
    group.add(p);
    puffs.push(p);
  }
  return { group, puffs };
}

export function createVehicles(ctx) {
  const { state, scene, city, emit, keys } = ctx;
  const cars = [];
  let prevE = false;

  function init() {
    const defs = new Map(CARS.map((c) => [c.id, c]));
    for (const spawn of city.getSpawnPoints().cars) {
      const def = defs.get(spawn.model) || CARS[0];
      const model = buildCarMesh(def);
      model.position.set(spawn.x, 0, spawn.z);
      model.rotation.y = spawn.heading;
      model.userData = { kind: 'car', id: def.id, hp: 100 };
      model.traverse((child) => { child.userData = model.userData; });
      const smoke = makeSmoke();
      model.add(smoke.group);
      scene.add(model);
      cars.push({
        id: def.id, name: def.name, model, def,
        x: spawn.x, z: spawn.z, heading: spawn.heading, speed: 0,
        condition: 100, stolen: false, wrecked: false, smoke,
      });
    }
  }

  function damage(car, amount, at) {
    car.condition = Math.max(0, car.condition - amount);
    car.model.userData.hp = car.condition;
    // Visual damage: the paint darkens toward scorched as condition drops.
    const paint = car.model.children[0].material;
    if (paint && paint.color) {
      const f = car.condition / 100;
      const c = car.def.color;
      const r = Math.round((((c >> 16) & 255) * f + 20 * (1 - f)));
      const g = Math.round((((c >> 8) & 255) * f + 20 * (1 - f)));
      const b = Math.round(((c & 255) * f + 20 * (1 - f)));
      paint.color.setHex((r << 16) | (g << 8) | b);
    }
    if (amount > 0) emit('hit', { target: 'car', damage: Math.round(amount), at });
    if (car.condition <= 0 && !car.wrecked) {
      car.wrecked = true;
      car.speed = 0;
      emit('toast', { text: car.name + ' is wrecked. Get out!' });
    }
  }

  function nearestParked(x, z) {
    let best = null;
    let bestD = STEAL_DIST;
    for (const car of cars) {
      if (car.wrecked || (state.player.inCar === car)) continue;
      const d = dist2(x, z, car.x, car.z);
      if (d < bestD) { best = car; bestD = d; }
    }
    return best;
  }

  function enterCar(car) {
    const p = state.player;
    p.onFoot = false;
    p.inCar = car;
    car.stolen = true;
    p.x = car.x;
    p.z = car.z;
    p.heading = car.heading;
    p.speed = car.speed;
    state.stats.carsStolen += 1;
    emit('carStolen', { car });
    emit('toast', { text: 'Stole the ' + car.name });
  }

  function exitCar() {
    const p = state.player;
    const car = p.inCar;
    if (!car) return;
    const side = car.heading + Math.PI / 2;
    const pos = clampMap(car.x + Math.sin(side) * 2.4, car.z + Math.cos(side) * 2.4);
    p.x = pos.x;
    p.z = pos.z;
    p.heading = car.heading;
    p.speed = 0;
    p.onFoot = true;
    p.inCar = null;
  }

  function drive(car, dt) {
    const p = state.player;
    const def = car.def;
    const maxSpeed = def.top * MPH_TO_UNITS;
    const onRoad = city.isOnRoad(car.x, car.z);
    const surface = onRoad ? 1 : 0.6;
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
      - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
    if (!car.wrecked) {
      if (fwd > 0) car.speed += def.accel * 16 * surface * dt;
      else if (fwd < 0) car.speed -= (car.speed > 0.5 ? 26 : 9) * surface * dt;
      else car.speed -= car.speed * Math.min(1, 0.6 * dt);
    } else {
      car.speed -= car.speed * Math.min(1, 3 * dt);
    }
    car.speed = clamp(car.speed, -12, maxSpeed);
    const steerScale = (1 - Math.min(1, Math.abs(car.speed) / maxSpeed) * 0.6) * def.grip * surface;
    car.heading += steer * 1.9 * steerScale * dt * Math.sign(car.speed || 1);
    const before = car.speed;
    let nx = car.x + Math.sin(car.heading) * car.speed * dt;
    let nz = car.z + Math.cos(car.heading) * car.speed * dt;
    const pos = clampMap(nx, nz);
    nx = pos.x;
    nz = pos.z;
    let hitBuilding = false;
    for (const box of ctx.colliders) {
      if (resolveCircleBox(pos, CAR_R, box)) hitBuilding = true;
    }
    if (hitBuilding) {
      const impact = Math.abs(before);
      car.speed *= -0.22;
      if (impact > CRASH_DELTA) {
        damage(car, (impact - CRASH_DELTA) * 1.6, state.time);
        state.shake = Math.min(0.9, impact * 0.03);
        state.hitStop = 0.05;
      }
    }
    car.x = pos.x;
    car.z = pos.z;
    // Car-vs-car: push apart; hard shunts damage both.
    for (const other of cars) {
      if (other === car) continue;
      const d = dist2(car.x, car.z, other.x, other.z);
      const min = CAR_R * 2;
      if (d > 0.01 && d < min) {
        const push = (min - d) / 2;
        const ux = (car.x - other.x) / d;
        const uz = (car.z - other.z) / d;
        car.x += ux * push;
        car.z += uz * push;
        other.x -= ux * push;
        other.z -= uz * push;
        const rel = Math.abs(car.speed - other.speed);
        if (rel > CRASH_DELTA) {
          damage(car, (rel - CRASH_DELTA) * 0.8, state.time);
          damage(other, (rel - CRASH_DELTA) * 0.8, state.time);
          car.speed *= 0.5;
          state.shake = Math.min(0.9, rel * 0.03);
          state.hitStop = 0.05;
        }
        other.model.position.set(other.x, 0, other.z);
      }
    }
    car.model.position.set(car.x, 0, car.z);
    car.model.rotation.y = car.heading;
    p.x = car.x;
    p.z = car.z;
    p.heading = car.heading;
    p.speed = car.speed;
    state.stats.distanceDriven += Math.abs(car.speed) * dt;
  }

  function updateSmoke(car, dt) {
    const { puffs } = car.smoke;
    puffs.forEach((puff, i) => {
      if (!car.wrecked) { puff.visible = false; return; }
      puff.visible = true;
      puff.position.y += dt * 1.4;
      puff.material.opacity = 0.55 * (1 - (puff.position.y - 1.2) / 4);
      puff.lookAt(ctx.camera.position);
      if (puff.position.y > 5.2) {
        puff.position.y = 1.2 + i * 0.3;
        puff.material.opacity = 0.55;
      }
    });
  }

  function update(dt) {
    for (const car of cars) {
      if (!car.wrecked && car.model.userData.hp <= 0) damage(car, car.condition, state.time);
      updateSmoke(car, dt);
    }
    if (state.screen !== 'playing') return;
    const p = state.player;
    const eDown = keys.has('KeyE') || keys.has('KeyF');
    if (eDown && !prevE) {
      if (p.onFoot) {
        const car = nearestParked(p.x, p.z);
        if (car) enterCar(car);
      } else {
        exitCar();
      }
    }
    prevE = eDown;
    if (!p.onFoot && p.inCar) drive(p.inCar, dt);
    for (const car of cars) {
      if (car !== p.inCar) {
        car.model.position.set(car.x, 0, car.z);
        car.model.rotation.y = car.heading;
      }
    }
  }

  init();
  return { name: 'vehicles', init, update };
}

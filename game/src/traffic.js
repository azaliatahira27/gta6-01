// Traffic cars + peds on the road graph; meshes carry userData { kind, id, hp }.
import * as THREE from 'three';
import { CITY } from './config.js';
import { clamp, dist2, lerpAngle, mulberry32, pick, randRange } from './utils.js';

const CAR_COUNT = 16;
const PED_COUNT = 20;
const CAR_COLORS = [0xc8ccd4, 0x7fa8c8, 0xd8c8a8, 0x8ab87a, 0xc08aa8, 0xe0e0d8, 0x6a9ab8, 0xd8a878];
const SHIRTS = [0xd94f6a, 0x4f8fd9, 0x2fbfa0, 0xd9a441, 0xf2f2f2, 0x7a4fd9, 0xff8a5c, 0x5a7a4f];

function makeCarMesh(color, id) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 4.2), mat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.1),
    new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.25, metalness: 0.5 }));
  cabin.position.set(0, 1.15, -0.2);
  cabin.castShadow = true;
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.9 });
  for (const [x, z] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.34, z);
    g.add(w);
  }
  g.userData = { kind: 'car', id, hp: 100 };
  return g;
}

function makePedMesh(shirt, id) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.95, 8),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }));
  body.position.y = 0.95;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xc98a5a, roughness: 0.7 }));
  head.position.y = 1.65;
  head.castShadow = true;
  g.add(head);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.55, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e2a33, roughness: 0.9 }));
  legs.position.y = 0.28;
  g.add(legs);
  g.userData = { kind: 'ped', id, hp: 50 };
  return g;
}

export function createTraffic(ctx) {
  const rng = mulberry32((ctx.state.seed || 20261118) ^ 0x5eed);
  let net = null;
  let adj = null;
  let cars = [];
  let peds = [];
  let ready = false;
  let densityT = 0;
  let prevScreen = 'menu';
  let carSeq = 0;
  let pedSeq = 0;

  function neighbours(id) {
    return adj.get(id) || [];
  }

  function randomNodeNear(x, z, minD, maxD) {
    const pool = net.nodes.filter((n) => {
      const d = dist2(x, z, n.x, n.z);
      return d >= minD && d <= maxD;
    });
    return pool.length ? pick(rng, pool) : net.nodes[Math.floor(rng() * net.nodes.length)];
  }

  function spawnCar(nearPlayer) {
    const p = ctx.state.player;
    const node = nearPlayer ? randomNodeNear(p.x, p.z, 25, 80) : pick(rng, net.nodes);
    const mesh = makeCarMesh(pick(rng, CAR_COLORS), 'tcar' + (carSeq += 1));
    mesh.position.set(node.x, 0, node.z);
    ctx.scene.add(mesh);
    const car = {
      mesh, node: node.id, target: pick(rng, neighbours(node.id)) ?? node.id,
      x: node.x, z: node.z, heading: rng() * Math.PI * 2,
      speed: 0, cruise: randRange(rng, 8, 14), wrecked: false, wreckT: 0,
    };
    cars.push(car);
    return car;
  }

  function spawnPed(nearPlayer) {
    const p = ctx.state.player;
    const node = nearPlayer ? randomNodeNear(p.x, p.z, 12, 70) : pick(rng, net.nodes);
    const off = CITY.roadWidth / 2 + CITY.sidewalk / 2;
    const side = rng() < 0.5 ? -1 : 1;
    const along = rng() < 0.5;
    const x = along ? node.x + side * off : node.x;
    const z = along ? node.z : node.z + side * off;
    const mesh = makePedMesh(pick(rng, SHIRTS), 'ped' + (pedSeq += 1));
    mesh.position.set(x, 0, z);
    ctx.scene.add(mesh);
    const ped = {
      mesh, x, z, heading: rng() * Math.PI * 2, speed: randRange(rng, 1.5, 2.5),
      tx: x, tz: z, pauseT: randRange(rng, 0, 2), fleeT: 0, dead: false, deadT: 0,
    };
    pickPedTarget(ped);
    peds.push(ped);
    return ped;
  }

  function pickPedTarget(ped) {
    const node = randomNodeNear(ped.x, ped.z, 8, 60);
    const off = CITY.roadWidth / 2 + CITY.sidewalk / 2;
    const side = rng() < 0.5 ? -1 : 1;
    if (rng() < 0.5) { ped.tx = node.x + side * off; ped.tz = node.z; }
    else { ped.tx = node.x; ped.tz = node.z + side * off; }
  }

  function init() {
    if (ready) return;
    ready = true;
    net = ctx.city.getRoadNetwork();
    adj = new Map();
    for (const n of net.nodes) adj.set(n.id, []);
    for (const e of net.edges) {
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
    for (let i = 0; i < CAR_COUNT; i += 1) spawnCar(true);
    for (let i = 0; i < PED_COUNT; i += 1) spawnPed(true);
  }

  // Opening density: the moment play starts, drop every far actor and respawn
  // the full count near the player, so the first frame is already busy.
  function clusterNearPlayer() {
    const p = ctx.state.player;
    for (const [list, far] of [[cars, 80], [peds, 70]]) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (dist2(list[i].x, list[i].z, p.x, p.z) > far) {
          ctx.scene.remove(list[i].mesh);
          list.splice(i, 1);
        }
      }
    }
    while (cars.length < CAR_COUNT) spawnCar(true);
    while (peds.length < PED_COUNT) spawnPed(true);
  }

  function carAhead(car) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const other of cars) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 6 && d > 0.01 && (dx * fx + dz * fz) / d > 0.7) return true;
    }
    return false;
  }

  function updateCars(dt) {
    const p = ctx.state.player;
    for (const car of cars) {
      if (car.mesh.userData.hp <= 0 && !car.wrecked) {
        car.wrecked = true;
        car.wreckT = 0;
        car.mesh.rotation.z = 0.08;
      }
      if (car.wrecked) {
        car.wreckT += dt;
        car.speed = 0;
        continue;
      }
      const target = net.nodes[car.target];
      const dx = target.x - car.x;
      const dz = target.z - car.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 2) {
        car.node = car.target;
        const opts = neighbours(car.node).filter((n) => n !== car.node);
        car.target = opts.length ? pick(rng, opts) : car.node;
        continue;
      }
      const want = Math.atan2(dx, dz);
      car.heading = lerpAngle(car.heading, want, Math.min(1, dt * 3));
      const blocked = carAhead(car);
      const goal = blocked ? 0 : car.cruise;
      car.speed += clamp(goal - car.speed, -20 * dt, 8 * dt);
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      // A zero step syncs nothing: shots.js may have posed the mesh by hand.
      if (dt > 0) {
        car.mesh.position.set(car.x, 0, car.z);
        car.mesh.rotation.y = car.heading;
      }
    }
    // Recycle wrecks and far cars, then top the count back up near the player.
    densityT += dt;
    if (densityT < 1) return;
    densityT = 0;
    for (let i = cars.length - 1; i >= 0; i -= 1) {
      const car = cars[i];
      const far = dist2(car.x, car.z, p.x, p.z) > 180;
      if ((car.wrecked && car.wreckT > 10) || far) {
        ctx.scene.remove(car.mesh);
        cars.splice(i, 1);
      }
    }
    while (cars.length < CAR_COUNT) spawnCar(true);
  }

  function updatePeds(dt) {
    const p = ctx.state.player;
    let shot = false;
    for (const ev of ctx.state.events) if (ev.type === 'shot') shot = true;
    for (let i = peds.length - 1; i >= 0; i -= 1) {
      const ped = peds[i];
      if (ped.mesh.userData.hp <= 0 && !ped.dead) {
        ped.dead = true;
        ped.deadT = 0;
        ped.mesh.rotation.x = -Math.PI / 2;
        ped.mesh.position.y = 0.25;
      }
      if (ped.dead) {
        ped.deadT += dt;
        if (ped.deadT > 5) {
          ctx.scene.remove(ped.mesh);
          peds.splice(i, 1);
        }
        continue;
      }
      if (shot && ped.fleeT <= 0 && dist2(ped.x, ped.z, p.x, p.z) < 30) ped.fleeT = 5;
      if (ped.fleeT > 0) {
        ped.fleeT -= dt;
        const dx = ped.x - p.x;
        const dz = ped.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        ped.heading = lerpAngle(ped.heading, Math.atan2(dx / d, dz / d), Math.min(1, dt * 6));
        ped.x += Math.sin(ped.heading) * 5.5 * dt;
        ped.z += Math.cos(ped.heading) * 5.5 * dt;
      } else if (ped.pauseT > 0) {
        ped.pauseT -= dt;
      } else {
        const dx = ped.tx - ped.x;
        const dz = ped.tz - ped.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 1) {
          ped.pauseT = randRange(rng, 1, 4);
          pickPedTarget(ped);
        } else {
          ped.heading = lerpAngle(ped.heading, Math.atan2(dx, dz), Math.min(1, dt * 4));
          ped.x += Math.sin(ped.heading) * ped.speed * dt;
          ped.z += Math.cos(ped.heading) * ped.speed * dt;
          ped.mesh.position.y = Math.abs(Math.sin(ctx.state.time * 8 + pedSeq)) * 0.04;
        }
      }
      if (dt > 0) {
        ped.mesh.position.set(ped.x, ped.mesh.position.y, ped.z);
        ped.mesh.rotation.y = ped.heading;
      }
    }
    while (peds.length < PED_COUNT) spawnPed(true);
  }

  function update(dt, c) {
    if (!ready) init();
    if (prevScreen === 'menu' && c.state.screen === 'playing') clusterNearPlayer();
    prevScreen = c.state.screen;
    if (c.state.screen !== 'playing' && c.state.screen !== 'menu') return;
    updateCars(dt);
    updatePeds(dt);
  }

  return { name: 'traffic', update, init };
}

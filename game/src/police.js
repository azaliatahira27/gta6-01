// ABPD wanted system: heat, pursuit units, heli, roadblocks. Writes state.police.
import * as THREE from 'three';
import { POLICE } from './config.js';
import { clamp, dist2, lerpAngle, mulberry32, pick } from './utils.js';

const CALLSIGNS = ['ABPD-11', 'ABPD-23', 'ABPD-37', 'ABPD-42', 'ABPD-58'];
const DECAY_SECONDS = 45;
const BUST_DIST = 4;
const BUST_SECONDS = 3;

function makeInterceptorMesh(name, id) {
  const g = new THREE.Group();
  g.scale.setScalar(1.15); // read at frame scale: bigger silhouette than traffic
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.8, 4.4),
    new THREE.MeshStandardMaterial({ color: POLICE.carColor, roughness: 0.4, metalness: 0.5 }));
  body.position.y = 0.6;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.62, 2.1),
    new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.2, metalness: 0.6 }));
  cabin.position.set(0, 1.25, -0.2);
  g.add(cabin);
  // Light bar: two emissive lenses, flashed alternately.
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 0.44),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
  bar.position.set(0, 1.62, -0.2);
  g.add(bar);
  const lensA = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.34, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x330000, emissive: POLICE.lightA, emissiveIntensity: 8 }));
  lensA.position.set(-0.4, 1.66, -0.2);
  g.add(lensA);
  const lensB = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.34, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x000033, emissive: POLICE.lightB, emissiveIntensity: 0.4 }));
  lensB.position.set(0.4, 1.66, -0.2);
  g.add(lensB);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.9 });
  for (const [x, z] of [[-0.9, 1.45], [0.9, 1.45], [-0.9, -1.45], [0.9, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.36, z);
    g.add(w);
  }
  g.userData = { kind: 'cop', id, hp: 120, name, lensA, lensB };
  return g;
}

function makeHeliMesh() {
  const g = new THREE.Group();
  g.scale.setScalar(1.5); // read at frame scale: a helicopter, not a black box
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 5.4),
    new THREE.MeshStandardMaterial({ color: 0xd8dee6, roughness: 0.5, metalness: 0.4,
      emissive: 0x8b9aa8, emissiveIntensity: 0.9 }));
  body.position.y = 0;
  g.add(body);
  // Rotor disc reads as a helicopter against the sky.
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.06, 24),
    new THREE.MeshBasicMaterial({ color: 0x14181c, transparent: true, opacity: 0.6 }));
  rotor.position.y = 1.1;
  g.add(rotor);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.4),
    new THREE.MeshStandardMaterial({ color: 0xd8dee6, roughness: 0.5,
      emissive: 0x8b9aa8, emissiveIntensity: 0.9 }));
  tail.position.set(0, 0.2, -4.2);
  g.add(tail);
  // Spotlight cone, apex at the heli, opening toward the player below.
  const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 28, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false }));
  cone.position.y = -14; // apex at the heli, wide end on the ground below
  g.add(cone);
  g.userData = { kind: 'cop', id: 'heli', hp: 9999, rotor, cone };
  return g;
}

export function createPolice(ctx) {
  const rng = mulberry32((ctx.state.seed || 20261118) ^ 0x51ce);
  let net = null;
  let adj = null;
  let units = [];
  let roadblocks = [];
  let heli = null;
  let heliAngle = 0;
  let ready = false;
  let flashT = 0;
  let flashOn = false;
  let quietT = 0;
  let blockT = 0;
  let bustT = 0;
  let scanT = 0;
  let copSeq = 0;
  const deadCounted = new Set();

  function neighbours(id) {
    return adj.get(id) || [];
  }

  function nodeNearPlayer(minD, maxD) {
    const p = ctx.state.player;
    const pool = net.nodes.filter((n) => {
      const d = dist2(p.x, p.z, n.x, n.z);
      return d >= minD && d <= maxD;
    });
    return pool.length ? pick(rng, pool) : ctx.city.nearestNode(p.x, p.z);
  }

  // Greedy graph step: the neighbour that gets closest to the goal node.
  function nextNodeToward(fromId, goalId) {
    const goal = net.nodes[goalId];
    let best = fromId;
    let bestD = dist2(net.nodes[fromId].x, net.nodes[fromId].z, goal.x, goal.z);
    for (const n of neighbours(fromId)) {
      const d = dist2(net.nodes[n].x, net.nodes[n].z, goal.x, goal.z);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function nextCallsign() {
    const used = new Set(units.map((u) => u.name));
    for (const c of CALLSIGNS) if (!used.has(c)) return c;
    return 'ABPD-' + (70 + (copSeq % 30));
  }

  function spawnUnit() {
    const p = ctx.state.player;
    const station = ctx.city.getSpawnPoints().policeStation;
    const node = units.length === 0 && dist2(p.x, p.z, station.x, station.z) > 60
      ? ctx.city.nearestNode(station.x, station.z)
      : nodeNearPlayer(60, 130);
    const name = nextCallsign();
    const mesh = makeInterceptorMesh(name, 'cop' + (copSeq += 1));
    mesh.position.set(node.x, 0, node.z);
    ctx.scene.add(mesh);
    const unit = {
      name, mesh, x: node.x, z: node.z,
      heading: rng() * Math.PI * 2, speed: 0, state: 'EN ROUTE',
      node: node.id, target: node.id, lastKnown: { x: p.x, z: p.z },
      losT: 0, lostT: 0, wrecked: false,
    };
    units.push(unit);
    return unit;
  }

  function removeUnit(unit) {
    ctx.scene.remove(unit.mesh);
    units.splice(units.indexOf(unit), 1);
  }

  function setWanted(level, c) {
    const p = c.state.player;
    const next = clamp(level, 0, POLICE.maxStars);
    if (next === p.wanted) return;
    p.wanted = next;
    quietT = 0;
    c.emit('wanted', { level: next });
  }

  function readEvents(c) {
    const p = c.state.player;
    for (const ev of c.state.events) {
      if (ev.type === 'carStolen') {
        // Stealing a different car while wanted shakes the pursuit off for 5s.
        if (p.wanted > 0) {
          for (const u of units) { u.state = 'LOST'; u.lostT = 5; }
        }
        setWanted(p.wanted + 1, c);
      } else if (ev.type === 'shot') {
        const seen = units.some((u) => dist2(u.x, u.z, p.x, p.z) < 80);
        if (seen) setWanted(p.wanted + 1, c);
      } else if (ev.type === 'hit') {
        const t = ev.data && ev.data.target;
        const kind = typeof t === 'string' ? t : t && t.kind;
        const hp = t && typeof t.hp === 'number' ? t.hp : null;
        const killed = ev.data.killed === true || (hp !== null && hp <= 0);
        if (killed && kind === 'ped') setWanted(p.wanted + 1, c);
        else if (killed && kind === 'cop') setWanted(p.wanted + 2, c);
      }
    }
  }

  function updateHeli(dt, c) {
    const p = c.state.player;
    if (p.wanted >= 3 && !heli) {
      heli = makeHeliMesh();
      c.scene.add(heli);
    } else if (p.wanted < 3 && heli) {
      c.scene.remove(heli);
      heli = null;
    }
    if (!heli) return;
    heliAngle += dt * 0.5;
    const hx = p.x + Math.cos(heliAngle) * 15;
    const hz = p.z + Math.sin(heliAngle) * 15;
    heli.position.set(hx, 28, hz);
    heli.rotation.y = Math.atan2(p.x - hx, p.z - hz);
    heli.userData.rotor.rotation.y += dt * 22;
  }

  // Shot staging: state.police.stage poses the real units/heli (shots.js only).
  function applyStage(c) {
    const st = c.state.police.stage;
    if (!st) return;
    const p = c.state.player;
    (st.units || []).forEach((q, i) => {
      const u = units[i];
      if (!u) return;
      u.x = q.x; u.z = q.z; u.heading = q.h; u.speed = 0; u.state = 'PURSUING';
      u.mesh.position.set(q.x, 0, q.z);
      u.mesh.rotation.y = q.h;
    });
    if (st.heli && heli) {
      heli.position.set(st.heli.x, st.heli.y, st.heli.z);
      heli.rotation.y = Math.atan2(p.x - st.heli.x, p.z - st.heli.z);
      const cn = heli.userData.cone;
      if (cn) { cn.scale.y = st.heli.y / 28; cn.position.y = -st.heli.y / 2; }
    }
  }

  function updateRoadblocks(dt, c) {
    const p = c.state.player;
    if (p.wanted < 4) {
      for (const b of roadblocks) c.scene.remove(b.mesh);
      roadblocks = [];
      blockT = 0;
      return;
    }
    blockT -= dt;
    if (roadblocks.length && blockT > 0) return;
    blockT = 10;
    for (const b of roadblocks) c.scene.remove(b.mesh);
    roadblocks = [];
    // Nearest node ahead of the player's heading, parked across the road.
    const ahead = { x: p.x + Math.sin(p.heading) * 55, z: p.z + Math.cos(p.heading) * 55 };
    const node = c.city.nearestNode(ahead.x, ahead.z);
    for (let i = 0; i < 2; i += 1) {
      const mesh = makeInterceptorMesh('ROADBLOCK', 'block' + i);
      const side = i === 0 ? -3 : 3;
      const mx = node.x + Math.cos(p.heading) * side;
      const mz = node.z - Math.sin(p.heading) * side;
      mesh.position.set(mx, 0, mz);
      mesh.rotation.y = p.heading + Math.PI / 2;
      c.scene.add(mesh);
      roadblocks.push({ name: 'ABPD-RB' + (i + 1), mesh, x: mx, z: mz, state: 'ROADBLOCK' });
    }
  }

  function driveUnit(u, dt, c, tx, tz, topSpeed) {
    const dx = tx - u.x;
    const dz = tz - u.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.5) return;
    const want = Math.atan2(dx, dz);
    u.heading = lerpAngle(u.heading, want, Math.min(1, dt * 2.5));
    const onRoad = c.city.isOnRoad(u.x, u.z);
    const top = onRoad ? topSpeed : topSpeed * 0.6;
    u.speed += clamp(top - u.speed, -26 * dt, 12 * dt);
    u.x += Math.sin(u.heading) * u.speed * dt;
    u.z += Math.cos(u.heading) * u.speed * dt;
    u.mesh.position.set(u.x, 0, u.z);
    u.mesh.rotation.y = u.heading;
  }

  function updateUnits(dt, c) {
    const p = c.state.player;
    // Active count matches the wanted level; wrecks persist on the street
    // (and stay scannable for kill heat) until the heat fully drops.
    while (units.filter((u) => !u.wrecked).length < p.wanted && units.length < 8) spawnUnit();
    while (units.filter((u) => !u.wrecked).length > p.wanted) {
      const spare = [...units].reverse().find((u) => !u.wrecked);
      if (!spare) break;
      removeUnit(spare);
    }
    if (p.wanted === 0) {
      for (const u of [...units]) removeUnit(u);
    } else {
      const wrecks = units.filter((u) => u.wrecked);
      while (wrecks.length > 3) removeUnit(wrecks.shift());
    }
    const goalNode = c.city.nearestNode(p.x, p.z).id;
    for (const u of units) {
      if (u.mesh.userData.hp <= 0 && !u.wrecked) {
        u.wrecked = true;
        u.speed = 0;
        u.state = 'LOST';
        u.mesh.rotation.z = 0.1;
      }
      if (u.wrecked) continue;
      const d = dist2(u.x, u.z, p.x, p.z);
      // Line of sight: lost after 10s beyond 90 units.
      if (d > 90) u.losT += dt;
      else { u.losT = 0; u.lastKnown = { x: p.x, z: p.z }; }
      if (u.lostT > 0) {
        u.lostT -= dt;
        u.state = 'LOST';
      } else if (u.losT > 10) {
        u.state = 'LOST';
      } else if (p.wanted >= 3 && d < 25) {
        u.state = 'RAMMING';
      } else if (d < 40) {
        u.state = 'PURSUING';
      } else {
        u.state = 'EN ROUTE';
      }
      if (u.state === 'LOST') {
        driveUnit(u, dt, c, u.lastKnown.x, u.lastKnown.z, 16);
        if (dist2(u.x, u.z, u.lastKnown.x, u.lastKnown.z) < 4) u.losT = 0;
      } else if (u.state === 'EN ROUTE') {
        const target = net.nodes[u.target];
        if (dist2(u.x, u.z, target.x, target.z) < 3) {
          u.node = u.target;
          u.target = nextNodeToward(u.node, goalNode);
        }
        driveUnit(u, dt, c, net.nodes[u.target].x, net.nodes[u.target].z, 20);
      } else if (u.state === 'RAMMING') {
        // Aim at where the player will be, not where they are.
        const lead = 0.6;
        driveUnit(u, dt, c,
          p.x + Math.sin(p.heading) * p.speed * lead,
          p.z + Math.cos(p.heading) * p.speed * lead, 30);
      } else {
        // PURSUING: chase directly, matching the player's pace.
        const top = clamp(Math.abs(p.speed) + 6, 14, 28);
        driveUnit(u, dt, c, p.x, p.z, top);
      }
    }
  }

  // Kill heat: scan the scene twice a second for newly dead peds/cops.
  function scanDeaths(dt, c) {
    scanT += dt;
    if (scanT < 0.5) return;
    scanT = 0;
    const p = c.state.player;
    c.scene.traverse((o) => {
      const ud = o.userData;
      if (!ud || ud.hp > 0 || !ud.id || deadCounted.has(ud.id)) return;
      if (ud.kind === 'ped') {
        deadCounted.add(ud.id);
        setWanted(p.wanted + 1, c);
      } else if (ud.kind === 'cop') {
        deadCounted.add(ud.id);
        setWanted(p.wanted + 2, c);
      }
    });
  }

  function updateBusted(dt, c) {
    const p = c.state.player;
    if (p.wanted === 0 || units.length === 0) { bustT = 0; return; }
    const stopped = p.onFoot || Math.abs(p.speed) < 2;
    const close = units.some((u) => !u.wrecked && dist2(u.x, u.z, p.x, p.z) < BUST_DIST);
    if (stopped && close) bustT += dt;
    else bustT = 0;
    if (bustT < BUST_SECONDS) return;
    bustT = 0;
    c.announce('Busted by the ABPD');
    c.showToast('Busted by the ABPD — bail cost you 10% of your cash.');
    p.cash = Math.floor(p.cash * 0.9);
    setWanted(0, c);
    const station = c.city.getSpawnPoints().policeStation;
    p.x = station.x;
    p.z = station.z;
    p.heading = station.heading;
    p.speed = 0;
    p.onFoot = true;
    p.inCar = null;
    if (c.state.mission.id) c.emit('missionFail', { id: c.state.mission.id });
  }

  function init(c) {
    if (ready) return;
    ready = true;
    net = c.city.getRoadNetwork();
    adj = new Map();
    for (const n of net.nodes) adj.set(n.id, []);
    for (const e of net.edges) {
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
    c.state.police = { units: [], heli: false };
  }

  function update(dt, c) {
    // main.js never calls init(); spawn lazily on the first step.
    if (!ready) init(c);
    const p = c.state.player;
    if (!c.state.police) c.state.police = { units: [], heli: false };
    if (c.state.screen === 'playing') {
      readEvents(c);
      // Decay: 45s with no crime and no unit within 60 units.
      const near = units.some((u) => !u.wrecked && dist2(u.x, u.z, p.x, p.z) < 60);
      if (p.wanted > 0 && !near) {
        quietT += dt;
        if (quietT >= DECAY_SECONDS) {
          setWanted(p.wanted - 1, c);
          if (p.wanted === 0) c.state.stats.copsLost = (c.state.stats.copsLost ?? 0) + 1;
        }
      } else {
        quietT = 0;
      }
      updateUnits(dt, c);
      updateHeli(dt, c);
      applyStage(c);
      updateRoadblocks(dt, c);
      updateBusted(dt, c);
      scanDeaths(dt, c);
    }
    // Flash the light bars every 0.4s.
    flashT += dt;
    if (flashT >= 0.4) {
      flashT = 0;
      flashOn = !flashOn;
      for (const u of units) {
        u.mesh.userData.lensA.material.emissiveIntensity = flashOn ? 8 : 0.4;
        u.mesh.userData.lensB.material.emissiveIntensity = flashOn ? 0.4 : 8;
      }
    }
    // Publish the contract state every step.
    const list = units.map((u) => ({
      name: u.name, state: u.state,
      dist: Math.round(dist2(u.x, u.z, p.x, p.z)), x: u.x, z: u.z,
    }));
    for (const b of roadblocks) {
      list.push({ name: b.name, state: b.state, dist: Math.round(dist2(b.x, b.z, p.x, p.z)), x: b.x, z: b.z });
    }
    c.state.police.units = list;
    c.state.police.heli = heli !== null;
  }

  return { name: 'police', update, init };
}

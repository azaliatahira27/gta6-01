// Azura Bay combat — fists, guns, enemy fire and ammo pickups.
// Guns auto-aim: a raycast from the camera through the screen centre finds the
// first damageable mesh (traffic/police/vehicles tag theirs with
// userData { kind, id, hp }); otherwise the nearest target in a 60-degree cone
// is hit. Damage lowers userData.hp — the owning system handles death. No
// imports between builder modules: targets come from the scene, cops from
// state.police. NOTE: Q is the radio and E/F enter cars (main/vehicles.js), so
// weapons cycle on R and F fires only while held (a tap still enters a car).
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { dist2 } from './utils.js';

const RATE = { fists: 0.35, pistol: 0.25, smg: 0.09, rifle: 0.13 };
const CONE = Math.cos(Math.PI / 6); // 60-degree cone (30-degree half-angle)
const COP_SCAN_EVERY = 0.25;

export function createCombat(ctx) {
  let ready = false;
  let raycaster, flash, flashT = 0, tracer, tracerMat, tracerT = 0;
  let cooldown = 0, prevTrig = false, prevR = false, fHeld = 0, mouseDown = false;
  let lastHitT = -99, outOfAmmoT = -99, copScanT = 0, seedT = 0, seededAmmo = false;
  let vigT = 0, hudEl = null, pickupAlt = 0;
  const pickups = []; // { mesh, kind, amount, t }
  const flashes = []; // { mat, hex, t }
  const liveCops = []; // { x, z } of cop meshes with hp > 0, refreshed by scan
  const ownMeshes = new Set();
  const ndc = new THREE.Vector2(0, 0);
  const tmpV = new THREE.Vector3();

  const weaponDef = (id) => WEAPONS.find((w) => w.id === id) || WEAPONS[0];
  const owned = (id) => {
    if (id === 'fists') return true;
    const a = ctx.state.player.ammo;
    return !!a && typeof a[id] === 'number';
  };

  function init(c) {
    if (c) ctx = c;
    if (ready) return;
    ready = true;
    raycaster = new THREE.Raycaster();
    flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffcc66 }),
    );
    flash.visible = false;
    ownMeshes.add(flash);
    ctx.scene.add(flash);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    tracerMat = new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0 });
    tracer = new THREE.Line(geo, tracerMat);
    tracer.visible = false;
    tracer.frustumCulled = false;
    ownMeshes.add(tracer);
    ctx.scene.add(tracer);
    ctx.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.button === 0) mouseDown = true;
    });
    window.addEventListener('pointerup', () => { mouseDown = false; });
  }

  /** Walk up from a raycast hit to the damageable ancestor. */
  function damageableOf(obj) {
    let o = obj;
    while (o) {
      if (o.userData && o.userData.kind) return o;
      o = o.parent;
    }
    return null;
  }
  function isDescendantOf(obj, root) {
    let o = obj;
    while (o) {
      if (o === root) return true;
      o = o.parent;
    }
    return false;
  }

  /** Live damageables, deduped (vehicles share one userData object). */
  function collectDamageables() {
    const seen = new Set();
    const out = [];
    ctx.scene.traverse((o) => {
      const ud = o.userData;
      if (ud && ud.kind && ud.hp > 0 && !seen.has(ud)) {
        seen.add(ud);
        out.push(o);
      }
    });
    return out;
  }

  function flashMesh(target) {
    let mesh = null;
    target.traverse((o) => {
      if (!mesh && o.isMesh && o.material && o.material.emissive) mesh = o;
    });
    if (!mesh || flashes.some((f) => f.mat === mesh.material)) return;
    const mat = mesh.material;
    flashes.push({ mat, hex: mat.emissive.getHex(), t: 0.1 });
    mat.emissive.setHex(0xff2222);
  }

  function dropPickup(x, z) {
    if (pickups.length >= 8) {
      const old = pickups.shift();
      ctx.scene.remove(old.mesh);
    }
    // SMG ammo only once the SMG is owned (m2 reward); else pistol rounds.
    pickupAlt += 1;
    const kind = pickupAlt % 2 === 0 && owned('smg') ? 'smg' : 'pistol';
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1e5f3a, emissive: 0x39ff88, emissiveIntensity: 1.4 }),
    );
    mesh.position.set(x, 0.6, z);
    ownMeshes.add(mesh);
    ctx.scene.add(mesh);
    pickups.push({ mesh, kind, amount: kind === 'smg' ? 60 : 30, t: 0 });
  }

  function applyDamage(target, dmg, point) {
    const ud = target.userData;
    if (!ud || ud.hp <= 0) return;
    const wasAlive = ud.hp > 0;
    ud.hp -= dmg;
    ctx.emit('hit', { target: ud.kind, damage: dmg });
    flashMesh(target);
    if (wasAlive && ud.hp <= 0 && ud.kind === 'cop' && point) dropPickup(point.x, point.z);
    if (wasAlive && ud.hp <= 0 && (ud.kind === 'cop' || ud.kind === 'ped')) {
      ctx.state.stats.enemiesDown = (ctx.state.stats.enemiesDown ?? 0) + 1;
    }
  }

  /** Nearest live target in the cone ahead (raycast fallback). */
  function nearestInCone(range, kinds) {
    const p = ctx.state.player;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    let best = null;
    let bestD = Infinity;
    for (const o of collectDamageables()) {
      if (kinds && !kinds.includes(o.userData.kind)) continue;
      o.getWorldPosition(tmpV);
      const d = dist2(p.x, p.z, tmpV.x, tmpV.z);
      if (d > range || d >= bestD) continue;
      const dot = d < 0.01 ? 1 : ((tmpV.x - p.x) * fx + (tmpV.z - p.z) * fz) / d;
      if (dot < CONE) continue;
      best = o;
      bestD = d;
    }
    return best;
  }

  function fireGun(def) {
    const p = ctx.state.player;
    const muzzle = { x: p.x + Math.sin(p.heading) * 0.9, y: p.onFoot ? 1.75 : 1.2, z: p.z + Math.cos(p.heading) * 0.9 };
    flash.position.set(muzzle.x, muzzle.y, muzzle.z);
    flash.visible = true;
    flashT = 0.06;
    let end = null;
    raycaster.setFromCamera(ndc, ctx.camera);
    raycaster.far = def.range;
    const hits = raycaster.intersectObjects(ctx.scene.children, true);
    let blockPoint = null;
    for (const hit of hits) {
      if (ownMeshes.has(hit.object) || isDescendantOf(hit.object, ctx.playerMesh)) continue;
      const dmg = damageableOf(hit.object);
      if (dmg && dmg.userData.hp > 0) {
        end = hit.point;
        applyDamage(dmg, def.damage, hit.point);
        break;
      }
      // Solid city geometry between camera and target: note it, but the
      // cone fallback below still gets a chance — the camera sits behind
      // the player, so a wall past the player's shoulder must not eat a
      // shot at a target right in front of them.
      if (isDescendantOf(hit.object, ctx.city.group)) {
        blockPoint = hit.point;
        break;
      }
    }
    if (!end) {
      const target = nearestInCone(def.range);
      if (target) {
        target.getWorldPosition(tmpV);
        end = { x: tmpV.x, y: 1, z: tmpV.z };
        applyDamage(target, def.damage, end);
      } else if (blockPoint) {
        end = blockPoint;
      }
    }
    if (!end) {
      end = {
        x: muzzle.x + Math.sin(p.heading) * def.range,
        y: muzzle.y,
        z: muzzle.z + Math.cos(p.heading) * def.range,
      };
    }
    const pos = tracer.geometry.attributes.position;
    pos.setXYZ(0, muzzle.x, muzzle.y, muzzle.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    tracer.visible = true;
    tracerMat.opacity = 0.9;
    tracerT = 0.12;
  }

  function fireMelee(def) {
    const target = nearestInCone(def.range, ['ped', 'cop']);
    if (!target) return;
    target.getWorldPosition(tmpV);
    applyDamage(target, def.damage, { x: tmpV.x, z: tmpV.z });
  }

  function tryFire() {
    const p = ctx.state.player;
    if (cooldown > 0) return;
    const def = weaponDef(p.weapon);
    if (!p.onFoot && def.id === 'fists') return; // no punching from the car
    if (def.ammo !== Infinity) {
      if ((p.ammo[def.id] ?? 0) <= 0) {
        if (ctx.state.time - outOfAmmoT > 2) {
          outOfAmmoT = ctx.state.time;
          ctx.showToast('Out of ammo — drop a cop for rounds');
        }
        return;
      }
      p.ammo[def.id] -= 1;
    }
    cooldown = RATE[def.id] ?? 0.25;
    if (def.id === 'fists') {
      fireMelee(def);
      return;
    }
    ctx.emit('shot', { weapon: def.id });
    fireGun(def);
  }

  function hurt(amount) {
    const p = ctx.state.player;
    if (p.health <= 0) return;
    const absorbed = Math.min(p.armor, amount);
    p.armor -= absorbed;
    p.health = Math.max(0, p.health - (amount - absorbed));
    lastHitT = ctx.state.time;
    if (!hudEl) hudEl = document.getElementById('hud');
    if (hudEl) {
      hudEl.style.boxShadow = 'inset 0 0 120px rgba(255,0,0,0.55)';
      vigT = 0.15;
    }
    if (p.health <= 0) {
      ctx.emit('playerDown', {});
      ctx.state.screen = 'over';
    }
  }

  function update(dt, c) {
    if (c) ctx = c;
    if (!ready) init();
    const s = ctx.state;
    const p = s.player;
    // Ammo default waits a second so save.js can seed the v2 loadout first.
    if (!seededAmmo) {
      seedT += dt;
      if (seedT > 1) {
        seededAmmo = true;
        if (!p.ammo || Object.keys(p.ammo).length === 0) p.ammo = { pistol: 60 };
      }
    }
    cooldown = Math.max(0, cooldown - dt);
    if (flashT > 0) {
      flashT -= dt;
      if (flashT <= 0) flash.visible = false;
    }
    if (tracerT > 0) {
      tracerT -= dt;
      tracerMat.opacity = Math.max(0, 0.9 * (tracerT / 0.12));
      if (tracerT <= 0) tracer.visible = false;
    }
    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      flashes[i].t -= dt;
      if (flashes[i].t <= 0) {
        flashes[i].mat.emissive.setHex(flashes[i].hex);
        flashes.splice(i, 1);
      }
    }
    if (vigT > 0) {
      vigT -= dt;
      if (vigT <= 0 && hudEl) hudEl.style.boxShadow = '';
    }
    if (s.screen !== 'playing') return;
    // Main.js Digit keys pick anything; unowned weapons fall back to fists.
    if (!owned(p.weapon)) p.weapon = 'fists';
    const rDown = ctx.keys.has('KeyR');
    if (rDown && !prevR) {
      const list = WEAPONS.filter((w) => owned(w.id));
      const i = list.findIndex((w) => w.id === p.weapon);
      p.weapon = list[(i + 1) % list.length].id;
    }
    prevR = rDown;
    // LMB fires; F fires only while held past the car-enter tap.
    fHeld = ctx.keys.has('KeyF') ? fHeld + dt : 0;
    const trig = mouseDown || fHeld > 0.2;
    const def = weaponDef(p.weapon);
    if (trig && (def.auto || !prevTrig)) tryFire();
    prevTrig = trig;
    for (let i = pickups.length - 1; i >= 0; i -= 1) {
      const pk = pickups[i];
      pk.t += dt;
      pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = 0.6 + Math.sin(pk.t * 3) * 0.15;
      if (dist2(p.x, p.z, pk.mesh.position.x, pk.mesh.position.z) < 1.5) {
        p.ammo[pk.kind] = (p.ammo[pk.kind] ?? 0) + pk.amount;
        ctx.showToast('+' + pk.amount + ' ' + weaponDef(pk.kind).name + ' rounds');
        ctx.scene.remove(pk.mesh);
        ownMeshes.delete(pk.mesh);
        pickups.splice(i, 1);
      }
    }
    // Enemy fire: units from state.police, confirmed alive against the scene
    // (the published list also carries wrecked units and roadblocks — mesh hp
    // is the truth, and there is no liveness flag).
    if (p.wanted >= 2) {
      copScanT -= dt;
      if (copScanT <= 0) {
        copScanT = COP_SCAN_EVERY;
        liveCops.length = 0;
        for (const o of collectDamageables()) {
          if (o.userData.kind === 'cop' && o.userData.id !== 'heli') {
            o.getWorldPosition(tmpV);
            liveCops.push({ x: tmpV.x, z: tmpV.z });
          }
        }
        const chance = 0.15 + (p.wanted - 2) * (0.2 / 3); // 0.15 at 2 stars -> 0.35 at 5
        for (const u of s.police?.units ?? []) {
          if (dist2(p.x, p.z, u.x, u.z) > 45) continue;
          const alive = liveCops.some((cp) => dist2(cp.x, cp.z, u.x, u.z) < 3);
          if (!alive) continue;
          if (Math.random() < chance * COP_SCAN_EVERY) hurt(Math.round(6 + Math.random() * 4));
        }
      }
    }
    // Regen 1 hp/s once the heat is off and 10 s passed since the last hit.
    if (p.wanted === 0 && p.health > 0 && p.health < 100 && s.time - lastHitT > 10) {
      p.health = Math.min(100, p.health + dt);
    }
  }

  return { name: 'combat', update, init };
}

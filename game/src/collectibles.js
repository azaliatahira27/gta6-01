// Sun Shells — 24 collectibles, 4 per district, fixed spots on road centrelines.
// Drive/walk over one (3 units): +$100 + 10 REP. Set lives in state.shells;
// save.js persists it in v2; the counter sits under the cash readout.
import * as THREE from 'three';
import { dist2 } from './utils.js';

const TOTAL = 24;
const PICKUP_R = 3;
// 4 per district, in DISTRICTS order: Coral, Marina, Harbor, Downtown, Old Town, Heights.
const SPOTS = [
  [-168, -144], [-168, 0], [-168, 144], [-144, 96],
  [-48, -192], [-48, -144], [-48, -96], [0, -192],
  [48, -192], [96, -192], [48, -144], [96, -144],
  [48, -96], [96, -48], [48, 0], [96, 48],
  [-48, 96], [-48, 144], [-48, 192], [0, 144],
  [192, -144], [192, 0], [192, 144], [144, 48],
];

export function createCollectibles(ctx) {
  const { state, scene, emit } = ctx;
  const got = new Set();
  const groups = [];
  let adopted = false;
  let counter = null;

  const coreMat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffaa00, emissiveIntensity: 1.6 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const coreGeo = new THREE.OctahedronGeometry(0.55);
  const glowGeo = new THREE.OctahedronGeometry(0.95);

  function setCounter() {
    if (counter) counter.textContent = 'SHELLS ' + got.size + '/' + TOTAL;
  }

  function init() {
    for (let i = 0; i < TOTAL; i += 1) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(coreGeo, coreMat));
      g.add(new THREE.Mesh(glowGeo, glowMat));
      g.position.set(SPOTS[i][0], 1.2, SPOTS[i][1]);
      scene.add(g);
      groups.push(g);
    }
    counter = document.createElement('div');
    counter.id = 'shells-counter';
    counter.style.cssText = 'right:18px;top:144px;font-size:13px;font-weight:700;color:#ffd166;text-align:right;letter-spacing:.1em';
    document.getElementById('hud').appendChild(counter);
    setCounter();
    state.shells = { got: [], total: TOTAL, list: SPOTS };
  }

  function collect(i) {
    got.add(i);
    groups[i].visible = false;
    const p = state.player;
    p.cash += 100;
    p.rep += 10;
    state.shells.got = [...got];
    setCounter();
    ctx.showToast('Sun Shell ' + got.size + '/' + TOTAL + ' — +$100 + 10 REP');
    emit('shell', { n: got.size });
  }

  function update(dt) {
    // Adopt the saved set once save.js has landed (it registers after us).
    if (!adopted && state.saveData) {
      adopted = true;
      const saved = state.saveData.shells;
      if (Array.isArray(saved)) {
        for (const i of saved) {
          if (Number.isInteger(i) && i >= 0 && i < TOTAL) {
            got.add(i);
            groups[i].visible = false;
          }
        }
        state.shells.got = [...got];
        setCounter();
      }
    }
    for (let i = 0; i < TOTAL; i += 1) {
      if (got.has(i)) continue;
      const g = groups[i];
      g.rotation.y += dt * 2;
      g.position.y = 1.2 + Math.sin(state.time * 2 + i) * 0.2;
    }
    if (state.screen !== 'playing') return;
    const p = state.player;
    for (let i = 0; i < TOTAL; i += 1) {
      if (got.has(i)) continue;
      if (dist2(p.x, p.z, SPOTS[i][0], SPOTS[i][1]) < PICKUP_R) collect(i);
    }
  }

  init();
  return { name: 'collectibles', update, init };
}

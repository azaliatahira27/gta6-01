// Missions: six story jobs with staged objectives and dialogue. Writes
// state.mission + state.dialogue every update.
import * as THREE from 'three';
import { MISSIONS } from './config.js';
import { dist2 } from './utils.js';

const R_REACH = 8, R_TALK = 6, R_PICKUP = 6, DLG_SECS = 6;
// [speaker, line] per stage start; done = completion line.
const DATA = [
  { id: 'm1', cash: 500, rep: 50, stages: [
    { type: 'reach', target: { x: -42, z: 96 }, text: 'Borrow the Marlin parked on 6th Street.',
      line: ['Rosa', 'Take the blue Marlin on 6th. Keys are in it. Don\'t scratch it — much.'] },
    { type: 'pickup', target: { x: -96, z: 192 }, text: 'Pick up Rosa\'s fare at the Coral Strip corner. (Press E)',
      line: ['Rosa', 'Fare\'s waiting where the Strip meets the sea. Be charming.'] },
    { type: 'deliver', target: { x: -48, z: -96 }, text: 'Drop the fare at the Marina — keep the car above 30%.',
      line: ['Rosa', 'Marina drop, nice and smooth. They tip if the paint survives.'] },
    { type: 'reach', target: { x: -48, z: 144 }, text: 'Report back to Rosa\'s garage in Old Town.',
      line: ['Rosa', 'Back to the garage. First fare done, Mara — you\'re hired.'] },
  ], done: ['Rosa', 'Clean run. Five hundred, and the crew knows your name now.'] },
  { id: 'm2', cash: 1200, rep: 100, stages: [
    { type: 'reach', target: { x: -150, z: -102 }, text: 'Steal the Tiburon X parked by the marina.',
      line: ['Deke', 'Tiburon X. Marina lot. Bring it breathing.'] },
    { type: 'deliver', target: { x: 48, z: -144 }, text: 'Bring the Tiburon to Deke at the docks.',
      line: ['Deke', 'Docks. Don\'t let the ABPD admire it first.'] },
    { type: 'lose', text: 'Lose the heat — get your wanted level to zero.',
      line: ['Deke', 'Heat\'s on you. Vanish, then come see me.'] },
  ], done: ['Deke', 'She purrs. Take this K9 — the next job gets loud.'] },
  { id: 'm3', cash: 2000, rep: 150, stages: [
    { type: 'reach', target: { x: -96, z: -192 }, text: 'Reach the marina gatehouse.',
      line: ['Ines', 'Gatehouse camera loops in thirty seconds. Walk like you belong.'] },
    { type: 'pickup', target: { x: -48, z: -192 }, text: 'Grab the data drive from the locker. (Press E)',
      line: ['Ines', 'Drive\'s in the locker. It\'s not stealing if they never notice.'] },
    { type: 'reach', target: { x: 0, z: -48 }, timer: 120, text: 'Get the drive to the Downtown dead drop — 2 minutes.',
      line: ['Ines', 'Two minutes before the loop ends. Run.'] },
    { type: 'reach', target: { x: -48, z: -144 }, text: 'Get back to Ines at the marina.',
      line: ['Ines', 'You\'re late. You\'re also alive. I\'ll take it.'] },
  ], done: ['Ines', 'Decrypted. The ABPD\'s whole shift roster. Priceless — well, two grand.'] },
  { id: 'm4', cash: 3000, rep: 250, stages: [
    { type: 'reach', target: { x: 96, z: -48 }, text: 'Reach the Downtown tower garage.',
      line: ['Rosa', 'Tower garage, Downtown. Voss\'s boys are watching it — of course they are.'] },
    { type: 'survive', secs: 30, text: 'Survive the heat for 30 seconds.',
      line: ['Rosa', 'Hold them off, Mara. Thirty seconds and we\'re ghosts.'] },
    { type: 'lose', text: 'Lose the heat.',
      line: ['Rosa', 'Now disappear. The city forgets fast if you let it.'] },
    { type: 'reach', target: { x: -48, z: 144 }, text: 'Get back to Rosa\'s garage.',
      line: ['Rosa', 'Garage. Now. Before they change their minds.'] },
  ], done: ['Rosa', 'You held Downtown. Take the AR-77 — you\'ve earned the loud option.'] },
  { id: 'm5', cash: 4000, rep: 300, stages: [
    { type: 'reach', target: { x: -168, z: -48 }, text: 'Meet Voss\'s men on the beach road.',
      line: ['Captain Voss', 'Miss Solis. One delivery, no questions. The ABPD appreciates cooperation.'] },
    { type: 'survive', secs: 20, text: 'It\'s a sting! Survive 20 seconds.',
      line: ['Captain Voss', 'Cuff her. She walked right into it.'] },
    { type: 'reach', target: { x: -48, z: 120 }, text: 'Escape to the safehouse in Old Town.',
      line: ['Rosa', 'Voss set you up? Figures. Safehouse, Mara — I\'ve got the kettle on.'] },
  ], done: ['Rosa', 'You flipped Voss\'s own sting on him. The whole city\'s talking about it.'] },
  { id: 'm6', cash: 5000, rep: 400, stages: [
    { type: 'pickup', target: { x: 192, z: -48 }, text: 'Grab the vault codes from the Heights lookout. (Press E)',
      line: ['Deke', 'Codes are at the lookout. Last quiet moment before the storm.'] },
    { type: 'reach', target: { x: 48, z: 0 }, timer: 150, text: 'Hit the Downtown vault — 2:30 on the clock.',
      line: ['Deke', 'Vault window\'s open. Two and a half minutes, Mara.'] },
    { type: 'deliver', target: { x: 192, z: 192 }, text: 'Getaway to the Heights lookout — keep the car above 30%.',
      line: ['Deke', 'Drive like the sunset\'s chasing you. It is.'] },
    { type: 'reach', target: { x: 192, z: 96 }, text: 'Regroup at the lookout.',
      line: ['Deke', 'Home stretch. The crew\'s waiting.'] },
  ], done: ['Deke', 'Legend of Azura Bay. They\'ll name a street after this one.'] },
];
const BY_ID = new Map(DATA.map((m) => [m.id, m]));
const fmtTime = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');

export function createMissions(ctx) {
  let ready = false;
  let beacon, diamond;
  let activeId = null, stageIdx = 0, stageT = 0, surviveT = 0, timerLeft = 0, stageCar = null;
  let doneList = [], dlgT = 0, prevE = false;

  function init(c) {
    if (c) ctx = c;
    if (ready) return;
    ready = true;
    beacon = new THREE.Group();
    diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.2),
      new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffaa00, emissiveIntensity: 1.6 }),
    );
    diamond.position.y = 3;
    beacon.add(diamond);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 40, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pillar.position.y = 20;
    beacon.add(pillar);
    beacon.visible = false;
    ctx.scene.add(beacon);
  }

  const meta = (id) => MISSIONS.find((m) => m.id === id) || { name: id, contact: '', district: '' };
  const nextId = () => MISSIONS.map((m) => m.id).find((id) => !doneList.includes(id)) || null;
  const startOf = (id) => ctx.city.getSpawnPoints().missions[id];

  function say(pair) {
    if (!pair) return;
    ctx.state.dialogue = { speaker: pair[0], line: pair[1] };
    dlgT = DLG_SECS;
  }

  function beginStage() {
    const st = BY_ID.get(activeId).stages[stageIdx];
    stageT = 0;
    surviveT = 0;
    timerLeft = st.timer ?? 0;
    stageCar = ctx.state.player.inCar; // wrecked-car fail check watches this car
    say(st.line);
  }

  function startMission(id) {
    activeId = id;
    stageIdx = 0;
    ctx.emit('missionStart', { id });
    ctx.showToast(meta(id).name + ' — ' + meta(id).contact);
    beginStage();
  }

  // Opening hook: a fresh run starts the first job at once — banner, beacon
  // and briefing live from second 0 instead of waiting for the walk to Rosa.
  function startNext() {
    if (activeId || doneList.length) return;
    const id = nextId();
    if (id) startMission(id);
  }

  function failMission(reason) {
    const id = activeId;
    activeId = null;
    ctx.emit('missionFail', { id });
    ctx.showToast('Mission failed — ' + reason);
    say([meta(id).contact || 'Rosa', 'It went sideways. Shake it off — the job\'s still there when you\'re ready.']);
  }

  function completeMission() {
    const m = BY_ID.get(activeId);
    const p = ctx.state.player;
    p.cash += m.cash;
    p.rep += m.rep;
    ctx.state.stats.missionsDone += 1;
    if (activeId === 'm2') p.ammo.smg = (p.ammo.smg ?? 0) + 120;
    if (activeId === 'm4') p.ammo.rifle = (p.ammo.rifle ?? 0) + 90;
    if (!doneList.includes(activeId)) doneList.push(activeId);
    if (ctx.state.saveData) ctx.state.saveData.missionsDone = [...doneList];
    ctx.emit('missionDone', { id: activeId, cash: m.cash, rep: m.rep });
    ctx.showToast('Mission complete — $' + m.cash.toLocaleString('en-US') + ' + ' + m.rep + ' REP');
    say(m.done);
    activeId = null;
  }

  function advance() {
    const m = BY_ID.get(activeId);
    stageIdx += 1;
    if (stageIdx >= m.stages.length) {
      completeMission();
      return;
    }
    ctx.emit('missionStage', { id: activeId, stage: stageIdx + 1 });
    beginStage();
  }

  function stageText(st) {
    let text = st.text;
    if (st.timer) text += ' — ' + fmtTime(Math.max(0, timerLeft)) + ' left';
    if (st.type === 'survive') text += ' — ' + Math.max(0, Math.ceil(st.secs - surviveT)) + 's';
    if (st.type === 'deliver') {
      const p = ctx.state.player;
      const near = st.target && dist2(p.x, p.z, st.target.x, st.target.z) < R_REACH;
      if (near && (!p.inCar || p.inCar.condition <= 30)) {
        text += ' (You need a car above 30% condition.)';
      }
    }
    return text;
  }

  function update(dt, c) {
    if (c) ctx = c;
    if (!ready) init();
    const s = ctx.state;
    const p = s.player;
    if (dlgT > 0) {
      dlgT -= dt;
      if (dlgT <= 0) s.dialogue = null;
    }
    // Adopt a mission staged externally (shots.js sets state.mission directly).
    if (!activeId && s.mission.id && BY_ID.has(s.mission.id)) {
      activeId = s.mission.id;
      const m = BY_ID.get(activeId);
      stageIdx = Math.min(Math.max((s.mission.stage || 1) - 1, 0), m.stages.length - 1);
      beginStage();
    }
    const eDown = ctx.keys.has('KeyE');
    const ePressed = eDown && !prevE;
    prevE = eDown;
    let target = null;

    if (activeId) {
      const m = BY_ID.get(activeId);
      const st = m.stages[stageIdx];
      stageT += dt;
      if (st.target) target = st.target;
      // Fail: timer out, getaway car wrecked, or busted (police missionFail).
      if (st.timer && (timerLeft -= dt) <= 0) failMission('Out of time.');
      else if (st.type === 'deliver' && stageCar && stageCar.wrecked) failMission('Your getaway car is wrecked.');
      else if (s.events.some((ev) => ev.type === 'missionFail')) failMission('Busted by the ABPD.');
      if (activeId) {
        const d = st.target ? dist2(p.x, p.z, st.target.x, st.target.z) : Infinity;
        if (st.type === 'reach' && d < R_REACH) advance();
        else if (st.type === 'talk' && d < R_TALK) advance();
        else if (st.type === 'pickup' && d < R_PICKUP && ePressed) advance();
        else if (st.type === 'lose' && p.wanted === 0) advance();
        else if (st.type === 'deliver' && d < R_REACH && p.inCar && p.inCar.condition > 30) advance();
        else if (st.type === 'survive') {
          // Counts only while the heat is on; a quiet night still ends it.
          if (p.wanted >= 2) surviveT += dt;
          if (surviveT >= st.secs || stageT >= st.secs + 45) advance();
        }
      }
    } else {
      // Free roam: refresh the completed list (save.js may land late).
      const saved = s.saveData?.missionsDone;
      if (Array.isArray(saved)) doneList = [...saved];
      const id = nextId();
      if (id) {
        const sp = startOf(id);
        target = { x: sp.x, z: sp.z };
        if (s.screen === 'playing' && ePressed && dist2(p.x, p.z, sp.x, sp.z) < 4) startMission(id);
      }
    }

    // Beacon follows the current objective; gone once every job is done.
    if (beacon) {
      beacon.visible = !!target;
      if (target) {
        beacon.position.set(target.x, 0, target.z);
        diamond.rotation.y += dt * 1.5;
        diamond.position.y = 3 + Math.sin(s.time * 2) * 0.3;
      }
    }

    // Publish state.mission every update (stage is 1-based for the HUD).
    if (activeId) {
      const m = BY_ID.get(activeId);
      s.mission = { id: activeId, stage: stageIdx + 1, stageTotal: m.stages.length,
        title: meta(activeId).name, text: stageText(m.stages[stageIdx]), target };
    } else {
      const id = nextId();
      if (id) {
        const mm = meta(id);
        s.mission = { id: null, stage: 0, stageTotal: 0, title: 'Free Roam',
          text: 'Next: ' + mm.name + ' — meet ' + mm.contact + ' in ' + mm.district + '. Follow the gold marker.',
          target };
      } else {
        s.mission = { id: null, stage: 0, stageTotal: 0, title: 'Legend of Azura Bay',
          text: 'Azura Bay is yours, Mara. Free roam — the city remembers.', target: null };
      }
    }
  }

  return { name: 'missions', update, init, startNext };
}

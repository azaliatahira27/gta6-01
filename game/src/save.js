// Azura Bay extended save — v2 alongside main.js's v1 (SAVE_KEY).
// v1 owns cash/rep/health/position; v2 adds garage, mission progress and ammo,
// so a returning player keeps their cars and their place in the story.
// All localStorage access is guarded: private mode just means no persistence.
import { SAVE_KEY } from './config.js';

const KEY2 = 'azura-bay.save.v2';
const AUTOSAVE_EVERY = 30; // seconds of play
const SAVE_THROTTLE = 5;   // seconds between event-triggered saves
const GARAGE_MAX = 4;
const AMMO_KEYS = ['pistol', 'smg', 'rifle'];

export function createSave(ctx) {
  let garage = [];
  let missionsDone = [];
  let timer = 0;
  let lastSaveAt = -SAVE_THROTTLE;
  let booted = false;

  const st = () => ctx.state;

  function read(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* no storage */ }
  }
  function clear(key) {
    try { window.localStorage.removeItem(key); } catch { /* no storage */ }
  }

  function snapshot() {
    const s = st();
    const weapons = {};
    for (const k of AMMO_KEYS) {
      const n = s.player.ammo?.[k];
      if (typeof n === 'number') weapons[k] = n;
    }
    return {
      v: 2,
      garage: [...garage],
      missionsDone: [...missionsDone],
      weapons,
      currentMission: s.mission.id ?? null,
      rep: s.player.rep,
      cash: s.player.cash,
      shells: [...(s.shells?.got ?? [])],
    };
  }

  function saveNow() {
    write(KEY2, snapshot());
    lastSaveAt = st().time;
  }

  function init(c) {
    if (c) ctx = c;
    if (booted) return;
    booted = true;
    const v2 = read(KEY2);
    if (!v2) return;
    // v1 absent but v2 present: the player restarted, so the old progress is stale.
    if (!read(SAVE_KEY)) { clear(KEY2); return; }
    if (Array.isArray(v2.garage)) garage = v2.garage.filter((id) => typeof id === 'string').slice(0, GARAGE_MAX);
    if (Array.isArray(v2.missionsDone)) missionsDone = v2.missionsDone.filter((id) => typeof id === 'string');
    const s = st();
    s.saveData = { garage: [...garage], missionsDone: [...missionsDone], weapons: v2.weapons || {},
      shells: Array.isArray(v2.shells) ? v2.shells.filter((n) => Number.isInteger(n)) : [] };
    // Seed ammo from v2 only when it has weapons; otherwise combat.js keeps its default.
    if (v2.weapons && typeof v2.weapons === 'object') {
      for (const k of AMMO_KEYS) {
        if (typeof v2.weapons[k] === 'number') s.player.ammo[k] = v2.weapons[k];
      }
    }
  }

  function update(dt, c) {
    if (c) ctx = c;
    init();
    const s = st();
    let dirty = false;
    for (const ev of s.events) {
      if (ev.type === 'missionDone' && ev.data?.id && !missionsDone.includes(ev.data.id)) {
        missionsDone.push(ev.data.id);
        if (s.saveData) s.saveData.missionsDone = [...missionsDone];
        dirty = true;
      } else if (ev.type === 'shell') {
        dirty = true;
      } else if (ev.type === 'carStolen') {
        const car = ev.data?.car;
        const id = typeof car === 'string' ? car : car?.id;
        if (id && !garage.includes(id)) {
          garage.push(id);
          if (garage.length > GARAGE_MAX) garage.shift();
          if (s.saveData) s.saveData.garage = [...garage];
          dirty = true;
        }
      }
    }
    // Event saves are throttled to one per 5 s; the 30 s autosave catches the rest.
    if (dirty && s.time - lastSaveAt >= SAVE_THROTTLE) saveNow();
    if (s.screen === 'playing') {
      timer += dt;
      if (timer >= AUTOSAVE_EVERY) { timer = 0; saveNow(); }
    }
  }

  return { name: 'save', update, init };
}

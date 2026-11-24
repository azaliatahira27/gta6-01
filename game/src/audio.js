// Azura Bay audio — procedural radio + SFX, WebAudio only, no audio files.
// Everything guards a missing AudioContext (headless): all calls no-op, never throw.
// Radio follows state.radio (main.js owns the Q/M keys); SFX read state.events
// in update, before main.js drains the queue.
import { RADIO } from './config.js';

// Minor-progression roots, semitones above the station root (i–VI–III–VII).
const PROG = [0, 8, 3, 10];
const CHORD = [0, 3, 7, 12]; // minor triad + octave, for pads and arps

export function createAudio(ctx) {
  let ac = null;          // AudioContext, created lazily on first gesture
  let master = null;      // master gain (0 when muted, else 0.8)
  let musicBus = null;    // music gain (0.15)
  let sfxBus = null;      // sfx gain (0.3)
  let noiseBuf = null;
  let schedTimer = 0;     // radio lookahead timer
  let nextStep = 0;       // time of the next scheduled eighth note
  let step = 0;           // eighth-note counter within the loop
  let curStation = -1;    // station index the scheduler is playing
  let lastWanted = 0;
  let engine = null;      // { osc, gain } while driving
  let siren = null;       // { osc, gain } while police are near
  let sirenFlip = 0;      // next siren tone swap time
  let sirenHi = false;
  let booted = false;

  const st = () => ctx.state;
  const live = () => ac && ac.state === 'running';

  function ensure() {
    if (ac) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.8;
      master.connect(ac.destination);
      musicBus = ac.createGain();
      musicBus.gain.value = 0.15;
      musicBus.connect(master);
      sfxBus = ac.createGain();
      sfxBus.gain.value = 0.3;
      sfxBus.connect(master);
      const len = Math.floor(ac.sampleRate * 0.5);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { ac = null; return false; }
    return true;
  }

  function resume() {
    if (!ensure()) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    if (!schedTimer) schedTimer = window.setInterval(schedule, 100);
  }

  // One short tone. `slide` glides the frequency; `at` offsets the start.
  function tone(freq, type, dur, vol, dest, slide, at) {
    if (!live()) return;
    try {
      const t0 = ac.currentTime + (at || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g);
      g.connect(dest || sfxBus);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch { /* keep the game running if a node fails */ }
  }

  // Filtered noise burst, e.g. gunshots and thuds.
  function noise(dur, vol, freq, q, type) {
    if (!live()) return;
    try {
      const t0 = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = type || 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q || 1;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(sfxBus);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch { /* ignore */ }
  }

  const semis = (root, n) => root * Math.pow(2, n / 12);

  // Schedule eighth notes up to 200 ms ahead. Bar = 8 eighths: bass every
  // eighth, pad on bar start, sparse arp on steps 0/3/6.
  function schedule() {
    if (!live()) return;
    const s = st();
    const station = RADIO[s.radio.station] || RADIO[0];
    if (s.radio.station !== curStation) { curStation = s.radio.station; step = 0; nextStep = ac.currentTime + 0.05; }
    const eighth = 60 / station.tempo / 2;
    if (nextStep < ac.currentTime) nextStep = ac.currentTime + 0.05;
    while (nextStep < ac.currentTime + 0.2) {
      const bar = Math.floor(step / 8) % PROG.length;
      const root = semis(station.root, PROG[bar]);
      const t0 = nextStep - ac.currentTime;
      tone(root / 2, 'sine', eighth * 0.9, 0.9, musicBus, 0, t0);
      if (step % 8 === 0) {
        for (const n of [0, 3, 7]) {
          tone(semis(root, n), 'triangle', eighth * 8, 0.16, musicBus, 0, t0);
          tone(semis(root, n) * 1.003, 'triangle', eighth * 8, 0.12, musicBus, 0, t0);
        }
      }
      if (step % 8 === 0 || step % 8 === 3 || step % 8 === 6) {
        const arp = CHORD[(step * 2 + bar) % CHORD.length];
        tone(semis(root * 2, arp), 'square', eighth * 0.5, 0.08, musicBus, 0, t0);
      }
      nextStep += eighth;
      step += 1;
    }
  }

  function sfx(ev) {
    const d = ev.data || {};
    if (ev.type === 'shot') {
      if (d.weapon === 'fists') noise(0.12, 0.5, 180, 1, 'lowpass');
      else noise(0.08, 0.9, 1800, 0.8);
    } else if (ev.type === 'hit') {
      if (d.target === 'car') noise(0.25, 0.8, 120, 1, 'lowpass');
      else tone(1400, 'square', 0.05, 0.25);
    } else if (ev.type === 'carStolen') {
      tone(90, 'sawtooth', 0.35, 0.4, sfxBus, 55); // ignition crank
      tone(70, 'sawtooth', 0.9, 0.5, sfxBus, 160, 0.35); // engine catches
    } else if (ev.type === 'missionDone') {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 'sine', 0.22, 0.5, sfxBus, 0, i * 0.12));
    } else if (ev.type === 'missionFail') {
      tone(392, 'sine', 0.3, 0.5);
      tone(262, 'sine', 0.45, 0.5, sfxBus, 0, 0.28);
    } else if (ev.type === 'wanted' && d.level > lastWanted) {
      tone(880, 'sine', 0.14, 0.4);
      tone(1175, 'sine', 0.2, 0.4, sfxBus, 0, 0.15);
    }
    if (ev.type === 'wanted' && typeof d.level === 'number') lastWanted = d.level;
  }

  // Continuous engine hum: sawtooth through a lowpass, pitch tracks speed.
  function engineHum() {
    const p = st().player;
    const driving = !p.onFoot && p.inCar;
    if (!live() || !driving) {
      if (engine) { try { engine.osc.stop(); } catch { /* already stopped */ } engine = null; }
      return;
    }
    if (!engine) {
      try {
        const o = ac.createOscillator();
        const g = ac.createGain();
        const f = ac.createBiquadFilter();
        o.type = 'sawtooth';
        f.type = 'lowpass';
        f.frequency.value = 420;
        g.gain.value = 0.12;
        o.connect(f);
        f.connect(g);
        g.connect(sfxBus);
        o.start();
        engine = { osc: o, gain: g };
      } catch { engine = null; return; }
    }
    engine.osc.frequency.value = 55 + Math.abs(p.speed) * 3.2;
  }

  // Police siren: two-tone 700/950 Hz alternation, quiet, panned slightly left.
  function policeSiren() {
    const units = st().police?.units ?? [];
    if (!live() || units.length === 0) {
      if (siren) { try { siren.osc.stop(); } catch { /* already stopped */ } siren = null; }
      return;
    }
    if (!siren) {
      try {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = 700;
        g.gain.value = 0.05;
        o.connect(g);
        if (ac.createStereoPanner) {
          const pan = ac.createStereoPanner();
          pan.pan.value = -0.2;
          g.connect(pan);
          pan.connect(sfxBus);
        } else g.connect(sfxBus);
        o.start();
        siren = { osc: o, gain: g };
        sirenFlip = ac.currentTime + 0.45;
      } catch { siren = null; return; }
    }
    if (ac.currentTime >= sirenFlip) {
      sirenHi = !sirenHi;
      siren.osc.frequency.value = sirenHi ? 950 : 700;
      sirenFlip = ac.currentTime + 0.45;
    }
  }

  function init() {
    if (booted) return;
    booted = true;
    // Resume on the first gesture: gameStart, or any key/click we observe.
    const once = () => resume();
    window.addEventListener('keydown', once, { once: true });
    window.addEventListener('pointerdown', once, { once: true });
  }

  function update(dt, c) {
    if (c) ctx = c;
    init();
    const s = st();
    for (const ev of s.events) {
      if (ev.type === 'gameStart') resume();
      sfx(ev);
    }
    if (master) master.gain.value = s.radio.muted ? 0 : 0.8;
    engineHum();
    policeSiren();
  }

  return { name: 'audio', update, init };
}

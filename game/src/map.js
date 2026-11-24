// City map — M opens, M/ESC closes, game pauses. Canvas map + mission/stats/legend.
import { DISTRICTS, MISSIONS } from './config.js';
import { worldToMap } from './city.js';

const S = 440; // map canvas px (world is 480 units, ground canvas 1024)
const PAY = [500, 1200, 2000, 3000, 4000, 5000];
const POI = [
  ['G', '#7dff9a', -48, 144, 'Garage'],
  ['R', '#c99aff', 96, -144, 'Respray'],
  ['H', '#ff5a5a', 48, -48, 'Hospital'],
  ['P', '#4fc3f7', 0, -48, 'Police'],
];

export function createMap(ctx) {
  const { state, city } = ctx;
  let open = false;
  let root, mctx, missionEl, statsEl;

  function xy(x, z) {
    const m = worldToMap(x, z);
    return [m.px * (S / 1024), m.py * (S / 1024)];
  }
  function dot(x, z, color, r) {
    const [px, py] = xy(x, z);
    mctx.fillStyle = color;
    mctx.beginPath();
    mctx.arc(px, py, r, 0, Math.PI * 2);
    mctx.fill();
  }

  function draw() {
    const c = mctx;
    c.clearRect(0, 0, S, S);
    c.drawImage(city.groundCanvas, 0, 0, S, S);
    c.textAlign = 'center';
    for (const d of DISTRICTS) {
      const [x0, y0] = xy(d.minX, d.minZ);
      const [x1, y1] = xy(d.maxX, d.maxZ);
      c.font = '800 13px system-ui,sans-serif';
      c.fillStyle = '#fff';
      c.fillText(d.name, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    const got = new Set(state.shells?.got ?? []);
    const list = state.shells?.list ?? [];
    list.forEach(([x, z], i) => dot(x, z, got.has(i) ? 'rgba(160,160,160,.7)' : '#ffd166', got.has(i) ? 2.5 : 3.5));
    for (const [letter, color, x, z] of POI) {
      dot(x, z, color, 8);
      const [px, py] = xy(x, z);
      c.fillStyle = '#1a1a2e';
      c.font = '800 11px system-ui,sans-serif';
      c.fillText(letter, px, py + 4);
    }
    const t = state.mission.target;
    if (t) {
      const [px, py] = xy(t.x, t.z);
      c.fillStyle = '#ffd166';
      c.strokeStyle = '#1a1a2e';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(px, py - 9);
      c.lineTo(px + 7, py);
      c.lineTo(px, py + 9);
      c.lineTo(px - 7, py);
      c.closePath();
      c.fill();
      c.stroke();
    }
    const p = state.player;
    const [px, py] = xy(p.x, p.z);
    c.save();
    c.translate(px, py);
    c.rotate(Math.PI - p.heading);
    c.fillStyle = '#fff';
    c.strokeStyle = '#1a1a2e';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -10);
    c.lineTo(7, 8);
    c.lineTo(-7, 8);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    c.fillStyle = '#ffd166';
    c.font = '800 13px system-ui,sans-serif';
    c.fillText('N', S / 2, 16);
  }

  function render() {
    draw();
    const done = state.saveData?.missionsDone ?? [];
    const next = MISSIONS.find((m) => !done.includes(m.id))?.id;
    let mh = '<div style="font-size:13px;letter-spacing:.12em;color:#ffd166;font-weight:800;margin-bottom:6px">MISSIONS</div>';
    MISSIONS.forEach((m, i) => {
      const st = done.includes(m.id) ? ['DONE', '#7dff9a']
        : state.mission.id === m.id ? ['ACTIVE', '#ffd166']
        : m.id === next ? ['NEXT', '#9ad1ff'] : ['—', '#888'];
      mh += '<div style="display:flex;justify-content:space-between;font-size:14px;line-height:1.9">'
        + '<span>' + m.name + '</span><span style="color:#7dff9a">$' + PAY[i].toLocaleString('en-US')
        + '</span><span style="color:' + st[1] + ';font-weight:800;font-size:12px">' + st[0] + '</span></div>';
    });
    missionEl.innerHTML = mh;
    const shells = state.shells?.got.length ?? 0;
    const st = state.stats;
    const pct = Math.round((done.length / 6) * 70 + (shells / 24) * 30);
    const row = (k, v) => '<div style="display:flex;justify-content:space-between;font-size:14px;line-height:1.9"><span>'
      + k + '</span><span style="font-weight:800">' + v + '</span></div>';
    statsEl.innerHTML = '<div style="font-size:13px;letter-spacing:.12em;color:#ffd166;font-weight:800;margin:14px 0 6px">STATS</div>'
      + row('Cash', '$' + state.player.cash.toLocaleString('en-US'))
      + row('Missions done', done.length + '/6')
      + row('Cars stolen', st.carsStolen ?? 0)
      + row('Cops lost', st.copsLost ?? 0)
      + row('Enemies down', st.enemiesDown ?? 0)
      + row('Sun Shells', shells + '/24')
      + row('Completion', pct + '%');
  }

  function openMap() {
    open = true;
    state.mapOpen = true;
    state.screen = 'paused';
    render();
    root.classList.remove('hidden');
  }
  function closeMap() {
    open = false;
    state.mapOpen = false;
    root.classList.add('hidden');
    if (state.screen === 'paused') state.screen = 'playing';
  }

  function init() {
    root = document.createElement('div');
    root.id = 'map-screen';
    root.className = 'overlay hidden';
    root.style.cssText = 'background:linear-gradient(180deg,rgba(10,6,16,.88),rgba(30,10,26,.9))';
    root.innerHTML = '<div style="font-size:26px;font-weight:900;letter-spacing:.14em;color:#ffd166;margin-bottom:10px">AZURA BAY — CITY MAP</div>'
      + '<div style="display:flex;gap:18px;align-items:flex-start">'
      + '<canvas id="map-canvas" width="' + S + '" height="' + S + '" style="border:2px solid rgba(255,255,255,.35);border-radius:12px"></canvas>'
      + '<div style="width:308px;text-align:left"><div id="map-missions"></div><div id="map-stats"></div>'
      + '<div style="font-size:13px;letter-spacing:.12em;color:#ffd166;font-weight:800;margin:12px 0 6px">LEGEND</div>'
      + '<div style="font-size:13px;line-height:2">' + POI.map(([, c, , , n]) => '<span style="color:' + c + '">●</span> ' + n + ' &nbsp;').join('')
      + '<span style="color:#ffd166">●</span> Sun Shell &nbsp;<span style="color:#ffd166">◆</span> Mission &nbsp;<span style="color:#fff">▲</span> You</div></div></div>'
      + '<div style="font-size:13px;color:#c9b8cc;margin-top:12px">M or ESC — close &nbsp;·&nbsp; Game paused</div>';
    document.body.appendChild(root);
    mctx = root.querySelector('#map-canvas').getContext('2d');
    missionEl = root.querySelector('#map-missions');
    statsEl = root.querySelector('#map-stats');
    // M is the map now (mute moved to N) — fix the controls line.
    const controls = document.querySelector('#start-screen .controls');
    if (controls) controls.textContent = controls.textContent.replace('M — mute', 'M — map · N — mute');
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') {
        if (open) closeMap();
        else if (state.screen === 'playing') openMap();
      } else if (e.code === 'Escape' && open) {
        closeMap();
      }
    });
    state.mapOpen = false;
  }

  function update() { /* paused while open; render happens on open only */ }

  init();
  return { name: 'map', update, init };
}

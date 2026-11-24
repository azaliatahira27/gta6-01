// Azura Bay HUD + minimap — renders every HUD panel from state each step.
// Values are cached: the DOM is touched only when a value actually changes.
import { RADIO, REP_RANKS, WEAPONS } from './config.js';
import { formatCash, formatClock, repRankFor, wantedStars } from './utils.js';
import { worldToMap } from './city.js';

const S = 186; // minimap canvas size (px)
const MAP_VIEW = 120; // world units across the minimap

export function createHud(ctx) {
  const { state, city } = ctx;
  const $ = (id) => document.getElementById(id);
  const els = {
    hud: $('hud'), minimap: $('minimap-canvas'),
    district: $('district-label'), missionPanel: $('mission-panel'),
    policePanel: $('police-panel'), policeText: $('police-text'),
    cash: $('cash'), stars: $('stars'), clock: $('clock'), rep: $('rep'),
    healthFill: $('health-fill'), armorFill: $('armor-fill'),
    weaponSlots: $('weapon-slots'), speedo: $('speedo'), carCondition: $('car-condition'),
    radio: $('radio'), dialogue: $('dialogue-box'), banner: $('banner'),
  };
  const mctx = els.minimap.getContext('2d');
  const cache = {};

  function setText(el, key, value) {
    if (cache[key] !== value) {
      cache[key] = value;
      el.textContent = value;
    }
  }
  function setHtml(el, key, html) {
    if (cache[key] !== html) {
      cache[key] = html;
      el.innerHTML = html;
    }
  }
  function setWidth(el, key, pct) {
    const v = Math.round(pct) + '%';
    if (cache[key] !== v) {
      cache[key] = v;
      el.style.width = v;
    }
  }
  function setShown(el, key, show) {
    if (cache[key] !== show) {
      cache[key] = show;
      el.style.display = show ? '' : 'none';
    }
  }

  function repHtml(rep) {
    const rank = repRankFor(rep, REP_RANKS);
    const idx = REP_RANKS.findIndex((r) => r.rank === rank);
    const next = REP_RANKS[idx + 1];
    if (!next) return rank + ' · MAX';
    const prev = REP_RANKS[idx].at;
    const pct = Math.round(((rep - prev) / (next.at - prev)) * 100);
    return rank + ' · ' + rep + '/' + next.at
      + '<div style="height:4px;background:rgba(255,255,255,.18);border-radius:2px;margin-top:3px">'
      + '<div style="height:100%;width:' + pct + '%;background:#9ad1ff;border-radius:2px"></div></div>';
  }

  function weaponHtml(p) {
    return WEAPONS.filter((w) => w.id === 'fists' || (p.ammo[w.id] ?? 0) > 0)
      .map((w) => {
        const ammo = w.ammo === Infinity ? '∞' : (p.ammo[w.id] ?? 0);
        return '<div class="' + (w.id === p.weapon ? 'active' : '') + '">' + w.name + ' · ' + ammo + '</div>';
      }).join('');
  }

  function missionHtml(m) {
    let html = '<div class="mission-title">' + m.title + '</div><div>' + m.text + '</div>';
    if (m.stageTotal > 0) {
      const pct = Math.round((m.stage / m.stageTotal) * 100);
      html += '<div style="height:5px;background:rgba(255,255,255,.18);border-radius:3px;margin-top:6px">'
        + '<div style="height:100%;width:' + pct + '%;background:#ffd166;border-radius:3px"></div></div>'
        + '<div style="font-size:11px;color:#ffd9a0;margin-top:3px">STAGE ' + m.stage + '/' + m.stageTotal + '</div>';
    }
    return html;
  }

  function drawMinimap(p) {
    const c = mctx;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    c.clip();
    const m = worldToMap(p.x, p.z);
    const src = (MAP_VIEW / 480) * 1024;
    c.drawImage(city.groundCanvas, m.px - src / 2, m.py - src / 2, src, src, 0, 0, S, S);
    const scale = S / MAP_VIEW;
    const toMap = (x, z) => ({ x: S / 2 + (x - p.x) * scale, y: S / 2 + (z - p.z) * scale });
    const inView = (pt) => Math.hypot(pt.x - S / 2, pt.y - S / 2) < S / 2 - 4;
    // Mission marker: gold diamond.
    const target = state.mission.target;
    if (target) {
      const pt = toMap(target.x, target.z);
      if (inView(pt)) {
        c.fillStyle = '#ffd166';
        c.strokeStyle = '#1a1a2e';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(pt.x, pt.y - 7);
        c.lineTo(pt.x + 5, pt.y);
        c.lineTo(pt.x, pt.y + 7);
        c.lineTo(pt.x - 5, pt.y);
        c.closePath();
        c.fill();
        c.stroke();
      }
    }
    // Pay 'n' Spray: teal square.
    const spray = state.police?.spray;
    if (spray) {
      const pt = toMap(spray.x, spray.z);
      if (inView(pt)) {
        c.fillStyle = '#2fd6c9';
        c.fillRect(pt.x - 4, pt.y - 4, 8, 8);
      }
    }
    // Police blips: red/blue dots.
    const police = state.police ?? { units: [], heli: false };
    for (const unit of police.units) {
      const pt = toMap(unit.x, unit.z);
      if (!inView(pt)) continue;
      c.fillStyle = '#ff4040';
      c.beginPath();
      c.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#4090ff';
      c.beginPath();
      c.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
      c.fill();
    }
    // Player arrow, centre.
    c.translate(S / 2, S / 2);
    c.rotate(Math.PI - p.heading);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#1a1a2e';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -8);
    c.lineTo(6, 7);
    c.lineTo(-6, 7);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    if (p.wanted > 0) {
      c.strokeStyle = 'rgba(255,64,64,0.9)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = '#ffd166';
    c.font = 'bold 11px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('N', S / 2, 14);
  }

  function update() {
    const p = state.player;
    const playing = state.screen !== 'menu';
    setShown(els.hud, 'hudShown', playing);
    if (!playing) return;
    setText(els.cash, 'cash', formatCash(p.cash));
    setText(els.stars, 'stars', p.wanted > 0 ? wantedStars(p.wanted) : '');
    setText(els.clock, 'clock', formatClock(Math.floor(state.clockMinutes / 60) % 24, state.clockMinutes % 60));
    setHtml(els.rep, 'rep', repHtml(p.rep));
    setText(els.district, 'district', city.getDistrictAt(p.x, p.z));
    const station = RADIO[state.radio.station];
    setText(els.radio, 'radio', state.radio.muted ? 'MUTED' : station.name + ' — ' + station.tagline);
    setWidth(els.healthFill, 'hp', Math.max(0, Math.min(100, p.health)));
    setWidth(els.armorFill, 'armor', Math.max(0, Math.min(100, p.armor)));
    setHtml(els.weaponSlots, 'slots', weaponHtml(p));
    setHtml(els.missionPanel, 'mission', missionHtml(state.mission));
    const driving = !p.onFoot && p.inCar;
    setShown(els.speedo, 'speedoShown', !!driving);
    setShown(els.carCondition, 'condShown', !!driving);
    if (driving) {
      setHtml(els.speedo, 'speedo', Math.round(Math.abs(p.speed) * 5) + '<small> KM/H · ' + p.inCar.name + '</small>');
      const cond = Math.round(p.inCar.condition);
      setHtml(els.carCondition, 'cond',
        'CONDITION ' + cond + '%<div style="height:5px;background:rgba(255,255,255,.18);border-radius:3px;margin-top:3px">'
        + '<div style="height:100%;width:' + cond + '%;background:' + (cond > 50 ? '#7dff9a' : cond > 25 ? '#ffd166' : '#ff5a5a')
        + ';border-radius:3px"></div></div>');
    }
    // Police panel: named units + heli line; hidden at 0 stars.
    const police = state.police ?? { units: [], heli: false };
    const hot = p.wanted > 0;
    if (cache.hot !== hot) {
      cache.hot = hot;
      els.policePanel.classList.toggle('hot', hot);
    }
    if (hot) {
      let text = police.units.length
        ? police.units.map((u) => u.name + ' · ' + u.state + ' · ' + Math.round(u.dist) + 'm').join('<br>')
        : 'ABPD responding — ' + p.wanted + (p.wanted === 1 ? ' star' : ' stars') + '. Lose the heat or outrun it.';
      if (police.heli) text += '<br>ABPD Falcon overhead — break line of sight.';
      setHtml(els.policeText, 'police', text);
    }
    // Dialogue box from missions.js.
    const d = state.dialogue;
    const showDlg = !!d;
    if (cache.dlg !== showDlg) {
      cache.dlg = showDlg;
      els.dialogue.classList.toggle('show', showDlg);
    }
    if (d) {
      setText(els.dialogue.querySelector('.speaker'), 'dlgSpeaker', d.speaker);
      setText(els.dialogue.querySelector('.line'), 'dlgLine', d.line);
    }
    // Mission banner: big centre flash on pass/fail.
    const b = state.banner;
    setHtml(els.banner, 'banner', b
      ? '<div class="banner-title">' + b.title + '</div><div class="banner-sub">' + b.sub + '</div>' : '');
    if (cache.bannerShown !== !!b) {
      cache.bannerShown = !!b;
      els.banner.classList.toggle('show', !!b);
    }
    drawMinimap(p);
  }

  return { name: 'hud', update };
}

# Azura Bay — Open-World Crime Game

[![Make GTA 6 bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?ref=7zhtwvs3)
[![Rank](https://make.fun/badge/gta6-01/azaliatahira27/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01?ref=7zhtwvs3)
[![Reward](https://make.fun/badge/gta6-01/azaliatahira27/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?ref=7zhtwvs3)

**Azura Bay** is a 3D open-world crime game set in a sun-soaked coastal city at
golden hour. You are **Mara Solis**, a driver for hire pulled into a heist crew.
Steal cars, outrun the ABPD, run six story missions across six districts, and
climb the REP ladder from NOBODY to LEGEND.

Everything is original: the city, the characters, the cars, the story and the
music are all made for this game. Nothing is taken from any commercial game.

## The city

Azura Bay is a procedural coastal city, built fresh from a seed every visit:
**Coral Strip** (beachfront hotels), the **Marina District**, **Old Town**,
**Harbor Docks**, **Sunset Heights** and glass-towered **Downtown**, with a
beach, a coastal highway and the open ocean to the west. The sun hangs low over
the water, palms line the avenues, and the streetlights come on as the evening
creeps in.

## What is in the game

- **On foot and by car** — run the streets or steal one of five cars
  (Cielo GT, Marlin S, Duna Pickup, Faro Coupe, Tiburon X) and drive the grid.
- **Traffic and pedestrians** — 16 traffic cars and 20 pedestrians on the road
  network, clustered around you from the first second, so the city is busy the
  moment you start.
- **Wanted system, 1–5 stars** — ABPD Interceptors, roadblocks and the Falcon
  helicopter respond to the heat you bring on yourself.
- **Combat** — fists plus three guns (P9 Pistol, K9 SMG, AR-77 Rifle).
- **Six story missions** with named contacts and dialogue: Rosa, Deke, Ines and
  Captain Voss pull Mara from a first fare to the Azura Heist. The first job
  starts the moment you press Start — banner, briefing and gold waypoint live
  from second 0.
- **HUD with a round minimap**, health and armour bars, cash, wanted stars,
  speedometer, weapon slots, radio readout and mission objectives.
- **REP progression** — NOBODY → HUSTLER → DRIVER → FIXER → LEGEND.
- **Procedural radio** — SOL FM 98.7 and Tide FM, synthesized live with WebAudio.
- **Save to localStorage** — progress autosaves; the city waits for you.

## How to play

Open `game/index.html` from any static server (for example `node serve.ts`,
then visit http://localhost:8080). No build step, no network: the game runs
fully offline in desktop Chrome.

| Key | Action |
| --- | --- |
| W A S D / Arrow keys | Move on foot, drive |
| Shift | Run |
| F | Enter / exit car |
| Mouse drag | Look around |
| Left click | Attack / shoot |
| R | Reload |
| 1–4 | Switch weapon |
| Q | Change radio station |
| M | Mute |
| Esc | Pause |

## Screenshots

The four frames in `screenshots/` are real renders of the game itself, staged
with `?shot=chase|mission|combat|city&seed=20261118` — the same code you play,
played forward by an autopilot: a 4-star highway chase under the ABPD Falcon, a
First Fare briefing on a busy Old Town street, a shootout with police closing
in, and a golden-hour aerial over the Coral Strip.

## Tech

- **three.js r170** (vendored as `game/vendor/three.module.min.js`), plain ES
  modules, no build step.
- Seeded procedural city: the same seed always builds the same streets, so
  screenshots are reproducible.
- Fixed 60 Hz simulation timestep; the renderer paints every frame.

## Structure

- `game/index.html` — page shell, import map, HUD containers.
- `game/src/main.js` — boot, game loop, state machine, save, debug hooks.
- `game/src/config.js` — tuning, districts, cars, police, radio, REP ladder.
- `game/src/city.js` — procedural city, road network, colliders, spawns.
- `game/src/utils.js` — seeded RNG, math and formatting helpers.
- `game/src/shots.js` — screenshot staging (`?shot=chase|mission|combat|city`).
- `game/src/hud.js` — HUD + minimap rendering.
- `game/src/vehicles.js` — cars, stealing, driving, damage.
- `game/src/traffic.js` — traffic cars and pedestrians.
- `game/src/police.js` — wanted level, pursuits, roadblocks, helicopter.
- `game/src/combat.js` — fists and guns.
- `game/src/missions.js` — story missions, stages, dialogue.
- `game/src/audio.js` — procedural radio and sound effects.
- `game/src/save.js` — localStorage save and load.
- `docs/INTERFACES.md` — the contracts every system builds against.

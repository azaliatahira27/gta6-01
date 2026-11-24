# Azura Bay — Interfaces

The contracts every system builds against. Builder A owns the skeleton
(`index.html`, `main.js`, `config.js`, `city.js`, `utils.js`, `shots.js`);
other builders own their system files and add one import + one
`registerSystem` call in `main.js` (`bootSystems`), in the order below.
Do not change the state shape or the city API without telling the coordinator —
every builder codes against this document.

## Module map

| File | Owner | Job |
| --- | --- | --- |
| `game/index.html` | A | Page shell, import map, HUD containers |
| `game/src/main.js` | A | Boot, fixed-step loop, screens, input, save stub, `window.__game` |
| `game/src/config.js` | A | Constants: city, districts, cars, police, radio, REP, weapons |
| `game/src/city.js` | A | Procedural city, road network, colliders, spawns |
| `game/src/utils.js` | A | Seeded RNG, math, collision, formatting |
| `game/src/shots.js` | A + screenshots | `?shot=start\|play\|end` staging |
| `game/src/hud.js` | B | HUD + minimap rendering (replaces the stubs in `main.js`) |
| `game/src/vehicles.js` | B | Cars: spawning, stealing, driving, damage |
| `game/src/traffic.js` | C | Traffic cars and pedestrians on the road network |
| `game/src/police.js` | C | Wanted level, pursuits, roadblocks, helicopter |
| `game/src/combat.js` | D | Fists and guns, hit detection, damage |
| `game/src/missions.js` | D | Story missions, stages, dialogue, contacts |
| `game/src/audio.js` | E | Procedural radio (WebAudio) and sound effects |
| `game/src/save.js` | E | localStorage save/load (extends the stub in `main.js`) |

## The shared state object

`main.js` owns one `state` object (exported, and on `window.__game.state`).
Every system reads and writes it; nobody replaces it wholesale.

```js
state = {
  screen: 'menu' | 'playing' | 'paused' | 'over',
  time: 0,                    // seconds since boot (advances in fixed steps)
  clockMinutes: 1122,         // in-world clock; 18:42 at boot
  seed: 20261118,             // city seed (?seed=N overrides)
  player: {
    x, z,                     // world position (y is always ground: 0)
    heading,                  // radians; forward = (sin h, cos h) in (x, z)
    speed,                    // current speed, units/s (signed: reverse < 0)
    onFoot: true,             // false while driving
    inCar: null,              // vehicle object while driving (vehicles.js shape)
    health: 100, armor: 0,    // 0..100
    cash: 250, rep: 0,        // dollars; lifetime REP points
    wanted: 0,                // 0..5 stars
    weapon: 'fists',          // id from WEAPONS
    ammo: {},                 // weapon id -> rounds left (fists: Infinity)
  },
  mission: {
    id: null,                 // mission id from MISSIONS, or null in free roam
    stage: 0,                 // stage index within the mission
    title: 'Free Roam',       // shown in #mission-panel
    text: '…',                // current objective line
  },
  camera: {
    yaw: 0, pitch: 0.32,      // pitch: camera height angle, radians
    yawOffset: 0,             // mouse-drag orbit offset from the player heading
    dist: 7.5,                // chase distance (set from CAMERA by main.js)
  },
  radio: { station: 0, muted: false },   // station index into RADIO
  events: [],                 // drained by main.js after each step (see Events)
  stats: { carsStolen: 0, missionsDone: 0, distanceDriven: 0 },
}
```

### Vehicle object (vehicles.js)

`state.player.inCar` is null on foot, else:

```js
{ id: 'cielo', name: 'Cielo GT', model: <THREE.Group>,
  x, z, heading, speed, condition: 100, // 0..100; 0 = wrecked
  stolen: true }                          // true when taken off the street
```

While driving, `state.player.x/z/heading/speed` mirror the car — the camera,
the minimap and the police all read the player fields, never the car directly.

## System registration and init order

`main.js` keeps `systems`, an ordered list. Each entry is
`{ name: string, update(dt, ctx) }` (an `init(ctx)` is called once at boot
when present). `registerSystem(system)` appends; `main.js` calls
`update(dt, ctx)` in registration order, once per fixed step (1/60 s).

Registration order (the contract — later systems read earlier systems' output):

1. `city` — ambient city animation (foam, sun). Registered by `main.js`.
2. `player` — on-foot stub movement. Registered by `main.js`; `vehicles.js`
   takes over movement while driving by setting `player.onFoot = false`
   (the stub returns early when `!onFoot` — see the note in `main.js`).
3. `vehicles` — car physics, stealing, damage.
4. `traffic` — traffic cars and pedestrians.
5. `police` — wanted decay, pursuit AI, roadblocks, helicopter.
6. `combat` — shooting, melee, damage to peds/police/cars.
7. `missions` — stage checks, triggers, dialogue queues.
8. `audio` — radio sequencing, sfx triggers (reads events).
9. `hud` — HUD + minimap (reads everything, writes only the DOM).
10. `camera` — chase camera. Registered by `main.js`, runs last.

`ctx`, passed to every `update`, is:

```js
{ state, scene, camera, renderer, city, playerMesh,
  emit, registerSystem, showToast, announce, saveGame, loadGame,
  stepWorld,   // advance the simulation one fixed step (shots.js autopilot)
  keys,        // Set of KeyboardEvent.code strings currently held
  colliders }  // city.getColliders() — the live AABB list
```

Rules: systems never create their own renderer or camera; they never read
`window.__game` (use `ctx`); they never block on network (there is none —
every asset is a file under `game/` or generated at runtime).

## Events

`emit(type, data)` (on `ctx` and `window.__game`) pushes
`{ type, data, at: state.time }` onto `state.events`. `main.js` drains the
queue after each step. Names every system agrees on:

| Event | Data | Meaning |
| --- | --- | --- |
| `toast` | `{ text }` | Show a transient message (#toast) |
| `announce` | `{ text }` | Screen-reader announcement (#status) |
| `radio` | `{ station }` | Station changed |
| `mute` | `{ muted }` | Sound toggled |
| `gameStart` | `{}` | Player left the menu |
| `carStolen` | `{ car }` | Player stole a car (REP + heat) |
| `wanted` | `{ level }` | Wanted level changed |
| `missionStart` | `{ id }` | A mission began |
| `missionStage` | `{ id, stage }` | Mission advanced |
| `missionDone` | `{ id, cash, rep }` | Mission completed |
| `missionFail` | `{ id }` | Mission failed |
| `playerDown` | `{}` | Health hit 0 |
| `shot` | `{ weapon }` | A shot was fired (audio) |
| `hit` | `{ target, damage }` | Something was hit |

Audio and HUD subscribe by reading the drained queue in their own `update`
(the queue is emptied by `main.js`, so read it in the same step it was
emitted — or listen in `update` before the drain by checking
`state.events` directly).

## city.js API

`buildCity(scene, seed)` builds the whole city into `scene` and returns:

```js
{
  group, sun, groundCanvas, seed,
  getRoadNetwork() -> { nodes, edges },
  getSpawnPoints() -> { player, cars, missions, policeStation, safehouse },
  getDistrictAt(x, z) -> string,       // district name, or 'Azura Bay'
  isOnRoad(x, z) -> boolean,
  getColliders() -> [{ minX, maxX, minZ, maxZ }],
  nearestNode(x, z) -> { id, x, z },   // closest road-network node
  followSun(x, z),                     // keep the shadow camera on the action
  update(dt, time),                    // foam scroll + sun pulse
}
```

- `getRoadNetwork()`: `nodes` are the 81 intersections of the avenue × street
  grid (`{ id, x, z }`); `edges` link adjacent intersections
  (`{ a, b }` node ids). Traffic and police path on this graph. Node ids are
  stable for a given config: `id = avenueIndex * 9 + streetIndex`.
- `getSpawnPoints()`: `player` is `{ x, z, heading }`; `cars` is an array of
  `{ x, z, heading, model }` (model ids match `CARS` in `config.js`);
  `missions` maps mission id → `{ x, z, heading }`; `policeStation` and
  `safehouse` are `{ x, z, heading }`.
- `getColliders()`: axis-aligned boxes for every building, container and crane
  leg. Movement resolves against them with `resolveCircleBox` from `utils.js`.
  The list is built once; do not mutate it (vehicles add their own car-vs-car
  checks separately).
- `groundCanvas`: the 1024×1024 canvas the ground plane is textured with —
  the minimap draws from it. `worldToMap(x, z)` (exported from `city.js`)
  converts world coords to canvas pixels.
- `clampToMap(x, z)` (exported) clamps a position inside the playable map.

City facts: the world is 480×480 units centred on the origin; roads are
12 units wide on the grid in `CITY.avenues` / `CITY.streets`; the beach is
west of x = −180 and open water west of x = −196. The generator is seeded
(`CITY.seed`); do not use `Math.random()` in city generation.

## utils.js

`mulberry32(seed) -> () => [0,1)` — deterministic PRNG. `randRange(rng, min, max)`,
`randInt(rng, min, max)`, `pick(rng, items)`. `clamp(v, min, max)`,
`lerp(a, b, t)`, `lerpAngle(a, b, t)`, `wrapAngle(a)`, `dist2(x1, z1, x2, z2)`,
`pointInBox(x, z, box)`, `resolveCircleBox(pos, r, box)` (mutates `pos`,
returns true when pushed), `formatCash(n)`, `formatClock(h, m)`,
`wantedStars(level)`, `repRankFor(rep, ranks)`.

## config.js

`STEP` (1/60), `MAX_FRAME` (0.25), `SAVE_KEY`, `GAME_NAME`, `PROTAGONIST`,
`CITY` (size, road grid, coast, seed), `DISTRICTS` (name, rect, kind, blurb),
`DISTRICT_STYLE` (per-kind building ranges and palettes), `PALETTE` (sunset
colours), `CARS` (id, name, top mph, accel, grip, colour, seats), `POLICE`
(ABPD names and light colours), `RADIO` (id, name, tagline, tempo, root),
`REP_RANKS` (rank, threshold), `WEAPONS` (id, name, damage, range, auto,
ammo), `PLAYER` (walk/run speed, turn speed, radius, height, max health /
armour, start cash), `CAMERA` (chase distances, heights, smoothing, fov),
`CLOCK` (start time, minutes per real second), `MISSIONS` (id, name, contact,
district).

## HUD element ids (index.html)

Stable ids — `hud.js` fills them, `main.js` stubs them until then:

`hud`, `minimap` (+ `minimap-canvas`, 186×186), `district-label`,
`mission-panel` (+ `mission-text`), `police-panel` (+ `police-text`),
`cash`, `stars`, `clock`, `rep`, `healthbar` (`health-fill`, `armor-fill`),
`weapon-slots`, `speedo`, `car-condition`, `radio`, `dialogue-box`
(`.speaker`, `.line`, `.hint`; add class `show` to display),
`toast` (add class `show`), `start-screen`, `pause-menu`, `status`
(screen-reader line). Buttons: `start-button`, `resume-button`,
`restart-button`.

The minimap is north-up, player-centred, drawn from `city.groundCanvas`;
`hud.js` adds mission markers, police blips and the wanted ring on top of
the stub's player arrow.

## Screenshot staging (shots.js)

`stageShot(name, ctx) -> { screen }`. `main.js` calls it when the URL has
`?shot=start|play|end` (with `&seed=N`), renders twice, then sets
`window.__shotReady = true`. `shots.json` maps the three names to files.
The autopilot holds keys in `ctx.keys` and steps the world with
`ctx.stepWorld(STEP)` — staged frames are real play, never posed renders.
The screenshot builder may extend the staging (a real `over` screen for
`end`, traffic in frame) but must keep the export name and return shape.

## Save format (localStorage, SAVE_KEY = 'azura-bay.save.v1')

```json
{ "cash": 0, "rep": 0, "health": 100, "armor": 0,
  "x": 0, "z": 0, "heading": 0, "wanted": 0,
  "missionId": null, "clockMinutes": 1122,
  "stats": { "carsStolen": 0, "missionsDone": 0, "distanceDriven": 0 } }
```

`save.js` extends this (garage, mission progress, owned weapons) with a
version bump when it changes the shape. `main.js` autosaves every 30 s of
play and on pause; `loadGame()` runs at boot.

## Debug hooks

`window.__game = { state, city, scene, camera, renderer, playerMesh,
stepWorld, saveGame, loadGame, startGame, togglePause, emit,
registerSystem, systems }`. `window.__shotReady` is set after a staged
shot has painted twice.

## Hard rules (from the kit)

- No network references anywhere in `game/`: every script, image, font and
  sound is a file under `game/` or a `data:` URI. One import map at most
  (in `index.html`, mapping `three` to `./vendor/three.module.min.js`).
- `game/` ≤ 993 files/dirs, 48 MiB total; `index.html` ≤ 1 MiB.
- Dossier text is capped at 163,840 bytes — keep source files tight and
  split by job; name files and functions for what they do.
- Do not touch `vendor/makefun-game.ts`, `serve.ts`, `shots.json`, `LICENSE`.
- Do not touch `screenshots/` (the screenshot builder owns it).

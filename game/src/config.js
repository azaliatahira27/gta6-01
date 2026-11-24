// Azura Bay — every tuning number, name and colour in one place. The world is a
// fixed 480 x 480 unit square centred on the origin; the ocean lies to the west
// (negative x), the city grid to the east. Nothing here depends on screen size.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
export const MAX_FRAME = 0.25;

/** Where a save is kept between visits (this browser only). */
export const SAVE_KEY = 'azura-bay.save.v1';

export const GAME_NAME = 'Azura Bay';
export const PROTAGONIST = 'Mara Solis';

/** City extents, road grid and coast. Roads run on the grid lines; blocks sit between them. */
export const CITY = {
  size: 480,
  half: 240,
  roadWidth: 12,
  sidewalk: 3,
  /** North-south road centre-lines (x). The first is the coastal highway. */
  avenues: [-168, -144, -96, -48, 0, 48, 96, 144, 192],
  /** East-west road centre-lines (z). */
  streets: [-192, -144, -96, -48, 0, 48, 96, 144, 192],
  /** x west of this is sand, then open water. */
  beachX: -180,
  oceanX: -196,
  /** Seed for the procedural city, so every visit (and screenshot) builds the same streets. */
  seed: 20261118,
};

/** Districts, as axis-aligned rectangles in world units. Order matters: first match wins. */
export const DISTRICTS = [
  { name: 'Coral Strip', minX: -180, maxX: -96, minZ: -240, maxZ: 240, kind: 'beach',
    blurb: 'Beachfront hotels and neon on the sand.' },
  { name: 'Marina District', minX: -96, maxX: 0, minZ: -240, maxZ: -64, kind: 'marina',
    blurb: 'Yachts, lofts and salt air.' },
  { name: 'Harbor Docks', minX: 0, maxX: 128, minZ: -240, maxZ: -128, kind: 'docks',
    blurb: 'Cranes, containers and night-shift deals.' },
  { name: 'Downtown', minX: 0, maxX: 128, minZ: -128, maxZ: 64, kind: 'downtown',
    blurb: 'Glass towers and the money that lives in them.' },
  { name: 'Old Town', minX: -96, maxX: 0, minZ: 64, maxZ: 240, kind: 'oldtown',
    blurb: 'Pastel streets where everybody knows Mara.' },
  { name: 'Sunset Heights', minX: 128, maxX: 240, minZ: -240, maxZ: 240, kind: 'heights',
    blurb: 'Hillside villas above the evening haze.' },
];

/** Building style per district kind: height range, palette and how many per block. */
export const DISTRICT_STYLE = {
  beach: { minH: 18, maxH: 46, perBlock: 2, colors: [0xfff3e0, 0xffd9c2, 0xf7ead7, 0xffe8d6] },
  marina: { minH: 10, maxH: 26, perBlock: 3, colors: [0xe8f0f2, 0xd6e4e8, 0xf2e6d8, 0xcfe0e6] },
  docks: { minH: 6, maxH: 14, perBlock: 2, colors: [0x8a7f72, 0x9c8f7d, 0x7d7468, 0xa89a86] },
  downtown: { minH: 30, maxH: 86, perBlock: 1, colors: [0x3d4a5c, 0x54627a, 0x2f3a4a, 0x6b7a90] },
  oldtown: { minH: 7, maxH: 16, perBlock: 4, colors: [0xffc9a3, 0xffb3a7, 0xffe3b3, 0xf7a8a0, 0xd9e8c9] },
  heights: { minH: 6, maxH: 13, perBlock: 3, colors: [0xf5e6d3, 0xead9c2, 0xfff0dd, 0xe3d3bd] },
};

/** Sunset palette: the whole city is lit warm, with the sun low in the west. */
export const PALETTE = {
  skyTop: 0x2b1b4d,
  skyMid: 0xd94f6a,
  skyLow: 0xff9a5c,
  sun: 0xffd166,
  sunLight: 0xffb36b,
  ambient: 0x8a6a9a,
  ocean: 0x1e5f7a,
  sand: 0xe8c98f,
  asphalt: 0x2e2a33,
  sidewalk: 0x6b6560,
  grass: 0x4a7a4d,
  ground: 0x3a3340,
  palmTrunk: 0x6b4a2f,
  palmLeaf: 0x2f7a3d,
};

/** Cars of Azura Bay. `top` is mph, `accel` and `grip` are relative (1 = average). */
export const CARS = [
  { id: 'cielo', name: 'Cielo GT', top: 142, accel: 1.25, grip: 1.15, color: 0xd94f6a, seats: 2 },
  { id: 'marlin', name: 'Marlin S', top: 118, accel: 1.0, grip: 1.0, color: 0x4f8fd9, seats: 4 },
  { id: 'duna', name: 'Duna Pickup', top: 102, accel: 0.85, grip: 0.9, color: 0xc9a24f, seats: 4 },
  { id: 'faro', name: 'Faro Coupe', top: 128, accel: 1.1, grip: 1.05, color: 0x7a4fd9, seats: 2 },
  { id: 'tiburon', name: 'Tiburon X', top: 155, accel: 1.4, grip: 1.25, color: 0x2fbfa0, seats: 2 },
];

/** The Azura Bay Police Department. */
export const POLICE = {
  name: 'ABPD',
  fullName: 'Azura Bay Police Department',
  carName: 'ABPD Interceptor',
  heliName: 'ABPD Falcon',
  carColor: 0x2b4a72,
  lightA: 0xff2a2a,
  lightB: 0x2a6bff,
  maxStars: 5,
};

/** Procedural radio stations (WebAudio, no audio files). */
export const RADIO = [
  { id: 'sol', name: 'SOL FM 98.7', tagline: 'Sunset synth, all evening.', tempo: 112, root: 220 },
  { id: 'tide', name: 'Tide FM', tagline: 'Coastal grooves and night drives.', tempo: 96, root: 196 },
];

/** REP ladder: thresholds are lifetime REP points. */
export const REP_RANKS = [
  { rank: 'NOBODY', at: 0 },
  { rank: 'HUSTLER', at: 100 },
  { rank: 'DRIVER', at: 300 },
  { rank: 'FIXER', at: 700 },
  { rank: 'LEGEND', at: 1500 },
];

/** Weapons. `damage` per hit, `range` in world units, `auto` fires while held. */
export const WEAPONS = [
  { id: 'fists', name: 'Fists', damage: 12, range: 2.2, auto: false, ammo: Infinity },
  { id: 'pistol', name: 'P9 Pistol', damage: 25, range: 45, auto: false, ammo: 120 },
  { id: 'smg', name: 'K9 SMG', damage: 16, range: 38, auto: true, ammo: 300 },
  { id: 'rifle', name: 'AR-77 Rifle', damage: 40, range: 90, auto: true, ammo: 180 },
];

/** On-foot player tuning. */
export const PLAYER = {
  walkSpeed: 6,
  runSpeed: 11,
  turnSpeed: 4.2,
  radius: 0.7,
  height: 1.8,
  maxHealth: 100,
  maxArmor: 100,
  startCash: 250,
};

/** Chase camera tuning. */
export const CAMERA = {
  onFootDist: 7.5,
  onFootHeight: 3.2,
  carDist: 10.5,
  carHeight: 4.2,
  lookAhead: 6,
  smooth: 6,
  fov: 62,
};

/** In-world clock: the game opens at golden hour and the evening creeps on. */
export const CLOCK = { startHour: 18, startMinute: 42, minutesPerRealSecond: 0.25 };

/** Mission roster (stages and dialogue live in missions.js; names stay here for the HUD). */
export const MISSIONS = [
  { id: 'm1', name: 'First Fare', contact: 'Rosa', district: 'Old Town' },
  { id: 'm2', name: 'Hot Wheels', contact: 'Deke', district: 'Harbor Docks' },
  { id: 'm3', name: 'The Marina Job', contact: 'Ines', district: 'Marina District' },
  { id: 'm4', name: 'Heat Wave', contact: 'Rosa', district: 'Downtown' },
  { id: 'm5', name: 'High Tide', contact: 'Captain Voss', district: 'Coral Strip' },
  { id: 'm6', name: 'The Azura Heist', contact: 'Deke', district: 'Sunset Heights' },
];

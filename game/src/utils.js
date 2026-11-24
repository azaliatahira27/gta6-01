// Small math and random helpers shared by every system. The city generator and the
// screenshot autopilot both run on mulberry32, so a seed always builds the same city.

/** Deterministic PRNG (mulberry32). Returns a function yielding [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random float in [min, max) from a mulberry32-style function. */
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Random integer in [min, max] from a mulberry32-style function. */
export function randInt(rng, min, max) {
  return Math.floor(randRange(rng, min, max + 1));
}

/** Pick one element of `items` using `rng`. */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

/** Clamp `v` into [min, max]. */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** Linear interpolation between a and b. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest-arc interpolation between two headings (radians). */
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Wrap an angle (radians) into (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** 2D distance on the ground plane (x, z). */
export function dist2(x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  return Math.sqrt(dx * dx + dz * dz);
}

/** True when point (x, z) lies inside the axis-aligned box. */
export function pointInBox(x, z, box) {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

/**
 * Push a circle (centre x, z, radius r) out of an axis-aligned box, in place.
 * Returns true when a push happened. `pos` is { x, z } and is mutated.
 */
export function resolveCircleBox(pos, r, box) {
  const cx = clamp(pos.x, box.minX, box.maxX);
  const cz = clamp(pos.z, box.minZ, box.maxZ);
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    pos.x = cx + (dx / d) * r;
    pos.z = cz + (dz / d) * r;
    return true;
  }
  // Centre inside the box: push out along the smallest penetration.
  const left = pos.x - box.minX;
  const right = box.maxX - pos.x;
  const top = pos.z - box.minZ;
  const bottom = box.maxZ - pos.z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) pos.x = box.minX - r;
  else if (m === right) pos.x = box.maxX + r;
  else if (m === top) pos.z = box.minZ - r;
  else pos.z = box.maxZ + r;
  return true;
}

/** Format dollars as "$1,250". */
export function formatCash(amount) {
  return '$' + Math.floor(amount).toLocaleString('en-US');
}

/** Format a clock (hour 0-23, minute 0-59) as "18:42". */
export function formatClock(hour, minute) {
  const h = String(hour).padStart(2, '0');
  const m = String(Math.floor(minute)).padStart(2, '0');
  return h + ':' + m;
}

/** Wanted stars as a string of ★ and ☆, e.g. wantedStars(3) -> "★★★☆☆". */
export function wantedStars(level) {
  let out = '';
  for (let i = 0; i < 5; i += 1) out += i < level ? '★' : '☆';
  return out;
}

/** REP rank name for a lifetime REP total, from the REP_RANKS ladder. */
export function repRankFor(rep, ranks) {
  let name = ranks[0].rank;
  for (const entry of ranks) if (rep >= entry.at) name = entry.rank;
  return name;
}

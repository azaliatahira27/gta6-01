// Azura Bay, built fresh every visit from a seed: a sunset coastal city with a road
// grid, six districts, beach and ocean to the west, palms, streetlights and props.
// Everything here is procedural — no model or image files — and the generator is
// seeded, so the same seed always builds the same streets.
//
// Other systems use the road-network API at the bottom: traffic and police path on
// getRoadNetwork(), spawns come from getSpawnPoints(), and movement collides against
// getColliders(). See docs/INTERFACES.md for the exact shapes.
import * as THREE from 'three';
import { CITY, DISTRICTS, DISTRICT_STYLE, PALETTE } from './config.js';
import { clamp, mulberry32, pick, pointInBox, randRange } from './utils.js';

const MAP_PX = 1024;
const HALF = CITY.half;

/** World (x, z) -> ground-texture pixel. Shared by the map painter and the minimap. */
export function worldToMap(x, z) {
  return { px: ((x + HALF) / CITY.size) * MAP_PX, py: ((z + HALF) / CITY.size) * MAP_PX };
}

/** Vertical sunset gradient for the sky dome. */
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#241640');
  grad.addColorStop(0.35, '#5b2a63');
  grad.addColorStop(0.62, '#c94f6d');
  grad.addColorStop(0.82, '#ff8a5c');
  grad.addColorStop(1.0, '#ffc46b');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Glowing sun disc, drawn once on a canvas. */
function makeSunTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,240,190,1)');
  grad.addColorStop(0.25, 'rgba(255,205,110,0.95)');
  grad.addColorStop(0.6, 'rgba(255,140,80,0.35)');
  grad.addColorStop(1, 'rgba(255,120,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Facade tile: pale wall with a grid of windows, some lit warm. Material colour tints it. */
function makeWindowTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e4de';
  g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const lit = rng() < 0.45;
      g.fillStyle = lit ? '#ffd88a' : '#3a4152';
      g.fillRect(10 + col * 40, 10 + row * 30, 22, 18);
      if (lit) {
        g.fillStyle = 'rgba(255,220,140,0.35)';
        g.fillRect(6 + col * 40, 6 + row * 30, 30, 26);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Paint the whole ground plane: blocks, roads, dashes, crosswalks, beach and sand. */
function paintGround(rng) {
  const c = document.createElement('canvas');
  c.width = MAP_PX;
  c.height = MAP_PX;
  const g = c.getContext('2d');
  const px = (v) => ((v + HALF) / CITY.size) * MAP_PX;
  const scale = MAP_PX / CITY.size;

  g.fillStyle = '#38323c';
  g.fillRect(0, 0, MAP_PX, MAP_PX);

  // Sand west of the beach line.
  g.fillStyle = '#e8c98f';
  g.fillRect(0, 0, px(CITY.beachX), MAP_PX);
  g.fillStyle = '#dfbd7d';
  for (let i = 0; i < 260; i += 1) {
    g.fillRect(rng() * px(CITY.beachX), rng() * MAP_PX, 2, 2);
  }

  // City blocks: sidewalk border, then a district-tinted lot.
  const blockTint = { beach: '#7a6a58', marina: '#5d6a68', docks: '#5a5348', downtown: '#4a4a55', oldtown: '#6a5a4e', heights: '#5f6a52' };
  for (let ax = 0; ax < CITY.avenues.length - 1; ax += 1) {
    for (let sz = 0; sz < CITY.streets.length - 1; sz += 1) {
      const x0 = CITY.avenues[ax] + CITY.roadWidth / 2;
      const x1 = CITY.avenues[ax + 1] - CITY.roadWidth / 2;
      const z0 = CITY.streets[sz] + CITY.roadWidth / 2;
      const z1 = CITY.streets[sz + 1] - CITY.roadWidth / 2;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const district = DISTRICTS.find((d) => pointInBox(cx, cz, d));
      const kind = district ? district.kind : 'downtown';
      g.fillStyle = '#6b6560';
      g.fillRect(px(x0), px(z0), (x1 - x0) * scale, (z1 - z0) * scale);
      g.fillStyle = blockTint[kind];
      g.fillRect(px(x0 + CITY.sidewalk), px(z0 + CITY.sidewalk), (x1 - x0 - 2 * CITY.sidewalk) * scale, (z1 - z0 - 2 * CITY.sidewalk) * scale);
    }
  }

  // Roads: asphalt, then dashed centrelines and intersection crosswalks.
  g.fillStyle = '#2e2a33';
  for (const x of CITY.avenues) g.fillRect(px(x - CITY.roadWidth / 2), 0, CITY.roadWidth * scale, MAP_PX);
  for (const z of CITY.streets) g.fillRect(0, px(z - CITY.roadWidth / 2), MAP_PX, CITY.roadWidth * scale);
  g.fillStyle = '#e8d9a0';
  for (const x of CITY.avenues) {
    for (let z = -HALF; z < HALF; z += 8) g.fillRect(px(x) - 1, px(z), 2, 4 * scale);
  }
  for (const z of CITY.streets) {
    for (let x = -HALF; x < HALF; x += 8) g.fillRect(px(x), px(z) - 1, 4 * scale, 2);
  }
  g.fillStyle = 'rgba(240,240,240,0.55)';
  for (const x of CITY.avenues) {
    for (const z of CITY.streets) {
      for (let i = 0; i < 4; i += 1) g.fillRect(px(x - 4 + i * 2.2), px(z - CITY.roadWidth / 2 - 2.4), 1.4 * scale, 1.6 * scale);
    }
  }
  return c;
}

/** Box geometry whose side UVs repeat the facade tile every ~5 units, so windows stay true. */
function buildingGeometry(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  // Faces in order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const faceU = [d / 5, d / 5, 1, 1, w / 5, w / 5];
  const faceV = [h / 5, h / 5, 1, 1, h / 5, h / 5];
  for (let face = 0; face < 6; face += 1) {
    for (let v = 0; v < 4; v += 1) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * faceU[face], uv.getY(i) * faceV[face]);
    }
  }
  return geo;
}

/**
 * Build the whole city into `scene` from `seed`. Returns the city API other systems
 * code against (see docs/INTERFACES.md).
 */
export function buildCity(scene, seed = CITY.seed) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'AzuraBay';
  scene.add(group);
  const colliders = [];

  // --- Sky, sun, light and haze -------------------------------------------------
  scene.background = new THREE.Color(PALETTE.skyMid);
  scene.fog = new THREE.Fog(0xd97a6a, 130, 520);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false }),
  );
  group.add(sky);
  const sunDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 150),
    new THREE.MeshBasicMaterial({ map: makeSunTexture(), transparent: true, fog: false, depthWrite: false }),
  );
  sunDisc.position.set(-760, 95, 60);
  sunDisc.lookAt(0, 40, 0);
  group.add(sunDisc);
  const sun = new THREE.DirectionalLight(PALETTE.sunLight, 2.6);
  sun.position.set(-180, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0006;
  group.add(sun);
  group.add(sun.target);
  const hemi = new THREE.HemisphereLight(0x9a6aa8, 0x5a4030, 0.9);
  group.add(hemi);

  // --- Ground, ocean and shoreline ----------------------------------------------
  const groundCanvas = paintGround(rng);
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size, CITY.size),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const oceanMat = new THREE.MeshStandardMaterial({ color: PALETTE.ocean, roughness: 0.25, metalness: 0.1 });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(560, 900), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(CITY.oceanX - 280, 0.08, 0);
  group.add(ocean);

  // Foam strip along the waterline, slowly scrolling.
  const foamCanvas = document.createElement('canvas');
  foamCanvas.width = 64;
  foamCanvas.height = 256;
  const fg = foamCanvas.getContext('2d');
  fg.clearRect(0, 0, 64, 256);
  for (let i = 0; i < 90; i += 1) {
    fg.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.5})`;
    fg.beginPath();
    fg.arc(8 + rng() * 48, rng() * 256, 1 + rng() * 4, 0, Math.PI * 2);
    fg.fill();
  }
  const foamTex = new THREE.CanvasTexture(foamCanvas);
  foamTex.wrapS = THREE.RepeatWrapping;
  foamTex.wrapT = THREE.RepeatWrapping;
  foamTex.repeat.set(1, 12);
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 480),
    new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(CITY.oceanX + 2, 0.15, 0);
  group.add(foam);

  // --- Buildings ------------------------------------------------------------------
  const facadeTex = makeWindowTexture(rng);
  const wallMat = new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4048, roughness: 0.95 });
  const buildings = new THREE.Group();
  buildings.name = 'Buildings';
  group.add(buildings);

  function addBuilding(x, z, w, d, h, color) {
    // One material clone per building so the facade tint varies by district.
    const mat = wallMat.clone();
    mat.color.setHex(color);
    const mesh = new THREE.Mesh(buildingGeometry(w, h, d), mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    buildings.add(mesh);
    // Rooftop cap + the occasional AC unit.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 0.5, d * 0.94), roofMat);
    cap.position.set(x, h + 0.25, z);
    buildings.add(cap);
    if (rng() < 0.4) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.6), roofMat);
      ac.position.set(x + randRange(rng, -w / 4, w / 4), h + 1, z + randRange(rng, -d / 4, d / 4));
      buildings.add(ac);
    }
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  for (let ax = 0; ax < CITY.avenues.length - 1; ax += 1) {
    for (let sz = 0; sz < CITY.streets.length - 1; sz += 1) {
      const x0 = CITY.avenues[ax] + CITY.roadWidth / 2 + CITY.sidewalk;
      const x1 = CITY.avenues[ax + 1] - CITY.roadWidth / 2 - CITY.sidewalk;
      const z0 = CITY.streets[sz] + CITY.roadWidth / 2 + CITY.sidewalk;
      const z1 = CITY.streets[sz + 1] - CITY.roadWidth / 2 - CITY.sidewalk;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const district = DISTRICTS.find((d) => pointInBox(cx, cz, d));
      if (!district) continue;
      const style = DISTRICT_STYLE[district.kind];
      const bw = x1 - x0;
      const bd = z1 - z0;
      if (style.perBlock === 1) {
        addBuilding(cx, cz, bw * randRange(rng, 0.55, 0.8), bd * randRange(rng, 0.55, 0.8),
          randRange(rng, style.minH, style.maxH), pick(rng, style.colors));
      } else {
        const cols = style.perBlock >= 4 ? 2 : 2;
        const rows = Math.ceil(style.perBlock / cols);
        const cw = bw / cols;
        const cd = bd / rows;
        for (let c = 0; c < cols; c += 1) {
          for (let r = 0; r < rows; r += 1) {
            if (rng() < 0.12) continue; // occasional empty lot / plaza
            addBuilding(
              x0 + cw * (c + 0.5), z0 + cd * (r + 0.5),
              cw * randRange(rng, 0.62, 0.86), cd * randRange(rng, 0.62, 0.86),
              randRange(rng, style.minH, style.maxH), pick(rng, style.colors));
          }
        }
      }
    }
  }

  // Distant skyline silhouettes beyond the map edge, for depth at the horizon.
  const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x4a2a4d, fog: true });
  for (let i = 0; i < 26; i += 1) {
    const side = i % 3;
    const h = randRange(rng, 20, 70);
    const box = new THREE.Mesh(new THREE.BoxGeometry(randRange(rng, 14, 26), h, randRange(rng, 14, 26)), silhouetteMat);
    if (side === 0) box.position.set(randRange(rng, -220, 260), h / 2, -HALF - randRange(rng, 20, 70));
    else if (side === 1) box.position.set(randRange(rng, -220, 260), h / 2, HALF + randRange(rng, 20, 70));
    else box.position.set(HALF + randRange(rng, 20, 70), h / 2, randRange(rng, -220, 220));
    group.add(box);
  }

  // --- Palms (instanced trunks + instanced fronds) --------------------------------
  const palmSpots = [];
  for (let z = -230; z <= 230; z += 14) {
    if (rng() < 0.75) palmSpots.push({ x: CITY.beachX + randRange(rng, 3, 10), z: z + randRange(rng, -4, 4) });
  }
  for (const x of [-144, -48, 48, 144]) {
    for (let z = -220; z <= 220; z += 32) {
      if (rng() < 0.6) palmSpots.push({ x: x + CITY.roadWidth / 2 + 2.5, z });
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 7, 6);
  trunkGeo.translate(0, 3.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: PALETTE.palmTrunk, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const frondGeo = new THREE.PlaneGeometry(0.9, 4.2, 1, 3);
  frondGeo.translate(0, 2.1, 0);
  // Droop the frond tip downward.
  {
    const pos = frondGeo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      pos.setZ(i, -Math.pow(y / 4.2, 2) * 1.6);
    }
    frondGeo.computeVertexNormals();
  }
  const frondMat = new THREE.MeshStandardMaterial({ color: PALETTE.palmLeaf, roughness: 0.9, side: THREE.DoubleSide });
  const FRONDS = 7;
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, palmSpots.length * FRONDS);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  palmSpots.forEach((spot, i) => {
    const lean = randRange(rng, -0.1, 0.1);
    const tilt = randRange(rng, -0.08, 0.08);
    e.set(tilt, rng() * Math.PI * 2, lean);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(spot.x, 0, spot.z), q, one);
    trunks.setMatrixAt(i, m4);
    const top = new THREE.Vector3(spot.x + Math.sin(lean) * 7, 7, spot.z + Math.sin(tilt) * 7);
    for (let f = 0; f < FRONDS; f += 1) {
      e.set(-Math.PI / 2 + randRange(rng, 0.5, 1.0), (f / FRONDS) * Math.PI * 2 + rng() * 0.4, 0, 'YXZ');
      q.setFromEuler(e);
      m4.compose(top, q, one);
      fronds.setMatrixAt(i * FRONDS + f, m4);
    }
  });
  trunks.castShadow = true;
  fronds.castShadow = true;
  group.add(trunks);
  group.add(fronds);

  // --- Streetlights (instanced poles + heads) -------------------------------------
  const lightSpots = [];
  for (const x of CITY.avenues) {
    for (let z = -228; z <= 228; z += 24) lightSpots.push({ x: x + CITY.roadWidth / 2 + 1, z, flip: (Math.round(z) / 24) % 2 === 0 });
  }
  for (const z of CITY.streets) {
    for (let x = -228; x <= 228; x += 24) lightSpots.push({ x, z: z + CITY.roadWidth / 2 + 1, flip: (Math.round(x) / 24) % 2 === 0, along: true });
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 7, 5);
  poleGeo.translate(0, 3.5, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.6, metalness: 0.6 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lightSpots.length);
  const headGeo = new THREE.BoxGeometry(1.6, 0.18, 0.3);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, emissive: 0xffc46b, emissiveIntensity: 0.9 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lightSpots.length);
  lightSpots.forEach((spot, i) => {
    m4.compose(v3.set(spot.x, 0, spot.z), q.identity(), one);
    poles.setMatrixAt(i, m4);
    const arm = spot.along ? { dx: spot.flip ? -0.8 : 0.8, dz: 0 } : { dx: 0, dz: spot.flip ? -0.8 : 0.8 };
    e.set(0, spot.along ? 0 : Math.PI / 2, 0);
    q.setFromEuler(e);
    m4.compose(v3.set(spot.x + arm.dx, 7, spot.z + arm.dz), q, one);
    heads.setMatrixAt(i, m4);
  });
  group.add(poles);
  group.add(heads);

  // --- Harbor props: containers, cranes, boats, beach umbrellas -------------------
  const containerColors = [0xc9543a, 0x3a7ac9, 0x4fae62, 0xd9a441, 0x8a6ab0];
  const containerGeo = new THREE.BoxGeometry(6, 2.6, 2.4);
  const containers = new THREE.Group();
  for (let i = 0; i < 42; i += 1) {
    const mat = new THREE.MeshStandardMaterial({ color: pick(rng, containerColors), roughness: 0.8 });
    const box = new THREE.Mesh(containerGeo, mat);
    const x = randRange(rng, 8, 120);
    const z = randRange(rng, -232, -136);
    const stacked = rng() < 0.35;
    box.position.set(x, stacked ? 3.9 : 1.3, z);
    box.rotation.y = rng() < 0.5 ? 0 : Math.PI / 2;
    box.castShadow = true;
    box.receiveShadow = true;
    containers.add(box);
    if (!stacked) {
      const w = box.rotation.y === 0 ? 3 : 1.2;
      const d = box.rotation.y === 0 ? 1.2 : 3;
      colliders.push({ minX: x - w, maxX: x + w, minZ: z - d, maxZ: z + d });
    }
  }
  group.add(containers);

  const craneMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.7 });
  for (const cx of [24, 72, 112]) {
    const crane = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(1.2, 26, 1.2);
    for (const [lx, lz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
      const leg = new THREE.Mesh(legGeo, craneMat);
      leg.position.set(lx, 13, lz);
      leg.castShadow = true;
      crane.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 34), craneMat);
    beam.position.set(0, 27, -6);
    beam.castShadow = true;
    crane.add(beam);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), craneMat);
    cab.position.set(0, 25, 2);
    crane.add(cab);
    crane.position.set(cx, 0, -138);
    group.add(crane);
    colliders.push({ minX: cx - 5, maxX: cx + 5, minZ: -143, maxZ: -133 });
  }

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  for (let i = 0; i < 9; i += 1) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 7), hullMat);
    hull.position.y = 0.4;
    boat.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 4), poleMat);
    mast.position.y = 3.4;
    boat.add(mast);
    boat.position.set(CITY.oceanX - randRange(rng, 8, 60), 0.1, randRange(rng, -220, -80));
    boat.rotation.y = randRange(rng, 0, Math.PI * 2);
    group.add(boat);
  }

  const umbrellaMat = new THREE.MeshStandardMaterial({ color: 0xff5a7a, roughness: 0.9, side: THREE.DoubleSide });
  for (let i = 0; i < 22; i += 1) {
    const u = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4), poleMat);
    pole.position.y = 1.2;
    u.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 8), umbrellaMat);
    top.position.y = 2.6;
    top.castShadow = true;
    u.add(top);
    u.position.set(CITY.beachX + randRange(rng, 2, 14), 0, randRange(rng, -225, 225));
    group.add(u);
  }

  // --- Road network ---------------------------------------------------------------
  const nodes = [];
  const nodeId = new Map();
  CITY.avenues.forEach((x, ax) => {
    CITY.streets.forEach((z, sz) => {
      const id = nodes.length;
      nodeId.set(ax + ',' + sz, id);
      nodes.push({ id, x, z });
    });
  });
  const edges = [];
  const nStreets = CITY.streets.length;
  nodes.forEach((node, id) => {
    const ax = Math.floor(id / nStreets);
    const sz = id % nStreets;
    if (ax + 1 < CITY.avenues.length) edges.push({ a: id, b: nodeId.get((ax + 1) + ',' + sz) });
    if (sz + 1 < nStreets) edges.push({ a: id, b: nodeId.get(ax + ',' + (sz + 1)) });
  });
  const roadNetwork = { nodes, edges };

  const spawnPoints = {
    player: { x: -48, z: 120, heading: Math.PI },
    cars: [
      { x: -42, z: 96, heading: 0, model: 'marlin' },
      { x: -102, z: 48, heading: Math.PI / 2, model: 'faro' },
      { x: 54, z: -42, heading: Math.PI, model: 'duna' },
      { x: 6, z: 150, heading: -Math.PI / 2, model: 'cielo' },
      { x: -150, z: -102, heading: 0, model: 'tiburon' },
      { x: 102, z: 102, heading: Math.PI / 2, model: 'marlin' },
    ],
    missions: {
      m1: { x: -48, z: 144, heading: Math.PI },
      m2: { x: 48, z: -144, heading: 0 },
      m3: { x: -48, z: -144, heading: Math.PI / 2 },
      m4: { x: 48, z: 0, heading: Math.PI },
      m5: { x: -168, z: 48, heading: -Math.PI / 2 },
      m6: { x: 192, z: 96, heading: Math.PI },
    },
    policeStation: { x: 0, z: -48, heading: 0 },
    safehouse: { x: -48, z: 120, heading: Math.PI },
  };

  /** Keep the shadow camera centred on the action (call each frame with the player pos). */
  function followSun(x, z) {
    sun.target.position.set(x, 0, z);
    sun.position.set(x - 180, 90, z + 40);
    sun.target.updateMatrixWorld();
  }

  /** Animate the shoreline foam and the sun's glow. */
  function update(dt, time) {
    foamTex.offset.y = (time * 0.008) % 1;
    const pulse = 1 + Math.sin(time * 0.6) * 0.015;
    sunDisc.scale.set(pulse, pulse, 1);
  }

  function getDistrictAt(x, z) {
    for (const d of DISTRICTS) if (pointInBox(x, z, d)) return d.name;
    if (x < CITY.beachX) return 'Azura Bay';
    return 'Azura Bay';
  }

  function isOnRoad(x, z) {
    const half = CITY.roadWidth / 2 + 0.5;
    for (const ax of CITY.avenues) if (Math.abs(x - ax) <= half) return true;
    for (const sz of CITY.streets) if (Math.abs(z - sz) <= half) return true;
    return false;
  }

  return {
    group,
    sun,
    groundCanvas,
    seed,
    getRoadNetwork: () => roadNetwork,
    getSpawnPoints: () => spawnPoints,
    getDistrictAt,
    isOnRoad,
    getColliders: () => colliders,
    followSun,
    update,
    /** Nearest road-network node to a world position (for traffic/police routing). */
    nearestNode(x, z) {
      let best = nodes[0];
      let bestD = Infinity;
      for (const n of nodes) {
        const dx = n.x - x;
        const dz = n.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    },
  };
}

/** Clamp a world position inside the playable map (ocean edge included). */
export function clampToMap(x, z) {
  return {
    x: clamp(x, CITY.oceanX - 40, HALF - 4),
    z: clamp(z, -HALF + 4, HALF - 4),
  };
}

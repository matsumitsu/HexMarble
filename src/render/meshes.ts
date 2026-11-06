import * as THREE from 'three';
import { HEX_SIZE, LEVEL_HEIGHT, TRACK_Y } from '../core/constants';
import { hexCorner } from '../core/hex';
import { getPart, JUMP_RAMP, LOOP_RADIUS, SPIRAL_RADIUS, type PartType } from '../core/parts';
import type { Vec3 } from '../core/path';
import { AXIS_OFFSET, decksOf, DROP_HOLE_RADIUS, DROP_HOLE_RIM, GROOVE_RADIUS, holeRadius, plateTop, PLATE_TOP, surfaceHeight } from './tileSurface';

/** 土台の六角形の大きさ（隣のタイルとのすき間を少しあける） */
const PLATE_SIZE = HEX_SIZE * 0.97;
/** 上面の分割数（六角形を6つの三角形に分け、各辺をこの数で分割する） */
const SUBDIV = 24;

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: number, opts: { metal?: number; rough?: number; emissive?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.metal ?? 0}|${opts.rough ?? 0.6}|${opts.emissive ?? 0}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: opts.metal ?? 0,
      roughness: opts.rough ?? 0.6,
      emissive: opts.emissive ?? 0,
    });
    materialCache.set(key, m);
  }
  return m;
}

const metalMat = () => mat(0xdfe6ee, { metal: 0.85, rough: 0.25 });
const plateMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });

function shade(color: number, k: number): number {
  const c = new THREE.Color(color);
  c.multiplyScalar(k);
  return c.getHex();
}

export function hexShape(size: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    // Shape は XY 平面。後で X 軸まわりに -90° 回して XZ 平面にする（y → -z）
    const c = hexCorner(i, size);
    if (i === 0) s.moveTo(c.x, -c.z);
    else s.lineTo(c.x, -c.z);
  }
  s.closePath();
  return s;
}

/**
 * 土台の板を作る。上面は tileSurface の高さマップで、経路に沿ったハーフパイプを彫り込んだ形になる。
 * 六角形を中心から6つの三角形に分け、それぞれを細かい三角形の格子に分割して高さを与える。
 */
function buildPlateGeometry(type: PartType, deck = 0): THREE.BufferGeometry {
  const deckBase = deck * LEVEL_HEIGHT;
  const base = new THREE.Color(getPart(type).color);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const keyToIndex = new Map<string, number>();
  const xz: Array<[number, number]> = [];
  const corners = Array.from({ length: 7 }, (_, i) => hexCorner(i % 6, PLATE_SIZE));

  const vertex = (x: number, z: number): number => {
    const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)}`;
    let i = keyToIndex.get(key);
    if (i === undefined) {
      i = xz.length;
      xz.push([x, z]);
      keyToIndex.set(key, i);
    }
    return i;
  };

  // 上面の三角形格子
  const tris: Array<[number, number, number]> = [];
  for (let s = 0; s < 6; s++) {
    const c0 = corners[s];
    const c1 = corners[s + 1];
    const at = (i: number, j: number) => vertex((c0.x * i + c1.x * j) / SUBDIV, (c0.z * i + c1.z * j) / SUBDIV);
    for (let i = 0; i < SUBDIV; i++) {
      for (let j = 0; i + j < SUBDIV; j++) {
        tris.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
        if (i + j < SUBDIV - 1) tris.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
      }
    }
  }

  // 穴のある段：穴の中の三角形を除き、穴にかかる頂点を穴の縁に寄せる
  const hole = holeRadius(type, deck);
  const kept = hole
    ? tris.filter(([a, b, c]) => {
        const cx = (xz[a][0] + xz[b][0] + xz[c][0]) / 3;
        const cz = (xz[a][1] + xz[b][1] + xz[c][1]) / 3;
        return Math.hypot(cx, cz) >= hole;
      })
    : tris;
  if (hole) {
    for (const p of xz) {
      const r = Math.hypot(p[0], p[1]);
      if (r < hole && r > 1e-9) {
        p[0] *= hole / r;
        p[1] *= hole / r;
      }
    }
  }

  const tmp = new THREE.Color();
  const heightAt = (x: number, z: number) => {
    const h = surfaceHeight(type, x, z, deck);
    return Number.isNaN(h) ? deckBase + DROP_HOLE_RIM : h;
  };
  for (const [x, z] of xz) {
    const y = heightAt(x, z);
    pos.push(x, y, z);
    // 溝の中ほど少し暗くして、くぼみを見やすくする
    const depth = Math.min(1, Math.max(0, (plateTop(type, x, deck) - y) / 0.17));
    tmp.copy(base).multiplyScalar(1 - 0.38 * depth);
    col.push(tmp.r, tmp.g, tmp.b);
  }
  const pushTri = (a: number, b: number, c: number, wantY: number | null, want?: [number, number]) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const dot = wantY !== null ? ny * wantY : nx * want![0] + nz * want![1];
    if (dot >= 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  };
  for (const [a, b, c] of kept) pushTri(a, b, c, 1);

  // 側面：外周に沿って上面の高さから底面まで
  const side = new THREE.Color(base).multiplyScalar(0.62);
  const addVertex = (x: number, y: number, z: number, c: THREE.Color) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  for (let s = 0; s < 6; s++) {
    const c0 = corners[s];
    const c1 = corners[s + 1];
    const out: [number, number] = [(c0.x + c1.x) / 2, (c0.z + c1.z) / 2];
    for (let k = 0; k < SUBDIV; k++) {
      const x0 = c0.x + ((c1.x - c0.x) * k) / SUBDIV;
      const z0 = c0.z + ((c1.z - c0.z) * k) / SUBDIV;
      const x1 = c0.x + ((c1.x - c0.x) * (k + 1)) / SUBDIV;
      const z1 = c0.z + ((c1.z - c0.z) * (k + 1)) / SUBDIV;
      const a = addVertex(x0, heightAt(x0, z0), z0, side);
      const b = addVertex(x1, heightAt(x1, z1), z1, side);
      const a0 = addVertex(x0, deckBase, z0, side);
      const b0 = addVertex(x1, deckBase, z1, side);
      pushTri(a, a0, b, null, out);
      pushTri(b, a0, b0, null, out);
    }
  }

  // 底面
  const bottom = new THREE.Color(base).multiplyScalar(0.4);
  if (hole) {
    // 穴のあいた底面：穴の縁から外周まで
    const n = 48;
    for (let s = 0; s < 6; s++) {
      for (let k = 0; k < n / 6; k++) {
        const t0 = (s * n) / 6 + k;
        const a0 = (2 * Math.PI * t0) / n;
        const a1 = (2 * Math.PI * (t0 + 1)) / n;
        const ia = addVertex(hole * Math.cos(a0), deckBase, -hole * Math.sin(a0), bottom);
        const ib = addVertex(hole * Math.cos(a1), deckBase, -hole * Math.sin(a1), bottom);
        const outer = (a: number) => {
          // 角度 a の方向の六角形の外周
          const sector = Math.floor((a - Math.PI / 6 + 2 * Math.PI) / (Math.PI / 3)) % 6;
          const c0 = corners[sector];
          const c1 = corners[sector + 1];
          const dx = Math.cos(a);
          const dz = -Math.sin(a);
          const ex = c1.x - c0.x;
          const ez = c1.z - c0.z;
          const t = (c0.x * dz - c0.z * dx) / (ez * dx - ex * dz);
          return [c0.x + ex * t, c0.z + ez * t];
        };
        const [oax, oaz] = outer(a0);
        const [obx, obz] = outer(a1);
        const oa = addVertex(oax, deckBase, oaz, bottom);
        const ob = addVertex(obx, deckBase, obz, bottom);
        pushTri(ia, oa, ob, -1);
        pushTri(ia, ob, ib, -1);
      }
    }
  } else {
    const center = addVertex(0, deckBase, 0, bottom);
    for (let s = 0; s < 6; s++) {
      const a = addVertex(corners[s].x, deckBase, corners[s].z, bottom);
      const b = addVertex(corners[s + 1].x, deckBase, corners[s + 1].z, bottom);
      pushTri(center, a, b, -1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 経路をくり抜いた土台の板（坂はくさび形）。段が複数あるタイルはすべての段を作る */
function basePlate(type: PartType): THREE.Group {
  const g = new THREE.Group();
  for (const deck of decksOf(type)) {
    const m = new THREE.Mesh(buildPlateGeometry(type, deck), plateMat);
    m.receiveShadow = true;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** 穴の内壁 */
function holeWall(type: PartType, radius: number, y0: number, y1: number): THREE.Mesh {
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, y1 - y0, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: shade(getPart(type).color, 0.3), roughness: 0.7, side: THREE.DoubleSide }),
  );
  wall.position.y = (y0 + y1) / 2;
  return wall;
}

const troughMats = new Map<number, THREE.MeshStandardMaterial>();
function troughMat(color: number): THREE.MeshStandardMaterial {
  let m = troughMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: shade(color, 0.85), roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
    troughMats.set(color, m);
  }
  return m;
}

/**
 * 宙に浮いた区間のハーフパイプ（樋）。土台の溝と同じ半径の半円の断面を経路に沿って掃引する。
 * openDir は溝の開いている向き（ふつうは真上。ループでは輪の中心）。
 */
function troughMesh(points: Vec3[], color: number, openDir: (p: Vec3) => THREE.Vector3 = () => new THREE.Vector3(0, 1, 0)): THREE.Mesh {
  const K = 12;
  const inner = GROOVE_RADIUS;
  const outer = GROOVE_RADIUS + 0.045;
  const pos: number[] = [];
  const idx: number[] = [];
  const n = points.length;
  const P = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  for (let i = 0; i < n; i++) {
    const t = P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize();
    const up = openDir(points[i]).normalize();
    up.addScaledVector(t, -up.dot(t)).normalize();
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    const axis = P[i].clone().addScaledVector(up, AXIS_OFFSET);
    for (const rad of [inner, outer]) {
      for (let k = 0; k <= K; k++) {
        const a = (Math.PI * k) / K;
        const v = axis
          .clone()
          .addScaledVector(side, Math.cos(a) * rad)
          .addScaledVector(up, -Math.sin(a) * rad);
        pos.push(v.x, v.y, v.z);
      }
    }
  }
  const ring = 2 * (K + 1);
  const at = (i: number, layer: number, k: number) => i * ring + layer * (K + 1) + k;
  for (let i = 0; i < n - 1; i++) {
    for (let layer = 0; layer < 2; layer++) {
      for (let k = 0; k < K; k++) {
        const a = at(i, layer, k);
        const b = at(i + 1, layer, k);
        const c = at(i + 1, layer, k + 1);
        const d = at(i, layer, k + 1);
        idx.push(a, b, c, a, c, d);
      }
    }
    // 縁（内側と外側をつなぐ）
    for (const k of [0, K]) {
      const a = at(i, 0, k);
      const b = at(i + 1, 0, k);
      const c = at(i + 1, 1, k);
      const d = at(i, 1, k);
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, troughMat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 条件を満たす点が続く区間ごとに分ける（前後に1点ずつ重ねて、土台の溝と隙間なくつなぐ） */
function runs(points: Vec3[], keep: (p: Vec3) => boolean): Vec3[][] {
  const out: Vec3[][] = [];
  let cur: Vec3[] = [];
  points.forEach((p, i) => {
    if (keep(p)) {
      if (cur.length === 0 && i > 0) cur.push(points[i - 1]);
      cur.push(p);
    } else if (cur.length > 0) {
      cur.push(p);
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length > 1) out.push(cur);
  return out;
}

function post(x: number, z: number, y0: number, y1: number, radius = 0.035): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, y1 - y0, 10), metalMat());
  m.position.set(x, (y0 + y1) / 2, z);
  m.castShadow = true;
  return m;
}

/** 辺0の向きを示す小さな三角マーク（向きの確認用） */
function arrowMark(color: number, x: number): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0.1, 0);
  shape.lineTo(-0.06, 0.08);
  shape.lineTo(-0.06, -0.08);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat(color, { emissive: shade(color, 0.3) }));
  m.position.set(x, PLATE_TOP + 0.002, 0.42);
  return m;
}

type Builder = (g: THREE.Group) => void;

const BUILDERS: Record<PartType, Builder> = {
  start(g) {
    g.add(basePlate('start'));
    const color = getPart('start').color;
    // 発射台の背板と、押し出しバネを模した円柱
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.5), mat(color, { rough: 0.4 }));
    back.position.set(-0.72, PLATE_TOP + 0.17, 0);
    back.castShadow = true;
    g.add(back);
    const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 12), metalMat());
    plunger.rotation.z = Math.PI / 2;
    plunger.position.set(-0.615, TRACK_Y + 0.12, 0);
    g.add(plunger);
    for (const x of [0.12, 0.36]) {
      const m = arrowMark(color, x);
      m.position.z = 0.4;
      g.add(m);
    }
  },
  straight(g) {
    g.add(basePlate('straight'));
  },
  curve60(g) {
    g.add(basePlate('curve60'));
  },
  curve120(g) {
    g.add(basePlate('curve120'));
  },
  cross(g) {
    g.add(basePlate('cross'));
  },
  merge(g) {
    g.add(basePlate('merge'));
  },
  uturn(g) {
    g.add(basePlate('uturn'));
  },
  slope(g) {
    g.add(basePlate('slope'));
  },
  steep(g) {
    g.add(basePlate('steep'));
  },
  spiral(g) {
    g.add(basePlate('spiral'));
    const color = getPart('spiral').color;
    const pts = getPart('spiral').routes[0].points;
    for (const run of runs(pts, (p) => p.y > TRACK_Y + 0.07)) g.add(troughMesh(run, color));
    const top = 3 * LEVEL_HEIGHT;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(SPIRAL_RADIUS - GROOVE_RADIUS - 0.06, SPIRAL_RADIUS - GROOVE_RADIUS - 0.04, top - PLATE_TOP, 20), mat(shade(color, 0.7), { rough: 0.5 }));
    col.position.y = (top + PLATE_TOP) / 2;
    col.castShadow = true;
    g.add(col);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), mat(color, { emissive: shade(color, 0.3), rough: 0.3 }));
    cap.position.y = top;
    g.add(cap);
  },
  funnel(g) {
    g.add(basePlate('funnel'));
    g.add(holeWall('funnel', holeRadius('funnel'), 0, surfaceHeight('funnel', holeRadius('funnel'), 0)));
  },
  booster(g) {
    g.add(basePlate('booster'));
    const color = 0xffe066;
    for (const z of [-0.3, 0.3]) {
      for (const x of [-0.4, 0, 0.4]) {
        const m = arrowMark(color, x);
        m.position.z = z;
        g.add(m);
      }
    }
  },
  brake(g) {
    g.add(basePlate('brake'));
    const geo = new THREE.BoxGeometry(0.07, 0.014, 0.16);
    const dark = mat(0x222222, { rough: 0.8 });
    const light = mat(0xffd166, { rough: 0.6 });
    for (const z of [-0.33, 0.33]) {
      for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(geo, i % 2 ? dark : light);
        m.position.set(-0.45 + i * 0.15, PLATE_TOP + 0.007, z);
        g.add(m);
      }
    }
  },
  loop(g) {
    g.add(basePlate('loop'));
    const color = getPart('loop').color;
    const pts = getPart('loop').routes[0].points;
    const center = (p: Vec3) => new THREE.Vector3(0, TRACK_Y + LOOP_RADIUS, p.z);
    for (const run of runs(pts, (p) => p.y > TRACK_Y + 0.03)) {
      g.add(troughMesh(run, color, (p) => center(p).sub(new THREE.Vector3(p.x, p.y, p.z))));
    }
  },
  lift(g) {
    g.add(basePlate('lift'));
    const color = getPart('lift').color;
    const top = 2 * LEVEL_HEIGHT;
    g.add(holeWall('lift', holeRadius('lift', 2), top, top + DROP_HOLE_RIM));
    // 上の段を支える柱
    for (const a of [90, 150, 210, 270]) {
      const r = (a * Math.PI) / 180;
      g.add(post(0.75 * Math.cos(r), -0.75 * Math.sin(r), PLATE_TOP, top, 0.05));
    }
    // 昇降路のレール
    for (const [x, z] of [[0.15, 0.15], [0.15, -0.15], [-0.15, 0.15], [-0.15, -0.15]]) g.add(post(x, z, PLATE_TOP, top, 0.015));
    const car = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 20), mat(color, { emissive: shade(color, 0.3), rough: 0.4 }));
    car.name = 'liftCar';
    car.userData.y0 = PLATE_TOP - 0.02;
    car.userData.y1 = top + PLATE_TOP - 0.1;
    car.position.y = car.userData.y0;
    g.add(car);
  },
  jump(g) {
    g.add(basePlate('jump'));
    const { x0, radius, angle } = JUMP_RAMP;
    const lipX = x0 + radius * Math.sin(angle);
    const m = arrowMark(0xffffff, (lipX + 0.866) / 2);
    m.position.z = 0;
    g.add(m);
  },
  warp(g) {
    g.add(basePlate('warp'));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 10, 32), new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0x333333, roughness: 0.3 }));
    ring.name = 'portal';
    ring.rotation.y = Math.PI / 2;
    ring.position.set(0, TRACK_Y + 0.05, 0);
    g.add(ring);
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(0.17, 24),
      new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    core.name = 'portalCore';
    core.rotation.y = Math.PI / 2;
    core.position.copy(ring.position);
    g.add(core);
  },
  chime(g) {
    g.add(basePlate('chime'));
    const color = getPart('chime').color;
    const barY = 0.74;
    g.add(post(0, -0.32, PLATE_TOP, barY), post(0, 0.32, PLATE_TOP, barY));
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 10), metalMat());
    bar.rotation.x = Math.PI / 2;
    bar.position.y = barY;
    g.add(bar);
    const bell = new THREE.Group();
    bell.name = 'bell';
    bell.position.y = barY;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 14), mat(color, { metal: 0.8, rough: 0.2, emissive: shade(color, 0.15) }));
    tube.position.y = -0.13;
    tube.castShadow = true;
    bell.add(tube);
    g.add(bell);
  },
  seesaw(g) {
    g.add(basePlate('seesaw'));
    const color = getPart('seesaw').color;
    const px = 0.45;
    const py = 0.58;
    g.add(post(px, 0, PLATE_TOP, py, 0.03));
    const plank = new THREE.Group();
    plank.name = 'plank';
    plank.position.set(px, py, 0);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.9), mat(color, { rough: 0.4, emissive: shade(color, 0.2) }));
    beam.castShadow = true;
    plank.add(beam);
    for (const z of [-0.42, 0.42]) {
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), metalMat());
      cup.position.set(0, -0.005, z);
      plank.add(cup);
    }
    g.add(plank);
  },
  splitter(g) {
    g.add(basePlate('splitter'));
    const color = getPart('splitter').color;
    // 溝の合流点に立つ切り替え羽根
    const pivot = new THREE.Group();
    pivot.name = 'flipper';
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.035), mat(color, { rough: 0.3, emissive: shade(color, 0.25) }));
    vane.position.set(-0.15, 0, 0);
    vane.castShadow = true;
    pivot.add(vane);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10), metalMat());
    pivot.add(pin);
    pivot.position.set(-0.05, TRACK_Y + 0.02, 0);
    g.add(pivot);
  },
  drop(g) {
    g.add(basePlate('drop'));
    g.add(holeWall('drop', DROP_HOLE_RADIUS, 0, DROP_HOLE_RIM));
  },
  goal(g) {
    g.add(basePlate('goal'));
    const color = getPart('goal').color;
    // オリジナルの目印：細い柱の上で回る八面体（溝のない角の方向に立てる）
    const px = 0.62 * Math.cos(Math.PI / 6);
    const pz = -0.62 * Math.sin(Math.PI / 6);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), metalMat());
    pole.position.set(px, PLATE_TOP + 0.3, pz);
    g.add(pole);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), mat(color, { emissive: shade(color, 0.5), rough: 0.2, metal: 0.3 }));
    gem.name = 'gem';
    gem.userData.baseY = PLATE_TOP + 0.7;
    gem.position.set(px, gem.userData.baseY, pz);
    gem.castShadow = true;
    g.add(gem);
  },
};

const templates = new Map<PartType, THREE.Group>();

/** タイルのメッシュ（ローカル座標、底面 y = 0）。ジオメトリは種類ごとに共有する */
export function createPartMesh(type: PartType): THREE.Group {
  let t = templates.get(type);
  if (!t) {
    t = new THREE.Group();
    BUILDERS[type](t);
    templates.set(type, t);
  }
  return t.clone(true);
}

/** 半透明のゴースト表示用 */
export function createGhostMesh(type: PartType, material: THREE.Material): THREE.Group {
  const g = createPartMesh(type);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).material = material;
      o.castShadow = false;
    }
    if ((o as THREE.LineSegments).isLineSegments) o.visible = false;
  });
  return g;
}

import * as THREE from 'three';
import { HEX_SIZE, TRACK_Y } from '../core/constants';
import { hexCorner } from '../core/hex';
import { getPart, type PartType } from '../core/parts';
import { DROP_HOLE_RADIUS, DROP_HOLE_RIM, plateTop, PLATE_TOP, surfaceHeight } from './tileSurface';

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
function buildPlateGeometry(type: PartType): THREE.BufferGeometry {
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

  // 落下口：穴の中の三角形を除き、穴にかかる頂点を穴の縁に寄せる
  const hole = type === 'drop';
  const kept = hole
    ? tris.filter(([a, b, c]) => {
        const cx = (xz[a][0] + xz[b][0] + xz[c][0]) / 3;
        const cz = (xz[a][1] + xz[b][1] + xz[c][1]) / 3;
        return Math.hypot(cx, cz) >= DROP_HOLE_RADIUS;
      })
    : tris;
  if (hole) {
    for (const p of xz) {
      const r = Math.hypot(p[0], p[1]);
      if (r < DROP_HOLE_RADIUS && r > 1e-9) {
        p[0] *= DROP_HOLE_RADIUS / r;
        p[1] *= DROP_HOLE_RADIUS / r;
      }
    }
  }

  const tmp = new THREE.Color();
  const heightAt = (x: number, z: number) => {
    const h = surfaceHeight(type, x, z);
    return Number.isNaN(h) ? DROP_HOLE_RIM : h;
  };
  for (const [x, z] of xz) {
    const y = heightAt(x, z);
    pos.push(x, y, z);
    // 溝の中ほど少し暗くして、くぼみを見やすくする
    const depth = Math.min(1, Math.max(0, (plateTop(type, x) - y) / 0.17));
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
      const a0 = addVertex(x0, 0, z0, side);
      const b0 = addVertex(x1, 0, z1, side);
      pushTri(a, a0, b, null, out);
      pushTri(b, a0, b0, null, out);
    }
  }

  // 底面
  const bottom = new THREE.Color(base).multiplyScalar(0.4);
  const center = addVertex(0, 0, 0, bottom);
  for (let s = 0; s < 6; s++) {
    const a = addVertex(corners[s].x, 0, corners[s].z, bottom);
    const b = addVertex(corners[s + 1].x, 0, corners[s + 1].z, bottom);
    pushTri(center, a, b, -1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 経路をくり抜いた土台の板（坂はくさび形） */
function basePlate(type: PartType): THREE.Mesh {
  const m = new THREE.Mesh(buildPlateGeometry(type), plateMat);
  m.receiveShadow = true;
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
  slope(g) {
    g.add(basePlate('slope'));
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
    // 穴の内壁
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(DROP_HOLE_RADIUS, DROP_HOLE_RADIUS, DROP_HOLE_RIM, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: shade(getPart('drop').color, 0.3), roughness: 0.7, side: THREE.DoubleSide }),
    );
    wall.position.y = DROP_HOLE_RIM / 2;
    g.add(wall);
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

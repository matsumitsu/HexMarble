import * as THREE from 'three';
import { BALL_RADIUS, HEX_SIZE, LEVEL_HEIGHT, TRACK_Y } from '../core/constants';
import { hexCorner } from '../core/hex';
import { getPart, type PartType, type RouteDef } from '../core/parts';
import type { Vec3 } from '../core/path';

/** 球がレールに乗るときの、球の中心からレール中心までの距離 */
const RAIL_RADIUS = 0.032;
const RAIL_GAP = 0.085;
const RAIL_DROP = Math.sqrt((BALL_RADIUS + RAIL_RADIUS) ** 2 - RAIL_GAP ** 2);
const PLATE_H = 0.07;

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

const railMat = () => mat(0xdfe6ee, { metal: 0.85, rough: 0.25 });

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

/** 六角形の板（上面が y = height） */
function hexPlate(size: number, height: number, holeRadius = 0): THREE.BufferGeometry {
  const shape = hexShape(size);
  if (holeRadius > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.02, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}


/** ほぼ水平な区間ごとに分ける（落下口の縦穴などはレールを付けない） */
function horizontalRuns(points: Vec3[]): Vec3[][] {
  const runs: Vec3[][] = [];
  let cur: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const h = Math.hypot(b.x - a.x, b.z - a.z);
    const steep = Math.abs(b.y - a.y) > h * 1.5;
    if (steep) {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    } else {
      if (cur.length === 0) cur.push(a);
      cur.push(b);
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

function offsetPath(points: Vec3[], lateral: number, down: number): THREE.Vector3[] {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    return new THREE.Vector3(p.x - tz * lateral, p.y - down, p.z + tx * lateral);
  });
}

function tube(points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, 6, false);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

/** レールの下の帯（溝の底） */
function deck(points: Vec3[], width: number, down: number, material: THREE.Material): THREE.Mesh {
  const left = offsetPath(points, width / 2, down);
  const right = offsetPath(points, -width / 2, down);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    pos.push(left[i].x, left[i].y, left[i].z, right[i].x, right[i].y, right[i].z);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

/** 往復経路の片方だけを描く */
function uniqueRoutes(routes: RouteDef[]): RouteDef[] {
  const seen = new Set<string>();
  return routes.filter((r) => {
    const key = [String(r.from), String(r.to)].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addTrack(group: THREE.Group, type: PartType): void {
  const def = getPart(type);
  const deckMat = new THREE.MeshStandardMaterial({ color: shade(def.color, 0.75), roughness: 0.5, side: THREE.DoubleSide });
  for (const route of uniqueRoutes(def.routes)) {
    for (const run of horizontalRuns(route.points)) {
      group.add(tube(offsetPath(run, RAIL_GAP, RAIL_DROP), RAIL_RADIUS, railMat()));
      group.add(tube(offsetPath(run, -RAIL_GAP, RAIL_DROP), RAIL_RADIUS, railMat()));
      group.add(deck(run, 0.3, BALL_RADIUS + 0.03, deckMat));
      // 高い位置を通る部分には柱を立てる
      for (let i = 0; i < run.length; i += 6) {
        const p = run[i];
        const top = p.y - BALL_RADIUS - 0.03;
        if (top - PLATE_H > 0.12) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, top - PLATE_H, 8), mat(shade(def.color, 0.6)));
          post.position.set(p.x, PLATE_H + (top - PLATE_H) / 2, p.z);
          post.castShadow = true;
          group.add(post);
        }
      }
    }
  }
}

function basePlate(type: PartType, holeRadius = 0): THREE.Mesh {
  const def = getPart(type);
  const m = new THREE.Mesh(hexPlate(HEX_SIZE * 0.94, PLATE_H - 0.012, holeRadius), mat(shade(def.color, 0.45), { rough: 0.8 }));
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
  m.position.set(x, PLATE_H + 0.002, 0.42);
  return m;
}

type Builder = (g: THREE.Group) => void;

const BUILDERS: Record<PartType, Builder> = {
  start(g) {
    g.add(basePlate('start'));
    addTrack(g, 'start');
    const color = getPart('start').color;
    // 発射台の背板と、押し出しバネを模した円柱
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.5), mat(color, { rough: 0.4 }));
    back.position.set(-0.62, PLATE_H + 0.21, 0);
    back.castShadow = true;
    g.add(back);
    const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), railMat());
    plunger.rotation.z = Math.PI / 2;
    plunger.position.set(-0.5, TRACK_Y + 0.12, 0);
    g.add(plunger);
    for (const x of [0.1, 0.35]) g.add(arrowMark(color, x));
  },
  straight(g) {
    g.add(basePlate('straight'));
    addTrack(g, 'straight');
  },
  curve60(g) {
    g.add(basePlate('curve60'));
    addTrack(g, 'curve60');
  },
  curve120(g) {
    g.add(basePlate('curve120'));
    addTrack(g, 'curve120');
  },
  slope(g) {
    g.add(basePlate('slope'));
    addTrack(g, 'slope');
    // 高い側の壁
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.12, LEVEL_HEIGHT + 0.05, 0.42), mat(shade(getPart('slope').color, 0.6)));
    wall.position.set(0.82, PLATE_H + (LEVEL_HEIGHT + 0.05) / 2, 0);
    wall.castShadow = true;
    g.add(wall);
  },
  support(g) {
    const color = getPart('support').color;
    const h = LEVEL_HEIGHT - 0.01;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, h, 6, 1, false), mat(shade(color, 0.7), { rough: 0.85 }));
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: shade(color, 1.2) }));
    edges.position.copy(body.position);
    g.add(edges);
    // 側面の窓（軽量感を出すための装飾）
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.025, 6, 6), mat(shade(color, 1.1), { metal: 0.3 }));
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 6 + Math.PI / 2;
    ring.position.y = h * 0.5;
    g.add(ring);
  },
  splitter(g) {
    g.add(basePlate('splitter'));
    addTrack(g, 'splitter');
    const color = getPart('splitter').color;
    const pivot = new THREE.Group();
    pivot.name = 'flipper';
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.04), mat(color, { rough: 0.3, emissive: shade(color, 0.25) }));
    vane.position.set(-0.17, 0, 0);
    vane.castShadow = true;
    pivot.add(vane);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10), railMat());
    pivot.add(pin);
    pivot.position.set(-0.05, TRACK_Y + 0.12, 0);
    g.add(pivot);
  },
  drop(g) {
    g.add(basePlate('drop', 0.2));
    addTrack(g, 'drop');
    const color = getPart('drop').color;
    const pts = [
      new THREE.Vector2(0.17, PLATE_H - 0.01),
      new THREE.Vector2(0.2, TRACK_Y - 0.05),
      new THREE.Vector2(0.42, TRACK_Y + 0.06),
      new THREE.Vector2(0.46, TRACK_Y + 0.12),
    ];
    const funnel = new THREE.Mesh(
      new THREE.LatheGeometry(pts, 24),
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    );
    g.add(funnel);
  },
  goal(g) {
    g.add(basePlate('goal'));
    addTrack(g, 'goal');
    const color = getPart('goal').color;
    const pts = [
      new THREE.Vector2(0.0, PLATE_H),
      new THREE.Vector2(0.18, PLATE_H + 0.01),
      new THREE.Vector2(0.3, TRACK_Y),
      new THREE.Vector2(0.34, TRACK_Y + 0.06),
    ];
    const cup = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }));
    cup.receiveShadow = true;
    g.add(cup);
    // オリジナルの目印：細い柱の上で回る八面体
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8), railMat());
    pole.position.set(0.5, PLATE_H + 0.35, -0.5);
    g.add(pole);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), mat(color, { emissive: shade(color, 0.5), rough: 0.2, metal: 0.3 }));
    gem.name = 'gem';
    gem.position.set(0.5, PLATE_H + 0.8, -0.5);
    gem.castShadow = true;
    g.add(gem);
  },
};

const templates = new Map<PartType, THREE.Group>();

/** パーツのメッシュ（ローカル座標、底面 y = 0）。ジオメトリは種類ごとに共有する */
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

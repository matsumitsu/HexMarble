import { APOTHEM, HEX_SIZE } from './constants';

/**
 * 尖頂型（pointy-top）の六角形グリッド。アキシャル座標 (q, r) を使う。
 * 辺 i の外向き法線は、上から見て +X 軸から反時計回りに 60°×i（-Z 方向を画面上とする）。
 *   0: 東 (+1, 0)   1: 北東 (+1, -1)   2: 北西 (0, -1)
 *   3: 西 (-1, 0)   4: 南西 (-1, +1)   5: 南東 (0, +1)
 */
export type Side = 0 | 1 | 2 | 3 | 4 | 5;

export const SIDES: readonly Side[] = [0, 1, 2, 3, 4, 5];

export const AXIAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export interface Axial {
  q: number;
  r: number;
}

export function cellKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function neighbor(q: number, r: number, side: Side): Axial {
  const [dq, dr] = AXIAL_DIRS[side];
  return { q: q + dq, r: r + dr };
}

export function mod6(n: number): number {
  return ((n % 6) + 6) % 6;
}

export function oppositeSide(side: Side): Side {
  return mod6(side + 3) as Side;
}

export function rotateSide(side: Side, rot: number): Side {
  return mod6(side + rot) as Side;
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function cellsInRadius(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q, r });
    }
  }
  return out;
}

export function axialToWorld(q: number, r: number): { x: number; z: number } {
  return {
    x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    z: HEX_SIZE * 1.5 * r,
  };
}

export function worldToAxial(x: number, z: number): Axial {
  const fq = ((Math.sqrt(3) / 3) * x - z / 3) / HEX_SIZE;
  const fr = ((2 / 3) * z) / HEX_SIZE;
  return axialRound(fq, fr);
}

function axialRound(fq: number, fr: number): Axial {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

/** 辺の中点（ローカル座標、XZ） */
export function edgeMidpoint(side: number): { x: number; z: number } {
  const a = (side * Math.PI) / 3;
  return { x: APOTHEM * Math.cos(a), z: -APOTHEM * Math.sin(a) };
}

/** 頂点（ローカル座標、XZ）。頂点 i は辺 i と辺 i+1 の間 */
export function hexCorner(i: number, size = HEX_SIZE): { x: number; z: number } {
  const a = ((30 + 60 * i) * Math.PI) / 180;
  return { x: size * Math.cos(a), z: -size * Math.sin(a) };
}

/** Y 軸まわりに 60°×rot 回転（Three.js の rotation.y と同じ向き） */
export function rotateXZ(x: number, z: number, rot: number): { x: number; z: number } {
  const a = (mod6(rot) * Math.PI) / 3;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c + z * s, z: -x * s + z * c };
}

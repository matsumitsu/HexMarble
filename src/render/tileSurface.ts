import { APOTHEM, BALL_RADIUS, HEX_SIZE, LEVEL_HEIGHT, TRACK_Y } from '../core/constants';

const HEX_CIRCUMRADIUS = HEX_SIZE;
import { FUNNEL_HOLE_RADIUS, funnelBallY, getPart, jumpBallY, type PartType } from '../core/parts';

/**
 * タイルの土台の上面形状（高さマップ）。Three.js に依存しない純粋な計算なので単体テストできる。
 * 座標はタイルのローカル座標（回転前、底面 y = 0、辺0 が +X 方向）。
 */

/** 1レベル分のタイルの土台の厚み（占有する高さの半分） */
export const PLATE_TOP = LEVEL_HEIGHT / 2;
/**
 * ハーフパイプの半径。パイプの中心軸を土台の上面に置き、
 * マーブル（中心が経路上）がちょうど溝の底に接するように決める。
 */
export const GROOVE_RADIUS = BALL_RADIUS + (PLATE_TOP - TRACK_Y);
/** 経路の点から、ハーフパイプの中心軸までの高さ */
export const AXIS_OFFSET = PLATE_TOP - TRACK_Y;

export const DROP_HOLE_RADIUS = 0.19;
const FUNNEL_RADIUS = 0.36;
const FUNNEL_BOTTOM = 0.09;

const BOWL_RADIUS = 0.28;
/** ゴールのくぼみの底がマーブルの下端と一致するように球の中心を置く */
const BOWL_CENTER_Y = TRACK_Y - BALL_RADIUS + BOWL_RADIUS;

interface Segment {
  ax: number;
  az: number;
  ay: number;
  dx: number;
  dz: number;
  dy: number;
  len2: number;
}

const segmentCache = new Map<PartType, Segment[]>();

/**
 * 土台の板の段（タイルの設置レベルからの相対レベル）。
 * ほとんどのタイルは底の1枚だけ。リフトは上の出口の高さにもう1枚ある
 */
const DECKS: Partial<Record<PartType, number[]>> = { lift: [0, 2] };

export function decksOf(type: PartType): number[] {
  return DECKS[type] ?? [0];
}

/** 段の中央にあけた穴の半径（なければ 0） */
export function holeRadius(type: PartType, deck = 0): number {
  if (type === 'drop' && deck === 0) return DROP_HOLE_RADIUS;
  if (type === 'funnel' && deck === 0) return FUNNEL_HOLE_RADIUS;
  if (type === 'lift' && deck === 2) return LIFT_HOLE_RADIUS;
  return 0;
}

export const LIFT_HOLE_RADIUS = 0.2;

/** すべての経路の線分（XZ 平面上の距離で溝を彫る） */
function segmentsOf(type: PartType): Segment[] {
  let segs = segmentCache.get(type);
  if (segs) return segs;
  segs = [];
  for (const route of getPart(type).routes) {
    const pts = route.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      // 垂直な区間（リフト・落下口の縦穴）は溝を彫らない
      if (dx * dx + dz * dz < 1e-12) continue;
      segs.push({ ax: a.x, az: a.z, ay: a.y, dx, dz, dy: b.y - a.y, len2: dx * dx + dz * dz });
    }
  }
  segmentCache.set(type, segs);
  return segs;
}

/**
 * 彫る前の土台の上面。坂・急坂は辺0（高い側）へ向かって上がるくさび形。
 * ジャンプ台は踏み切りの円弧に沿って盛り上がり、踏み切りの先で元の高さに戻る
 */
export function plateTop(type: PartType, x: number, deck = 0): number {
  const base = PLATE_TOP + deck * LEVEL_HEIGHT;
  if (type === 'slope') return base + (LEVEL_HEIGHT * (x + APOTHEM)) / (2 * APOTHEM);
  if (type === 'steep') return base + (2 * LEVEL_HEIGHT * (x + APOTHEM)) / (2 * APOTHEM);
  if (type === 'jump') {
    const y = jumpBallY(x);
    if (!Number.isNaN(y)) return y + AXIS_OFFSET;
  }
  return base;
}

/** 漏斗のすり鉢の面：マーブルの通り道に沿って中心へ下がり、角のほうは土台の上面まで上がる */
function funnelSurface(r: number): number {
  if (r <= APOTHEM) return funnelBallY(r) - BALL_RADIUS;
  const edgeY = funnelBallY(APOTHEM) - BALL_RADIUS;
  return Math.min(PLATE_TOP, edgeY + ((r - APOTHEM) / (HEX_CIRCUMRADIUS - APOTHEM)) * (PLATE_TOP - edgeY) * 1.15);
}

/** 土台の上面の高さ（deck は段）。穴の中では NaN */
export function surfaceHeight(type: PartType, x: number, z: number, deck = 0): number {
  const r = Math.hypot(x, z);
  const hole = holeRadius(type, deck);
  if (hole > 0 && r < hole - 1e-6) return NaN;
  if (type === 'funnel') return funnelSurface(r);
  let top = plateTop(type, x, deck);
  const deckBase = deck * LEVEL_HEIGHT;

  for (const s of segmentsOf(type)) {
    // 下の段を通る経路は上の段を彫らない
    if (Math.max(s.ay, s.ay + s.dy) < deckBase) continue;
    let t = s.len2 > 0 ? ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = s.ax + s.dx * t - x;
    const ez = s.az + s.dz * t - z;
    const d2 = ex * ex + ez * ez;
    if (d2 >= GROOVE_RADIUS * GROOVE_RADIUS) continue;
    const h = s.ay + s.dy * t + AXIS_OFFSET - Math.sqrt(GROOVE_RADIUS * GROOVE_RADIUS - d2);
    if (h < top) top = h;
  }

  if (type === 'goal' && r < BOWL_RADIUS) {
    top = Math.min(top, BOWL_CENTER_Y - Math.sqrt(BOWL_RADIUS * BOWL_RADIUS - r * r));
  }
  if (type === 'drop') {
    if (r < FUNNEL_RADIUS) {
      const k = (FUNNEL_RADIUS - r) / (FUNNEL_RADIUS - DROP_HOLE_RADIUS);
      top = Math.min(top, PLATE_TOP - k * (PLATE_TOP - FUNNEL_BOTTOM));
    }
  }
  return top;
}

/** 落下口の穴の縁の高さ（穴の内壁を作るのに使う） */
export const DROP_HOLE_RIM = FUNNEL_BOTTOM;

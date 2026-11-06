import { APOTHEM, LEVEL_HEIGHT, TRACK_Y } from './constants';
import { edgeMidpoint, type Side } from './hex';
import { dist, joinPaths, lineSegment, quadBezier, v3, type Vec3 } from './path';

/** 接続口の位置。0〜5 は六角形の辺、'up' は上面中央、'down' は底面中央 */
export type PortId = Side | 'up' | 'down';

export interface PortDef {
  /** 接続口の位置（回転前のローカル） */
  id: PortId;
  /** 接続口の高さ（タイルの設置レベルからの相対レベル） */
  h: number;
}

export interface RouteDef {
  /** 入口。'start' はスタートタイルの発射位置、'warp' は組になったワープから出てくる位置 */
  from: PortId | 'start' | 'warp';
  /**
   * 出口。'goal' はゴールでマーブルを受け止める位置、'air' は経路の終端から宙へ飛び出す（ジャンプ台）、
   * 'warp' は組になったワープへ移る
   */
  to: PortId | 'goal' | 'air' | 'warp';
  /** マーブルの中心が通る経路点列（回転前のローカル座標。y はタイル底面からの高さ） */
  points: Vec3[];
  /** この経路の上では、速度を speed へ accel の割合で近づける（加速台・減速帯） */
  drive?: { speed: number; accel: number };
  /** この経路の上では、重力と減衰に関係なく一定の速さで運ぶ（リフト） */
  conveyor?: number;
  /**
   * 宙返りの区間（経路の弧長に対する割合 from〜to）。
   * 区間内で遠心力が重力に負けると、マーブルは経路から離れて落ちる
   */
  loop?: { from: number; to: number; radius: number; bottomY: number };
}

export type PartType =
  | 'start'
  | 'straight'
  | 'curve60'
  | 'curve120'
  | 'cross'
  | 'merge'
  | 'uturn'
  | 'slope'
  | 'steep'
  | 'spiral'
  | 'funnel'
  | 'booster'
  | 'brake'
  | 'loop'
  | 'lift'
  | 'jump'
  | 'warp'
  | 'chime'
  | 'seesaw'
  | 'splitter'
  | 'drop'
  | 'goal';

export interface PartDef {
  type: PartType;
  /** 表示名 */
  name: string;
  /** 短い説明（パレットのツールチップ） */
  description: string;
  /** テーマ色 */
  color: number;
  /** 占有するレベル数（積み上げ方向の高さ） */
  span: number;
  ports: PortDef[];
  /**
   * 経路。同じ from を持つ経路が複数ある場合、マーブルが通るたびに交互に選ばれる（分岐）。
   */
  routes: RouteDef[];
  /** コースに1つだけ置ける */
  unique?: boolean;
  /** ジャンプ台から飛んできたマーブルを上面で受け止められる半径（up の接続口を持つタイル） */
  catchRadius?: number;
  /** マーブルが通ると音が鳴る */
  chime?: boolean;
}

const SAMPLES = 24;

/** 接続口のローカル位置（マーブルの中心が通過する点） */
export function portLocalPosition(port: PortDef): Vec3 {
  if (port.id === 'up' || port.id === 'down') return v3(0, port.h * LEVEL_HEIGHT, 0);
  const m = edgeMidpoint(port.id);
  return v3(m.x, port.h * LEVEL_HEIGHT + TRACK_Y, m.z);
}

const edge = (side: Side, h = 0): Vec3 => portLocalPosition({ id: side, h });
const center = (h = 0): Vec3 => v3(0, h * LEVEL_HEIGHT + TRACK_Y, 0);

/** 中心を制御点とするベジェで辺 a から辺 b へ（直線・カーブ共通） */
function edgeToEdge(a: Side, b: Side, ha = 0, hb = 0): Vec3[] {
  const pa = edge(a, ha);
  const pb = edge(b, hb);
  const c = center((ha + hb) / 2);
  return quadBezier(pa, c, pb, SAMPLES);
}

const reverse = (pts: Vec3[]): Vec3[] => [...pts].reverse();

/** 往復できる経路を両方向とも定義する */
function twoWay(a: Side, b: Side, pts: Vec3[]): RouteDef[] {
  return [
    { from: a, to: b, points: pts },
    { from: b, to: a, points: reverse(pts) },
  ];
}

/**
 * 辺0から入り、タイルの中で輪を描いて辺0へ戻る涙形の経路。
 * 辺の中点から円への接線2本と、円の奥側の弧でできる。
 */
function teardrop(): Vec3[] {
  const R = 0.42;
  const cx = -0.12;
  const alpha = Math.acos(R / (APOTHEM - cx));
  const arcN = 36;
  const at = (a: number) => v3(cx + R * Math.cos(a), TRACK_Y, R * Math.sin(a));
  const arc: Vec3[] = [];
  for (let i = 1; i < arcN; i++) arc.push(at(alpha + ((2 * Math.PI - 2 * alpha) * i) / arcN));
  return [...lineSegment(edge(0), at(alpha), 8), ...arc, ...lineSegment(at(-alpha), edge(0), 8)];
}

function cubicBezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push(v3(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y, a * p0.z + b * p1.z + c * p2.z + d * p3.z));
  }
  return out;
}

const add = (a: Vec3, x: number, y: number, z: number): Vec3 => v3(a.x + x, a.y + y, a.z + z);

/** 点列の先頭から index 番目の点までの弧長 */
function arcLengthTo(pts: Vec3[], index: number): number {
  let s = 0;
  for (let i = 1; i <= index; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** 螺旋の中心軸からの半径 */
export const SPIRAL_RADIUS = 0.42;

/**
 * 螺旋：辺0（レベル2）から入り、中心の柱のまわりを1と1/4周しながら下り、辺2（レベル0）へ出る。
 */
function spiralPath(): Vec3[] {
  const R = SPIRAL_RADIUS;
  const top = 2 * LEVEL_HEIGHT + TRACK_Y;
  const bottom = TRACK_Y;
  const e0 = edge(0, 2);
  const e2 = edge(2, 0);
  const a0 = Math.PI / 2;
  const a1 = a0 + 2.5 * Math.PI;
  const helixAt = (a: number, y: number) => v3(R * Math.cos(a), y, R * Math.sin(a));
  const h0 = helixAt(a0, top);
  const h1 = helixAt(a1, bottom);
  const leadIn = cubicBezier(e0, add(e0, -0.3, 0, 0), add(h0, 0.3, 0, 0), h0, 12);
  const n = 72;
  const helix: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    helix.push(helixAt(a0 + (a1 - a0) * t, top + (bottom - top) * t));
  }
  const out = Math.PI * (2 / 3);
  const leadOut = cubicBezier(h1, add(h1, 0, 0, -0.25), add(e2, -0.25 * Math.cos(out), 0, 0.25 * Math.sin(out)), e2, 10);
  return joinPaths(leadIn, helix, leadOut);
}

/** 漏斗の穴の半径と、漏斗の面の上でのマーブルの中心の高さ（中心からの距離 r の関数） */
export const FUNNEL_HOLE_RADIUS = 0.19;
const FUNNEL_INNER = 0.26;
export function funnelBallY(r: number): number {
  return TRACK_Y - ((APOTHEM - r) / (APOTHEM - FUNNEL_INNER)) * 0.05;
}

/** 漏斗：辺 side から入り、すり鉢の面を回りながら中心の穴へ落ちる */
function funnelPath(side: Side): Vec3[] {
  const a0 = (side * Math.PI) / 3;
  const sweep = (Math.PI * 200) / 180;
  const n = 36;
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = FUNNEL_INNER + (APOTHEM - FUNNEL_INNER) * Math.pow(1 - t, 1.6);
    const a = a0 + sweep * t;
    pts.push(v3(r * Math.cos(a), funnelBallY(r), -r * Math.sin(a)));
  }
  pts[0] = edge(side);
  const last = pts[pts.length - 1];
  return joinPaths(pts, lineSegment(last, v3(0, last.y - 0.04, 0), 4), lineSegment(v3(0, last.y - 0.04, 0), v3(0, 0, 0), 4));
}

/** ループの半径と、ループの横ずれ（入口と出口の溝が重ならないようにずらす） */
export const LOOP_RADIUS = 0.3;
const LOOP_SHIFT = 0.42;

/** ループ：辺3から入り、縦に一回転して辺0へ抜ける。宙返りの区間の範囲も返す */
function loopPath(): { points: Vec3[]; from: number; to: number } {
  const R = LOOP_RADIUS;
  const entry = lineSegment(edge(3), v3(0, TRACK_Y, 0), 12);
  const n = 56;
  const loop: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const phi = (2 * Math.PI * i) / n;
    loop.push(v3(R * Math.sin(phi), TRACK_Y + R * (1 - Math.cos(phi)), (LOOP_SHIFT * i) / n));
  }
  const exit: Vec3[] = [];
  const m = 16;
  for (let i = 0; i <= m; i++) {
    const t = i / m;
    const k = t * t * (3 - 2 * t);
    exit.push(v3(APOTHEM * t, TRACK_Y, LOOP_SHIFT * (1 - k)));
  }
  const points = joinPaths(entry, loop, exit);
  const total = arcLengthTo(points, points.length - 1);
  const i0 = entry.length - 1;
  const i1 = i0 + n;
  return { points, from: arcLengthTo(points, i0) / total, to: arcLengthTo(points, i1) / total };
}

/** ジャンプ台の踏み切りの円弧（中心と半径）と、飛び出す角度 */
export const JUMP_RAMP = { x0: -0.2, radius: 0.7, angle: (40 * Math.PI) / 180 };

/** ジャンプ台の踏み切り面の上でのマーブルの中心の高さ（x の関数。範囲外は NaN） */
export function jumpBallY(x: number): number {
  const { x0, radius, angle } = JUMP_RAMP;
  const x1 = x0 + radius * Math.sin(angle);
  if (x < x0 || x > x1 + 1e-9) return NaN;
  return TRACK_Y + radius - Math.sqrt(radius * radius - (x - x0) * (x - x0));
}

function jumpPath(): Vec3[] {
  const { x0, radius, angle } = JUMP_RAMP;
  const n = 16;
  const ramp: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (angle * i) / n;
    ramp.push(v3(x0 + radius * Math.sin(a), TRACK_Y + radius * (1 - Math.cos(a)), 0));
  }
  return joinPaths(lineSegment(edge(3), v3(x0, TRACK_Y, 0), 10), ramp);
}

/** リフトの運ぶ速さ */
export const LIFT_SPEED = 1.3;

const sidePorts = (sides: Side[], h = 0): PortDef[] => sides.map((id) => ({ id, h }));

const ALL_SIDES: Side[] = [0, 1, 2, 3, 4, 5];

export const PARTS: Record<PartType, PartDef> = {
  start: {
    type: 'start',
    name: 'スタート',
    description: 'マーブルの発射台。辺0（矢印の向き）へ初速つきでマーブルを送り出す',
    color: 0xf2a541,
    span: 1,
    ports: sidePorts([0]),
    routes: [
      {
        from: 'start',
        to: 0,
        points: joinPaths(lineSegment(v3(-0.45, TRACK_Y + 0.12, 0), v3(0, TRACK_Y, 0), 8), lineSegment(center(), edge(0), 8)),
      },
    ],
    unique: true,
  },
  straight: {
    type: 'straight',
    name: '直線',
    description: '向かい合う辺どうしをつなぐ',
    color: 0x3fb8af,
    span: 1,
    ports: sidePorts([0, 3]),
    routes: twoWay(0, 3, edgeToEdge(0, 3)),
  },
  curve60: {
    type: 'curve60',
    name: 'カーブ60°',
    description: '進行方向を60°変える緩やかなカーブ',
    color: 0x5aa9e6,
    span: 1,
    ports: sidePorts([0, 2]),
    routes: twoWay(0, 2, edgeToEdge(0, 2)),
  },
  curve120: {
    type: 'curve120',
    name: 'カーブ120°',
    description: '進行方向を120°変える急なカーブ',
    color: 0x7f7eff,
    span: 1,
    ports: sidePorts([0, 1]),
    routes: twoWay(0, 1, edgeToEdge(0, 1)),
  },
  cross: {
    type: 'cross',
    name: '交差',
    description: '2本の直線が交わる。どちらの向きから入っても、反対側へまっすぐ抜ける',
    color: 0x80ed99,
    span: 1,
    ports: sidePorts([0, 2, 3, 5]),
    routes: [...twoWay(0, 3, edgeToEdge(0, 3)), ...twoWay(2, 5, edgeToEdge(2, 5))],
  },
  merge: {
    type: 'merge',
    name: '合流',
    description: '辺2・辺3・辺4のどこから入ったマーブルも、辺0へまとめて送り出す（一方通行）',
    color: 0xff8c61,
    span: 1,
    ports: sidePorts([0, 2, 3, 4]),
    routes: [
      { from: 2, to: 0, points: edgeToEdge(2, 0) },
      { from: 3, to: 0, points: edgeToEdge(3, 0) },
      { from: 4, to: 0, points: edgeToEdge(4, 0) },
    ],
  },
  uturn: {
    type: 'uturn',
    name: 'Uターン',
    description: '辺0から入ったマーブルを、タイルの中で一周させて同じ辺へ送り返す',
    color: 0xff99c8,
    span: 1,
    ports: sidePorts([0]),
    routes: [{ from: 0, to: 0, points: teardrop() }],
  },
  slope: {
    type: 'slope',
    name: '坂',
    description: '1レベル下る（辺0が高い側、辺3が低い側）。2レベル分の高さを占める',
    color: 0x9bc53d,
    span: 2,
    ports: [
      { id: 0, h: 1 },
      { id: 3, h: 0 },
    ],
    routes: twoWay(0, 3, lineSegment(edge(0, 1), edge(3, 0), SAMPLES)),
  },
  steep: {
    type: 'steep',
    name: '急坂',
    description: '2レベル一気に下る（辺0が高い側、辺3が低い側）。3レベル分の高さを占める',
    color: 0x6a994e,
    span: 3,
    ports: [
      { id: 0, h: 2 },
      { id: 3, h: 0 },
    ],
    routes: twoWay(0, 3, lineSegment(edge(0, 2), edge(3, 0), SAMPLES)),
  },
  spiral: {
    type: 'spiral',
    name: '螺旋',
    description: '辺0（高い側）から入り、柱のまわりを回りながら2レベル下って辺2へ出る。3レベル分の高さを占める',
    color: 0x48cae4,
    span: 3,
    ports: [
      { id: 0, h: 2 },
      { id: 2, h: 0 },
    ],
    routes: twoWay(0, 2, spiralPath()),
  },
  funnel: {
    type: 'funnel',
    name: '漏斗',
    description: 'どの辺から入ったマーブルも、すり鉢を回って真下のタイルへ落とす。ジャンプ台から飛んできたマーブルも広く受け止める',
    color: 0x9d4edd,
    span: 1,
    ports: [...sidePorts(ALL_SIDES), { id: 'up', h: 1 }, { id: 'down', h: 0 }],
    routes: [
      ...ALL_SIDES.map((s): RouteDef => ({ from: s, to: 'down', points: funnelPath(s) })),
      { from: 'up', to: 'down', points: lineSegment(v3(0, LEVEL_HEIGHT, 0), v3(0, 0, 0), 6) },
    ],
    catchRadius: 0.72,
  },
  booster: {
    type: 'booster',
    name: '加速台',
    description: '辺3から辺0（矢印の向き）へ通るマーブルを加速する。逆向きに入ると押し戻される',
    color: 0xff5400,
    span: 1,
    ports: sidePorts([0, 3]),
    routes: [
      { from: 3, to: 0, points: edgeToEdge(3, 0), drive: { speed: 5, accel: 7 } },
      { from: 0, to: 3, points: edgeToEdge(0, 3), drive: { speed: 0, accel: 7 } },
    ],
  },
  brake: {
    type: 'brake',
    name: '減速帯',
    description: '速すぎるマーブルを、止まらない程度の速さまで落ち着かせる',
    color: 0xc9a227,
    span: 1,
    ports: sidePorts([0, 3]),
    routes: twoWay(0, 3, edgeToEdge(0, 3)).map((r) => ({ ...r, drive: { speed: 1.2, accel: 8 } })),
  },
  loop: (() => {
    const { points, from, to } = loopPath();
    const loop = { radius: LOOP_RADIUS, bottomY: TRACK_Y };
    return {
      type: 'loop',
      name: 'ループ',
      description: '縦に一回転する。てっぺんで速さが足りないと落ちる。2レベル分の高さを占める',
      color: 0xf72585,
      span: 2,
      ports: sidePorts([0, 3]),
      routes: [
        { from: 3, to: 0, points, loop: { ...loop, from, to } },
        { from: 0, to: 3, points: reverse(points), loop: { ...loop, from: 1 - to, to: 1 - from } },
      ],
    } satisfies PartDef;
  })(),
  lift: {
    type: 'lift',
    name: 'リフト',
    description: '辺3（レベル0）から入ったマーブルを、一定の速さで2レベル持ち上げて辺0へ送り出す（一方通行）。3レベル分の高さを占める',
    color: 0x52b788,
    span: 3,
    ports: [
      { id: 3, h: 0 },
      { id: 0, h: 2 },
    ],
    routes: [
      {
        from: 3,
        to: 0,
        points: joinPaths(
          lineSegment(edge(3), center(), 10),
          lineSegment(center(), center(2), 10),
          lineSegment(center(2), edge(0, 2), 10),
        ),
        conveyor: LIFT_SPEED,
      },
    ],
  },
  jump: {
    type: 'jump',
    name: 'ジャンプ台',
    description: '辺3から入ったマーブルを、矢印の向きへ放物線で飛ばす。上に受け口のあるタイル（漏斗・ゴール・落下口・分岐）に入れば着地できる',
    color: 0xff9f1c,
    span: 1,
    ports: sidePorts([3]),
    routes: [{ from: 3, to: 'air', points: jumpPath() }],
  },
  warp: {
    type: 'warp',
    name: 'ワープ',
    description: '置いた順に2つずつ組になる。辺0から入ったマーブルは、組の相手の辺0から同じ速さで出てくる',
    color: 0x4361ee,
    span: 1,
    ports: sidePorts([0]),
    routes: [
      { from: 0, to: 'warp', points: lineSegment(edge(0), center(), 12) },
      { from: 'warp', to: 0, points: lineSegment(center(), edge(0), 12) },
    ],
  },
  chime: {
    type: 'chime',
    name: 'チャイム',
    description: 'マーブルが通ると音が鳴る直線。置いた高さで音程が変わる',
    color: 0xe9c46a,
    span: 1,
    ports: sidePorts([0, 3]),
    routes: twoWay(0, 3, edgeToEdge(0, 3)),
    chime: true,
  },
  seesaw: {
    type: 'seesaw',
    name: 'シーソー',
    description: '辺3から入ったマーブルを、低く傾いた側（辺1か辺5）へ送る。マーブルの重みで傾きが入れ替わる',
    color: 0xb5838d,
    span: 1,
    ports: sidePorts([1, 3, 5]),
    routes: [
      { from: 3, to: 1, points: edgeToEdge(3, 1) },
      { from: 3, to: 5, points: edgeToEdge(3, 5) },
      { from: 1, to: 3, points: edgeToEdge(1, 3) },
      { from: 5, to: 3, points: edgeToEdge(5, 3) },
    ],
  },
  splitter: {
    type: 'splitter',
    name: '分岐',
    description: '辺0または上から入ったマーブルを、通るたびに辺2と辺4へ交互に振り分ける',
    color: 0xe55381,
    span: 1,
    ports: [...sidePorts([0, 2, 4]), { id: 'up', h: 1 }],
    catchRadius: 0.3,
    routes: [
      { from: 0, to: 2, points: edgeToEdge(0, 2) },
      { from: 0, to: 4, points: edgeToEdge(0, 4) },
      { from: 'up', to: 2, points: quadBezier(v3(0, LEVEL_HEIGHT, 0), center(), edge(2), SAMPLES) },
      { from: 'up', to: 4, points: quadBezier(v3(0, LEVEL_HEIGHT, 0), center(), edge(4), SAMPLES) },
      { from: 2, to: 0, points: reverse(edgeToEdge(0, 2)) },
      { from: 4, to: 0, points: reverse(edgeToEdge(0, 4)) },
    ],
  },
  drop: {
    type: 'drop',
    name: '落下口',
    description: '辺0または上から入ったマーブルを、真下のタイルへ落とす',
    color: 0xc77dff,
    span: 1,
    ports: [{ id: 0, h: 0 }, { id: 'up', h: 1 }, { id: 'down', h: 0 }],
    catchRadius: 0.3,
    routes: [
      { from: 0, to: 'down', points: joinPaths(lineSegment(edge(0), center(), 12), lineSegment(center(), v3(0, 0, 0), 6)) },
      { from: 'up', to: 'down', points: lineSegment(v3(0, LEVEL_HEIGHT, 0), v3(0, 0, 0), 6) },
    ],
  },
  goal: {
    type: 'goal',
    name: 'ゴール',
    description: 'どの辺からでも、また上からでもマーブルを受け止める',
    color: 0xffd23f,
    span: 1,
    ports: [...sidePorts(ALL_SIDES), { id: 'up', h: 1 }],
    catchRadius: 0.45,
    routes: [
      ...ALL_SIDES.map((s): RouteDef => ({ from: s, to: 'goal', points: lineSegment(edge(s), center(), 12) })),
      { from: 'up', to: 'goal', points: lineSegment(v3(0, LEVEL_HEIGHT, 0), center(), 6) },
    ],
  },
};

/** パレットに並べる順 */
export const PALETTE_ORDER: PartType[] = [
  'start',
  'straight',
  'curve60',
  'curve120',
  'slope',
  'splitter',
  'drop',
  'goal',
  'cross',
  'merge',
  'uturn',
  'steep',
  'spiral',
  'funnel',
  'seesaw',
  'booster',
  'brake',
  'loop',
  'lift',
  'jump',
  'warp',
  'chime',
];

/** パレットの各タイルを選ぶキー（PALETTE_ORDER と同じ順） */
export const PALETTE_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];

export function isPartType(v: unknown): v is PartType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PARTS, v);
}

export function getPart(type: PartType): PartDef {
  return PARTS[type];
}

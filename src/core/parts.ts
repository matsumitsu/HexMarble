import { APOTHEM, LEVEL_HEIGHT, TRACK_Y } from './constants';
import { edgeMidpoint, type Side } from './hex';
import { joinPaths, lineSegment, quadBezier, v3, type Vec3 } from './path';

/** 接続口の位置。0〜5 は六角形の辺、'up' は上面中央、'down' は底面中央 */
export type PortId = Side | 'up' | 'down';

export interface PortDef {
  /** 接続口の位置（回転前のローカル） */
  id: PortId;
  /** 接続口の高さ（タイルの設置レベルからの相対レベル） */
  h: number;
}

export interface RouteDef {
  /** 入口。'start' はスタートタイルの発射位置 */
  from: PortId | 'start';
  /** 出口。'goal' はゴールでマーブルを受け止める位置 */
  to: PortId | 'goal';
  /** マーブルの中心が通る経路点列（回転前のローカル座標。y はタイル底面からの高さ） */
  points: Vec3[];
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
  splitter: {
    type: 'splitter',
    name: '分岐',
    description: '辺0または上から入ったマーブルを、通るたびに辺2と辺4へ交互に振り分ける',
    color: 0xe55381,
    span: 1,
    ports: [...sidePorts([0, 2, 4]), { id: 'up', h: 1 }],
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
];

/** パレットの各タイルを選ぶキー（PALETTE_ORDER と同じ順） */
export const PALETTE_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];

export function isPartType(v: unknown): v is PartType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PARTS, v);
}

export function getPart(type: PartType): PartDef {
  return PARTS[type];
}

import type { Course, Piece } from './course';
import { cellKey, neighbor, oppositeSide, rotateSide, type Side } from './hex';
import { getPart, type PartType, type PortId } from './parts';

/** ワールド向きに回転した接続口 */
export interface WorldPort {
  /** 回転後の位置（辺 0〜5 / up / down） */
  id: PortId;
  /** 回転前（タイル定義上）の位置 */
  localId: PortId;
  /** 絶対レベル（設置レベル + 接続口の相対高さ） */
  level: number;
}

export interface PortRef {
  piece: Piece;
  port: WorldPort;
}

export function toWorldPortId(id: PortId, rot: number): PortId {
  return id === 'up' || id === 'down' ? id : rotateSide(id, rot);
}

export function toLocalPortId(id: PortId, rot: number): PortId {
  return id === 'up' || id === 'down' ? id : rotateSide(id, -rot);
}

export function worldPorts(piece: Pick<Piece, 'type' | 'level' | 'rot'>): WorldPort[] {
  return getPart(piece.type).ports.map((p) => ({
    id: toWorldPortId(p.id, piece.rot),
    localId: p.id,
    level: piece.level + p.h,
  }));
}

/** セル単位の索引。接続判定を高速化する */
export class CourseIndex {
  private readonly byCell = new Map<string, Piece[]>();

  constructor(readonly course: Course) {
    for (const p of course.pieces) {
      const k = cellKey(p.q, p.r);
      const list = this.byCell.get(k);
      if (list) list.push(p);
      else this.byCell.set(k, [p]);
    }
  }

  at(q: number, r: number): readonly Piece[] {
    return this.byCell.get(cellKey(q, r)) ?? [];
  }
}

/** 隣のセルの向かい合う辺 */
function facingSide(piece: Pick<Piece, 'q' | 'r'>, side: Side): { q: number; r: number; id: Side } {
  const n = neighbor(piece.q, piece.r, side);
  return { q: n.q, r: n.r, id: oppositeSide(side) };
}

/**
 * 同じセルで、真下（down のとき）または真上（up のとき）にある一番近いタイル。
 * 間が空いていてもよい（マーブルはその間を垂直に落ちる）。
 */
function nearestVertical(index: CourseIndex, piece: Piece, port: WorldPort): Piece | null {
  let best: Piece | null = null;
  for (const other of index.at(piece.q, piece.r)) {
    if (other.id === piece.id) continue;
    if (port.id === 'down') {
      const top = other.level + getPart(other.type).span;
      if (top <= port.level && (!best || top > best.level + getPart(best.type).span)) best = other;
    } else if (other.level >= port.level && (!best || other.level < best.level)) {
      best = other;
    }
  }
  return best;
}

/**
 * 接続口の接続先を探す。
 * 辺の接続口は「隣のセルの向かい合う辺」に、絶対レベルが一致する接続口があるときだけつながる。
 * down は「同じセルで真下にある一番近いタイルの up」に、up は「真上にある一番近いタイルの down」に、
 * 間に隙間があってもつながる（落下口から下のタイルへ落とすため）。
 */
export function findConnection(index: CourseIndex, piece: Piece, port: WorldPort): PortRef | null {
  if (port.id === 'up' || port.id === 'down') {
    const other = nearestVertical(index, piece, port);
    if (!other) return null;
    const want = port.id === 'down' ? 'up' : 'down';
    const op = worldPorts(other).find((p) => p.id === want);
    if (!op) return null;
    // 受け口はそのタイルの上面（up）/ 底面（down）にあること
    const ok = want === 'up' ? op.level === other.level + getPart(other.type).span : op.level === other.level;
    return ok ? { piece: other, port: op } : null;
  }
  const t = facingSide(piece, port.id);
  for (const other of index.at(t.q, t.r)) {
    if (other.id === piece.id) continue;
    for (const op of worldPorts(other)) {
      if (op.id === t.id && op.level === port.level) return { piece: other, port: op };
    }
  }
  return null;
}

export interface Connection {
  a: PortRef;
  b: PortRef;
}

/** コース全体の接続（重複なし）と、つながっていない接続口 */
export function analyzeConnections(course: Course): { connections: Connection[]; openPorts: PortRef[] } {
  const index = new CourseIndex(course);
  const connections: Connection[] = [];
  const openPorts: PortRef[] = [];
  for (const piece of course.pieces) {
    for (const port of worldPorts(piece)) {
      const other = findConnection(index, piece, port);
      if (!other) openPorts.push({ piece, port });
      else if (piece.id < other.piece.id) connections.push({ a: { piece, port }, b: other });
    }
  }
  return { connections, openPorts };
}

/** 2つのタイルが直接つながっているか */
export function areConnected(course: Course, aId: number, bId: number): boolean {
  const index = new CourseIndex(course);
  const a = course.pieces.find((p) => p.id === aId);
  if (!a) return false;
  return worldPorts(a).some((port) => findConnection(index, a, port)?.piece.id === bId);
}

/** 仮に置いたとき、既存のタイルと1つ以上つながるか（配置ハイライト用） */
export function placementConnects(
  index: CourseIndex,
  type: PartType,
  q: number,
  r: number,
  level: number,
  rot: number,
): boolean {
  const ghost: Piece = { id: -1, type, q, r, level, rot };
  return worldPorts(ghost).some((port) => findConnection(index, ghost, port) !== null);
}

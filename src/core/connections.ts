import type { Course, Piece } from './course';
import { cellKey, neighbor, oppositeSide, rotateSide } from './hex';
import { getPart, type PartType, type PortId } from './parts';

/** ワールド向きに回転した接続口 */
export interface WorldPort {
  /** 回転後の位置（辺 0〜5 / up / down） */
  id: PortId;
  /** 回転前（パーツ定義上）の位置 */
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

/** 接続口の向かい側として一致すべき位置 */
function matchingTarget(piece: Pick<Piece, 'q' | 'r'>, port: WorldPort): { q: number; r: number; id: PortId } {
  if (port.id === 'up') return { q: piece.q, r: piece.r, id: 'down' };
  if (port.id === 'down') return { q: piece.q, r: piece.r, id: 'up' };
  const n = neighbor(piece.q, piece.r, port.id);
  return { q: n.q, r: n.r, id: oppositeSide(port.id) };
}

/**
 * 接続口の接続先を探す。
 * 辺の接続口は「隣のセルの向かい合う辺」に、up/down は「同じセルの down/up」に、
 * 絶対レベルが一致する接続口があるときだけつながっているとみなす。
 */
export function findConnection(index: CourseIndex, piece: Piece, port: WorldPort): PortRef | null {
  const t = matchingTarget(piece, port);
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

/** 2つのパーツが直接つながっているか */
export function areConnected(course: Course, aId: number, bId: number): boolean {
  const index = new CourseIndex(course);
  const a = course.pieces.find((p) => p.id === aId);
  if (!a) return false;
  return worldPorts(a).some((port) => findConnection(index, a, port)?.piece.id === bId);
}

/** 仮に置いたとき、既存のパーツと1つ以上つながるか（配置ハイライト用） */
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

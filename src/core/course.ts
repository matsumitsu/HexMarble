import { GRID_RADIUS, MAX_LEVEL } from './constants';
import { hexDistance, mod6 } from './hex';
import { getPart, type PartType } from './parts';

export interface Piece {
  id: number;
  type: PartType;
  q: number;
  r: number;
  /** 設置レベル（タイル底面の高さ） */
  level: number;
  /** 60°刻みの回転（0〜5） */
  rot: number;
}

/** コースはイミュータブルに扱う（編集操作は新しいコースを返す） */
export interface Course {
  readonly pieces: readonly Piece[];
  readonly nextId: number;
}

export type EditResult = { ok: true; course: Course; pieceId?: number } | { ok: false; reason: string };

export function emptyCourse(): Course {
  return { pieces: [], nextId: 1 };
}

export function getPiece(course: Course, id: number): Piece | undefined {
  return course.pieces.find((p) => p.id === id);
}

export function inGrid(q: number, r: number): boolean {
  return hexDistance({ q, r }, { q: 0, r: 0 }) <= GRID_RADIUS;
}

/** セルに置かれたタイル（下から順） */
export function getStack(course: Course, q: number, r: number): Piece[] {
  return course.pieces.filter((p) => p.q === q && p.r === r).sort((a, b) => a.level - b.level);
}

/** セルの最上部レベル（何も指定しないときにタイルを置くレベル） */
export function stackTop(course: Course, q: number, r: number): number {
  let top = 0;
  for (const p of course.pieces) {
    if (p.q === q && p.r === r) top = Math.max(top, p.level + getPart(p.type).span);
  }
  return top;
}

/** セルのレベル範囲 [level, level + span) が、他のタイルと重なるか */
export function overlaps(course: Course, q: number, r: number, level: number, span: number, exceptId?: number): boolean {
  return course.pieces.some(
    (p) => p.id !== exceptId && p.q === q && p.r === r && p.level < level + span && level < p.level + getPart(p.type).span,
  );
}

/**
 * 配置できるか判定する。タイルは支えなしで好きなレベルに置ける。
 * level を省略すると、セルの最上部に置く。
 */
export function canPlace(
  course: Course,
  type: PartType,
  q: number,
  r: number,
  level?: number,
): { ok: true; level: number } | { ok: false; reason: string } {
  if (!inGrid(q, r)) return { ok: false, reason: 'グリッドの外です' };
  const def = getPart(type);
  if (def.unique && course.pieces.some((p) => p.type === type)) {
    return { ok: false, reason: `${def.name}は1つしか置けません` };
  }
  const lv = level ?? stackTop(course, q, r);
  if (lv < 0) return { ok: false, reason: 'レベル0より下には置けません' };
  if (lv + def.span - 1 > MAX_LEVEL) return { ok: false, reason: `高さの上限（レベル${MAX_LEVEL}）を超えます` };
  if (overlaps(course, q, r, lv, def.span)) return { ok: false, reason: 'ほかのタイルと重なります' };
  return { ok: true, level: lv };
}

/** タイルを置く。level を省略するとセルの最上部に置く */
export function placePiece(course: Course, type: PartType, q: number, r: number, rot = 0, level?: number): EditResult {
  const check = canPlace(course, type, q, r, level);
  if (!check.ok) return check;
  const piece: Piece = { id: course.nextId, type, q, r, level: check.level, rot: mod6(rot) };
  return { ok: true, course: { pieces: [...course.pieces, piece], nextId: course.nextId + 1 }, pieceId: piece.id };
}

/** タイルを削除する。ほかのタイルの高さは変わらない */
export function removePiece(course: Course, id: number): EditResult {
  const target = getPiece(course, id);
  if (!target) return { ok: false, reason: 'タイルが見つかりません' };
  return { ok: true, course: { ...course, pieces: course.pieces.filter((p) => p.id !== id) } };
}

export function rotatePiece(course: Course, id: number, delta = 1): EditResult {
  const target = getPiece(course, id);
  if (!target) return { ok: false, reason: 'タイルが見つかりません' };
  const pieces = course.pieces.map((p) => (p.id === id ? { ...p, rot: mod6(p.rot + delta) } : p));
  return { ok: true, course: { ...course, pieces }, pieceId: id };
}

/** タイルのレベルを delta だけ動かす */
export function movePieceLevel(course: Course, id: number, delta: number): EditResult {
  const target = getPiece(course, id);
  if (!target) return { ok: false, reason: 'タイルが見つかりません' };
  const span = getPart(target.type).span;
  const level = target.level + delta;
  if (level < 0) return { ok: false, reason: 'これ以上下げられません' };
  if (level + span - 1 > MAX_LEVEL) return { ok: false, reason: `高さの上限（レベル${MAX_LEVEL}）です` };
  if (overlaps(course, target.q, target.r, level, span, id)) {
    return { ok: false, reason: delta > 0 ? '上にほかのタイルがあります' : '下にほかのタイルがあります' };
  }
  const pieces = course.pieces.map((p) => (p.id === id ? { ...p, level } : p));
  return { ok: true, course: { ...course, pieces }, pieceId: id };
}

/** タイルを1レベル上げる */
export const raisePiece = (course: Course, id: number): EditResult => movePieceLevel(course, id, 1);
/** タイルを1レベル下げる */
export const lowerPiece = (course: Course, id: number): EditResult => movePieceLevel(course, id, -1);

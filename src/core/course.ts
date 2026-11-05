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

/** セルの積み上げ（下から順） */
export function getStack(course: Course, q: number, r: number): Piece[] {
  return course.pieces.filter((p) => p.q === q && p.r === r).sort((a, b) => a.level - b.level);
}

/** セルの最上部レベル（次にタイルを置けるレベル） */
export function stackTop(course: Course, q: number, r: number): number {
  let top = 0;
  for (const p of course.pieces) {
    if (p.q === q && p.r === r) top = Math.max(top, p.level + getPart(p.type).span);
  }
  return top;
}

/** 指定セルの、あるレベルの真下にあるタイル */
function pieceBelow(course: Course, q: number, r: number, level: number): Piece | undefined {
  return getStack(course, q, r).find((p) => p.level + getPart(p.type).span === level);
}

/**
 * 配置できるか判定する。minLevel を指定すると、セルの最上部がそれより低い場合は
 * 不足分を支柱で埋めて minLevel に置く（supports がその数）。
 */
export function canPlace(
  course: Course,
  type: PartType,
  q: number,
  r: number,
  minLevel = 0,
): { ok: true; level: number; supports: number } | { ok: false; reason: string } {
  if (!inGrid(q, r)) return { ok: false, reason: 'グリッドの外です' };
  const def = getPart(type);
  if (def.unique && course.pieces.some((p) => p.type === type)) {
    return { ok: false, reason: `${def.name}は1つしか置けません` };
  }
  const top = stackTop(course, q, r);
  const level = Math.max(top, minLevel);
  const supports = level - top;
  if (level + def.span - 1 > MAX_LEVEL) return { ok: false, reason: `高さの上限（レベル${MAX_LEVEL}）を超えます` };
  if ((def.groundOrSupportOnly || supports > 0) && top > 0) {
    const below = pieceBelow(course, q, r, top);
    if (below && below.type !== 'support') {
      return { ok: false, reason: supports > 0 ? '支柱以外のタイルの上には支柱を積めません' : `${def.name}は地面か支柱の上にしか置けません` };
    }
  }
  return { ok: true, level, supports };
}

/** タイルを置く。minLevel までの不足分は支柱を自動で積む */
export function placePiece(course: Course, type: PartType, q: number, r: number, rot = 0, minLevel = 0): EditResult {
  const check = canPlace(course, type, q, r, minLevel);
  if (!check.ok) return check;
  const pieces = [...course.pieces];
  let nextId = course.nextId;
  const base = check.level - check.supports;
  for (let i = 0; i < check.supports; i++) pieces.push({ id: nextId++, type: 'support', q, r, level: base + i, rot: 0 });
  const piece: Piece = { id: nextId++, type, q, r, level: check.level, rot: mod6(rot) };
  pieces.push(piece);
  return { ok: true, course: { pieces, nextId }, pieceId: piece.id };
}

/** 削除すると、その上に積まれたタイルは下へずれる */
export function removePiece(course: Course, id: number): EditResult {
  const target = getPiece(course, id);
  if (!target) return { ok: false, reason: 'タイルが見つかりません' };
  const span = getPart(target.type).span;
  const pieces = course.pieces
    .filter((p) => p.id !== id)
    .map((p) => (p.q === target.q && p.r === target.r && p.level > target.level ? { ...p, level: p.level - span } : p));
  return { ok: true, course: { ...course, pieces } };
}

export function rotatePiece(course: Course, id: number, delta = 1): EditResult {
  const target = getPiece(course, id);
  if (!target) return { ok: false, reason: 'タイルが見つかりません' };
  const pieces = course.pieces.map((p) => (p.id === id ? { ...p, rot: mod6(p.rot + delta) } : p));
  return { ok: true, course: { ...course, pieces }, pieceId: id };
}

/** 真下に支柱を1つ差し込み、タイル（と上に積まれたもの）を1レベル上げる */
export function raisePiece(course: Course, id: number): EditResult {
  const target = getPiece(course, id);
  if (!target) return { ok: false, reason: 'タイルが見つかりません' };
  if (stackTop(course, target.q, target.r) > MAX_LEVEL) return { ok: false, reason: `高さの上限（レベル${MAX_LEVEL}）です` };
  if (target.level > 0) {
    const below = pieceBelow(course, target.q, target.r, target.level);
    if (below && below.type !== 'support') return { ok: false, reason: '下が支柱でないため、高さを上げられません' };
  }
  const support: Piece = { id: course.nextId, type: 'support', q: target.q, r: target.r, level: target.level, rot: 0 };
  const pieces = course.pieces.map((p) =>
    p.q === target.q && p.r === target.r && p.level >= target.level ? { ...p, level: p.level + 1 } : p,
  );
  return { ok: true, course: { pieces: [...pieces, support], nextId: course.nextId + 1 }, pieceId: id };
}

/** 真下の支柱を1つ取り除き、タイル（と上に積まれたもの）を1レベル下げる */
export function lowerPiece(course: Course, id: number): EditResult {
  const target = getPiece(course, id);
  if (!target) return { ok: false, reason: 'タイルが見つかりません' };
  if (target.level === 0) return { ok: false, reason: 'これ以上下げられません' };
  const below = pieceBelow(course, target.q, target.r, target.level);
  if (!below || below.type !== 'support') return { ok: false, reason: '真下が支柱でないため、高さを下げられません' };
  const res = removePiece(course, below.id);
  return res.ok ? { ...res, pieceId: id } : res;
}

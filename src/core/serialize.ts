import { MAX_LEVEL } from './constants';
import { inGrid, type Course, type Piece } from './course';
import { cellKey, mod6 } from './hex';
import { getPart, isPartType } from './parts';

export const FORMAT = 'hexmarble-course';
export const FORMAT_VERSION = 1;

export interface CourseJson {
  format: typeof FORMAT;
  version: number;
  name?: string;
  pieces: Array<Pick<Piece, 'type' | 'q' | 'r' | 'level' | 'rot'>>;
}

export function courseToJson(course: Course, name?: string): CourseJson {
  const pieces = [...course.pieces]
    .sort((a, b) => a.q - b.q || a.r - b.r || a.level - b.level)
    .map(({ type, q, r, level, rot }) => ({ type, q, r, level, rot }));
  return { format: FORMAT, version: FORMAT_VERSION, ...(name ? { name } : {}), pieces };
}

export function serializeCourse(course: Course, name?: string): string {
  return JSON.stringify(courseToJson(course, name), null, 2);
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** JSON を検証してコースに変換する。不正なら Error を投げる */
export function parseCourse(text: string): Course {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読み込めません');
  }
  if (!data || typeof data !== 'object') throw new Error('コースデータではありません');
  const obj = data as Partial<CourseJson>;
  if (obj.format !== FORMAT) throw new Error('HexMarbleのコースデータではありません');
  if (!isInt(obj.version) || obj.version > FORMAT_VERSION) throw new Error('対応していないバージョンです');
  if (!Array.isArray(obj.pieces)) throw new Error('pieces がありません');

  const pieces: Piece[] = [];
  const occupied = new Set<string>();
  let starts = 0;
  // 旧バージョンの支柱は廃止したので読み飛ばす（ほかのタイルの高さはそのまま）
  const raws = obj.pieces.filter((raw) => !(raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'support'));
  raws.forEach((raw, i) => {
    const p = raw as Partial<Piece>;
    const where = `${i + 1}番目のタイル`;
    if (!p || typeof p !== 'object') throw new Error(`${where}が不正です`);
    if (!isPartType(p.type)) throw new Error(`${where}の種類が不明です`);
    if (!isInt(p.q) || !isInt(p.r) || !inGrid(p.q, p.r)) throw new Error(`${where}の位置が不正です`);
    if (!isInt(p.level) || p.level < 0) throw new Error(`${where}の高さが不正です`);
    if (!isInt(p.rot)) throw new Error(`${where}の向きが不正です`);
    const span = getPart(p.type).span;
    if (p.level + span - 1 > MAX_LEVEL) throw new Error(`${where}が高さの上限を超えています`);
    for (let l = p.level; l < p.level + span; l++) {
      const key = `${cellKey(p.q, p.r)}@${l}`;
      if (occupied.has(key)) throw new Error(`${where}が他のタイルと重なっています`);
      occupied.add(key);
    }
    if (p.type === 'start') starts++;
    pieces.push({ id: i + 1, type: p.type, q: p.q, r: p.r, level: p.level, rot: mod6(p.rot) });
  });
  if (starts > 1) throw new Error('スタートが複数あります');
  return { pieces, nextId: pieces.length + 1 };
}

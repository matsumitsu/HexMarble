import { describe, expect, it } from 'vitest';
import { MAX_LEVEL } from '../src/core/constants';
import { canPlace, emptyCourse, lowerPiece, placePiece, raisePiece, removePiece, rotatePiece, stackTop, type Course } from '../src/core/course';
import { History } from '../src/core/history';
import { sampleCourse } from '../src/core/sampleCourse';
import { parseCourse, serializeCourse } from '../src/core/serialize';

const ok = (res: ReturnType<typeof placePiece>): Course => {
  if (!res.ok) throw new Error(res.reason);
  return res.course;
};

describe('コース編集', () => {
  it('置くとセルの最上部に積まれる', () => {
    let c = ok(placePiece(emptyCourse(), 'support', 0, 0));
    c = ok(placePiece(c, 'straight', 0, 0));
    expect(c.pieces[1].level).toBe(1);
    expect(stackTop(c, 0, 0)).toBe(2);
  });

  it('スタートは1つだけ', () => {
    const c = ok(placePiece(emptyCourse(), 'start', 0, 0));
    expect(canPlace(c, 'start', 1, 0).ok).toBe(false);
  });

  it('支柱は部品の上には置けない', () => {
    const c = ok(placePiece(emptyCourse(), 'straight', 0, 0));
    expect(canPlace(c, 'support', 0, 0).ok).toBe(false);
  });

  it('高さの上限を超えて置けない', () => {
    let c = emptyCourse();
    for (let i = 0; i <= MAX_LEVEL; i++) c = ok(placePiece(c, 'support', 0, 0));
    expect(canPlace(c, 'straight', 0, 0).ok).toBe(false);
  });

  it('グリッド外には置けない', () => {
    expect(canPlace(emptyCourse(), 'straight', 99, 0).ok).toBe(false);
  });

  it('回転は60°刻みで0〜5に収まる', () => {
    let c = ok(placePiece(emptyCourse(), 'straight', 0, 0, 5));
    c = ok(rotatePiece(c, 1, 1));
    expect(c.pieces[0].rot).toBe(0);
    c = ok(rotatePiece(c, 1, -1));
    expect(c.pieces[0].rot).toBe(5);
  });

  it('高さを上げると支柱が差し込まれ、下げると取り除かれる', () => {
    let c = ok(placePiece(emptyCourse(), 'straight', 0, 0));
    c = ok(raisePiece(c, 1));
    c = ok(raisePiece(c, 1));
    expect(c.pieces.find((p) => p.id === 1)!.level).toBe(2);
    expect(c.pieces.filter((p) => p.type === 'support')).toHaveLength(2);
    c = ok(lowerPiece(c, 1));
    expect(c.pieces.find((p) => p.id === 1)!.level).toBe(1);
    expect(c.pieces.filter((p) => p.type === 'support')).toHaveLength(1);
  });

  it('削除すると上のタイルが下へずれる', () => {
    let c = ok(placePiece(emptyCourse(), 'support', 0, 0));
    c = ok(placePiece(c, 'slope', 0, 0));
    c = ok(placePiece(c, 'straight', 0, 0));
    expect(c.pieces[2].level).toBe(3);
    c = ok(removePiece(c, 1));
    expect(c.pieces.map((p) => p.level)).toEqual([0, 2]);
  });

  it('編集は元のコースを変更しない（イミュータブル）', () => {
    const c0 = ok(placePiece(emptyCourse(), 'straight', 0, 0));
    const snapshot = JSON.stringify(c0);
    ok(rotatePiece(c0, 1));
    ok(raisePiece(c0, 1));
    ok(removePiece(c0, 1));
    expect(JSON.stringify(c0)).toBe(snapshot);
  });
});

describe('Undo / Redo', () => {
  it('push / undo / redo', () => {
    const h = new History(0);
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(1);
    expect(h.present).toBe(1);
  });

  it('新しく push すると Redo 履歴は消える', () => {
    const h = new History('a');
    h.push('b');
    h.undo();
    h.push('c');
    expect(h.canRedo).toBe(false);
    expect(h.present).toBe('c');
  });

  it('履歴数の上限を守る', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    let n = 0;
    while (h.undo() !== null) n++;
    expect(n).toBe(3);
    expect(h.present).toBe(7);
  });

  it('コース編集と組み合わせて元に戻せる', () => {
    const h = new History(emptyCourse());
    h.push(ok(placePiece(h.present, 'straight', 0, 0)));
    h.push(ok(rotatePiece(h.present, 1)));
    expect(h.present.pieces[0].rot).toBe(1);
    h.undo();
    expect(h.present.pieces[0].rot).toBe(0);
    h.undo();
    expect(h.present.pieces).toHaveLength(0);
  });
});

describe('保存形式', () => {
  it('シリアライズして読み戻すと同じコースになる', () => {
    const c = sampleCourse();
    const back = parseCourse(serializeCourse(c));
    const norm = (x: Course) => serializeCourse(x);
    expect(norm(back)).toBe(norm(c));
  });

  it('不正なデータは読み込まない', () => {
    expect(() => parseCourse('not json')).toThrow();
    expect(() => parseCourse('{"format":"other","version":1,"pieces":[]}')).toThrow();
    const base = { format: 'hexmarble-course', version: 1 };
    expect(() => parseCourse(JSON.stringify({ ...base, pieces: [{ type: 'laser', q: 0, r: 0, level: 0, rot: 0 }] }))).toThrow();
    expect(() =>
      parseCourse(
        JSON.stringify({
          ...base,
          pieces: [
            { type: 'straight', q: 0, r: 0, level: 0, rot: 0 },
            { type: 'straight', q: 0, r: 0, level: 0, rot: 0 },
          ],
        }),
      ),
    ).toThrow(/重なって/);
    expect(() => parseCourse(JSON.stringify({ ...base, pieces: [{ type: 'straight', q: 0, r: 0, level: 2, rot: 0 }] }))).toThrow(/宙に浮/);
  });
});

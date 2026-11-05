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
  it('レベルを省略するとセルの最上部に積まれる', () => {
    let c = ok(placePiece(emptyCourse(), 'slope', 0, 0));
    c = ok(placePiece(c, 'straight', 0, 0));
    expect(c.pieces[1].level).toBe(2);
    expect(stackTop(c, 0, 0)).toBe(3);
  });

  it('支えなしで好きなレベルに置ける', () => {
    let c = ok(placePiece(emptyCourse(), 'straight', 0, 0, 2, 3));
    expect(c.pieces).toHaveLength(1);
    expect(c.pieces[0]).toMatchObject({ level: 3, rot: 2 });
    // 下の空いたところにも置ける
    c = ok(placePiece(c, 'curve60', 0, 0, 0, 1));
    expect(c.pieces[1].level).toBe(1);
  });

  it('同じセルで高さが重なる位置には置けない', () => {
    const c = ok(placePiece(emptyCourse(), 'slope', 0, 0, 0, 2)); // レベル2〜3を占有
    expect(canPlace(c, 'straight', 0, 0, 2).ok).toBe(false);
    expect(canPlace(c, 'straight', 0, 0, 3).ok).toBe(false);
    expect(canPlace(c, 'slope', 0, 0, 1).ok).toBe(false);
    expect(canPlace(c, 'straight', 0, 0, 1)).toEqual({ ok: true, level: 1 });
    expect(canPlace(c, 'straight', 0, 0, 4)).toEqual({ ok: true, level: 4 });
  });

  it('スタートは1つだけ', () => {
    const c = ok(placePiece(emptyCourse(), 'start', 0, 0));
    expect(canPlace(c, 'start', 1, 0).ok).toBe(false);
  });

  it('高さの上限を超えて置けない', () => {
    expect(canPlace(emptyCourse(), 'straight', 0, 0, MAX_LEVEL).ok).toBe(true);
    expect(canPlace(emptyCourse(), 'straight', 0, 0, MAX_LEVEL + 1).ok).toBe(false);
    expect(canPlace(emptyCourse(), 'slope', 0, 0, MAX_LEVEL).ok).toBe(false);
    expect(canPlace(emptyCourse(), 'straight', 0, 0, -1).ok).toBe(false);
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

  it('高さを上げ下げすると、タイルだけが1レベルずつ動く', () => {
    let c = ok(placePiece(emptyCourse(), 'straight', 0, 0));
    c = ok(raisePiece(c, 1));
    c = ok(raisePiece(c, 1));
    expect(c.pieces).toHaveLength(1);
    expect(c.pieces[0].level).toBe(2);
    c = ok(lowerPiece(c, 1));
    expect(c.pieces[0].level).toBe(1);
    c = ok(lowerPiece(c, 1));
    expect(lowerPiece(c, 1).ok).toBe(false);
  });

  it('上げ下げの先にほかのタイルがあると動かせない', () => {
    let c = ok(placePiece(emptyCourse(), 'straight', 0, 0, 0, 0));
    c = ok(placePiece(c, 'straight', 0, 0, 0, 1));
    expect(raisePiece(c, 1).ok).toBe(false);
    expect(lowerPiece(c, 2).ok).toBe(false);
    expect(raisePiece(c, 2).ok).toBe(true);
  });

  it('削除してもほかのタイルの高さは変わらない', () => {
    let c = ok(placePiece(emptyCourse(), 'slope', 0, 0));
    c = ok(placePiece(c, 'straight', 0, 0));
    c = ok(removePiece(c, 1));
    expect(c.pieces.map((p) => p.level)).toEqual([2]);
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
  });

  it('宙に浮いたタイルも読み込める', () => {
    const json = JSON.stringify({ format: 'hexmarble-course', version: 1, pieces: [{ type: 'straight', q: 0, r: 0, level: 2, rot: 0 }] });
    expect(parseCourse(json).pieces[0].level).toBe(2);
  });

  it('旧バージョンの支柱は読み飛ばし、ほかのタイルの高さは保つ', () => {
    const json = JSON.stringify({
      format: 'hexmarble-course',
      version: 1,
      pieces: [
        { type: 'support', q: 0, r: 0, level: 0, rot: 0 },
        { type: 'straight', q: 0, r: 0, level: 1, rot: 3 },
      ],
    });
    const c = parseCourse(json);
    expect(c.pieces).toEqual([{ id: 1, type: 'straight', q: 0, r: 0, level: 1, rot: 3 }]);
  });
});

import { describe, expect, it } from 'vitest';
import { warpPairs } from '../src/core/course';
import { buildCourse } from '../src/core/sampleCourse';
import { parseCourse, serializeCourse } from '../src/core/serialize';
import { Simulation } from '../src/core/simulation';
import type { Course } from '../src/core/course';

type Steps = Parameters<typeof buildCourse>[0];

/** 最後まで動かし、最高速度と通ったタイルの id 列を返す */
function run(steps: Steps | Course, params = {}) {
  const course = Array.isArray(steps) ? buildCourse(steps) : steps;
  const sim = new Simulation(course, params);
  let maxSpeed = 0;
  const speeds = new Map<number, number[]>();
  while (!sim.finished) {
    sim.step();
    maxSpeed = Math.max(maxSpeed, sim.speed);
    const id = (sim as unknown as { piece?: { id: number } }).piece?.id ?? null;
    if (id !== null && sim.status === 'rolling') {
      if (!speeds.has(id)) speeds.set(id, []);
      speeds.get(id)!.push(sim.speed);
    }
  }
  const entered = sim.events.filter((e) => e.type === 'enter').map((e) => e.pieceId);
  return { sim, maxSpeed, entered, speeds };
}

describe('新しいタイル', () => {
  it('急坂は2レベル下り、普通の坂より速くなる', () => {
    const steep = run([['start', 0, 0, 0, 2], ['steep', 1, 0, 3, 0], ['goal', 2, 0]]);
    const slope = run([['start', 0, 0, 0, 1], ['slope', 1, 0, 3, 0], ['goal', 2, 0]]);
    expect(steep.sim.status).toBe('success');
    expect(steep.maxSpeed).toBeGreaterThan(slope.maxSpeed + 0.5);
  });

  it('螺旋は回りながら2レベル下り、辺2（向きに応じて回転）へ出る', () => {
    const { sim, entered, maxSpeed } = run([['start', 0, 0, 0, 2], ['spiral', 1, 0, 3, 0], ['goal', 1, 1]]);
    expect(sim.status).toBe('success');
    expect(entered).toEqual([1, 2, 3]);
    expect(maxSpeed).toBeGreaterThan(3);
  });

  it('漏斗はどの辺から入っても、真下のタイルへ落とす', () => {
    for (let rot = 0; rot < 6; rot++) {
      const { sim, entered } = run([['start', 0, 0, 0, 1], ['goal', 1, 0], ['funnel', 1, 0, rot, 1]]);
      expect(sim.status, `rot ${rot}`).toBe('success');
      expect(entered).toEqual([1, 3, 2]);
    }
  });

  it('加速台は目標速度まで加速し、逆向きに入ると押し戻されて止まる', () => {
    const fwd = run([['start', 0, 0, 0], ['booster', 1, 0, 0], ['straight', 2, 0, 0], ['goal', 3, 0]]);
    expect(fwd.sim.status).toBe('success');
    expect(Math.max(...fwd.speeds.get(2)!)).toBeCloseTo(5, 1);
    const rev = run([['start', 0, 0, 0], ['booster', 1, 0, 3], ['goal', 2, 0]]);
    expect(rev.sim.failReason).toBe('stalled');
  });

  it('減速帯は速いマーブルを一定の速度まで落とす', () => {
    const { sim, speeds } = run([['start', 0, 0, 0, 2], ['steep', 1, 0, 3, 0], ['brake', 2, 0, 0], ['goal', 3, 0]]);
    expect(sim.status).toBe('success');
    const s = speeds.get(3)!;
    expect(s[0]).toBeGreaterThan(3);
    expect(s[s.length - 1]).toBeLessThan(1.5);
  });

  it('ループは速度が足りないと頂上で落ち、足りれば一回転して抜ける', () => {
    const slow = run([['start', 0, 0, 0], ['loop', 1, 0, 0], ['goal', 2, 0]]);
    expect(slow.sim.failReason).toBe('fell');
    const fast = run([['start', 0, 0, 0], ['booster', 1, 0, 0], ['loop', 2, 0, 0], ['goal', 3, 0]]);
    expect(fast.sim.status).toBe('success');
    expect(fast.entered).toEqual([1, 2, 3, 4]);
  });

  it('リフトは一定の速度で2レベル上へ運ぶ', () => {
    const { sim, speeds } = run([['start', 0, 0, 0], ['lift', 1, 0, 0], ['goal', 2, 0, 0, 2]]);
    expect(sim.status).toBe('success');
    const s = speeds.get(2)!;
    const mid = s.slice(Math.floor(s.length * 0.3), Math.floor(s.length * 0.7));
    expect(Math.max(...mid) - Math.min(...mid)).toBeLessThan(1e-9);
  });

  it('ジャンプ台から飛び、届いた先のタイルに着地する', () => {
    const { sim, entered } = run([['start', 0, 0, 0, 3], ['jump', 1, 0, 0, 3], ['goal', 2, 0, 0, 0]]);
    expect(sim.status).toBe('success');
    expect(sim.events.map((e) => e.type)).toContain('land');
    expect(entered).toEqual([1, 2, 3]);
  });

  it('ジャンプ台から漏斗へ着地すると、その下のタイルへ落ちる', () => {
    const { sim, entered } = run([['start', 0, 0, 0, 3], ['jump', 1, 0, 0, 3], ['goal', 2, 0], ['funnel', 2, 0, 0, 1]]);
    expect(sim.status).toBe('success');
    expect(entered).toEqual([1, 2, 4, 3]);
  });

  /** ジャンプして着地した直後の速さと、着地直前の速さ */
  function landing(steps: Steps) {
    const sim = new Simulation(buildCourse(steps));
    let before = 0;
    let after: number | null = null;
    while (!sim.finished) {
      const flying = sim.status === 'flying';
      sim.step();
      const v = (sim as unknown as { fallVel: { x: number; y: number; z: number } }).fallVel;
      if (flying && sim.status === 'flying') before = Math.hypot(v.x, v.y, v.z);
      if (flying && sim.status === 'rolling' && after === null) after = sim.speed;
    }
    return { sim, before, after };
  }

  it('ジャンプ台から直線や坂の溝にも着地して、そのまま進む', () => {
    const straight = landing([['start', 0, 0, 0, 3], ['jump', 1, 0, 0, 3], ['straight', 2, 0, 0, 0], ['goal', 3, 0]]);
    expect(straight.sim.status).toBe('success');
    expect(straight.sim.events.filter((e) => e.type === 'land').map((e) => e.pieceId)).toEqual([3]);
    const slope = landing([['start', 0, 0, 0, 3], ['jump', 1, 0, 0, 3], ['slope', 2, 0, 3, 0], ['goal', 3, 0]]);
    expect(slope.sim.status).toBe('success');
    expect(slope.sim.events.map((e) => e.type)).toContain('land');
  });

  it('着地後の速さは着地前の速さに応じる（速く落ちてくるほど速い）', () => {
    const speeds = [1, 2, 3].map((L) => landing([['start', 0, 0, 0, L], ['jump', 1, 0, 0, L], ['straight', 2, 0, 0, 0], ['goal', 3, 0]]));
    for (const r of speeds) {
      expect(r.after).not.toBeNull();
      expect(r.after!).toBeGreaterThan(0);
      expect(r.after!).toBeLessThan(r.before + 0.1); // 着地の衝撃で遅くなる
    }
    expect(speeds[1].before).toBeGreaterThan(speeds[0].before);
    expect(speeds[1].after!).toBeGreaterThan(speeds[0].after!);
    expect(speeds[2].after!).toBeGreaterThan(speeds[1].after!);
  });

  it('溝から外れた場所に落ちると、タイルにぶつかって失敗', () => {
    // 60°傾いた直線は、マーブルの落ちる位置と溝がずれる
    const { sim } = run([['start', 0, 0, 0, 3], ['jump', 1, 0, 0, 3], ['straight', 2, 0, 1, 0]]);
    expect(sim.failReason).toBe('crashed');
  });

  it('ジャンプが届かず地面に当たると失敗', () => {
    const { sim } = run([['start', 0, 0, 0, 3], ['jump', 1, 0, 0, 3], ['goal', 4, 0, 0, 0]]);
    expect(sim.failReason).toBe('crashed');
  });

  it('ワープは組の相手から出てくる。相手がいなければ失敗', () => {
    const ok = run([['start', 0, 0, 0], ['warp', 1, 0, 3], ['warp', 0, 2, 0], ['goal', 1, 2]]);
    expect(ok.sim.status).toBe('success');
    expect(ok.entered).toEqual([1, 2, 3, 4]);
    const alone = run([['start', 0, 0, 0], ['warp', 1, 0, 3]]);
    expect(alone.sim.failReason).toBe('no-warp');
  });

  it('ワープは置いた順に2つずつ組になり、保存・読込しても変わらない', () => {
    const c = buildCourse([
      ['warp', 3, 0],
      ['warp', -3, 0],
      ['warp', 0, 3],
      ['warp', 0, -3],
      ['warp', 2, 2],
    ]);
    const pairs = warpPairs(c);
    expect(pairs.get(1)?.partner).toBe(2);
    expect(pairs.get(2)?.partner).toBe(1);
    expect(pairs.get(3)?.partner).toBe(4);
    expect(pairs.get(5)?.partner).toBeNull();
    const back = parseCourse(serializeCourse(c));
    const after = warpPairs(back);
    const at = (co: Course, id: number) => co.pieces.find((p) => p.id === id)!;
    for (const [id, w] of pairs) {
      const p = at(c, id);
      const q = back.pieces.find((x) => x.q === p.q && x.r === p.r)!;
      const partner = after.get(q.id)!.partner;
      expect(partner === null ? null : `${at(back, partner).q},${at(back, partner).r}`).toBe(
        w.partner === null ? null : `${at(c, w.partner).q},${at(c, w.partner).r}`,
      );
    }
  });

  it('チャイムを通ると鳴らすイベントが出る', () => {
    const { sim } = run([['start', 0, 0, 0], ['chime', 1, 0, 0], ['goal', 2, 0]]);
    expect(sim.status).toBe('success');
    expect(sim.events.filter((e) => e.type === 'chime').map((e) => e.pieceId)).toEqual([2]);
  });

  it('シーソーは通るたびに出口を交互に切り替える', () => {
    const steps: Steps = [['start', 0, 0, 0], ['seesaw', 1, 0, 0], ['goal', 2, -1], ['goal', 1, 1]];
    const first = run(steps);
    const sim2 = new Simulation(buildCourse(steps), {}, first.sim.toggles).runToEnd();
    const goalOf = (s: Simulation) => s.events.find((e) => e.type === 'success')?.pieceId;
    expect(first.sim.status).toBe('success');
    expect(sim2.status).toBe('success');
    expect(goalOf(sim2)).not.toBe(goalOf(first.sim));
  });
});

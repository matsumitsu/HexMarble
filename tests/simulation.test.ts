import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS } from '../src/core/constants';
import { emptyCourse } from '../src/core/course';
import { buildCourse, sampleCourse } from '../src/core/sampleCourse';
import { neighbor } from '../src/core/hex';
import { Simulation } from '../src/core/simulation';

describe('運動計算', () => {
  it('スタートがなければ失敗', () => {
    const sim = new Simulation(emptyCourse());
    expect(sim.status).toBe('failed');
    expect(sim.failReason).toBe('no-start');
  });

  it('スタート → 直線 → ゴールで成功する', () => {
    const c = buildCourse([
      ['start', 0, 0, 0],
      ['straight', 1, 0, 0],
      ['goal', 2, 0],
    ]);
    const sim = new Simulation(c).runToEnd();
    expect(sim.status).toBe('success');
    expect(sim.events.filter((e) => e.type === 'enter').map((e) => e.pieceId)).toEqual([1, 2, 3]);
  });

  it('接続先がなければ放物線を描いて落下し、失敗になる', () => {
    const c = buildCourse([
      ['start', 0, 0, 0, 1],
    ]);
    const sim = new Simulation(c);
    const ys: number[] = [];
    const xs: number[] = [];
    while (!sim.finished) {
      sim.step();
      if (sim.status === 'falling') {
        ys.push(sim.position.y);
        xs.push(sim.position.x);
      }
    }
    expect(sim.failReason).toBe('fell');
    expect(ys.length).toBeGreaterThan(10);
    // 水平方向へは進み続け、高さは下がり続ける
    expect(xs[xs.length - 1]).toBeGreaterThan(xs[0]);
    expect(ys[ys.length - 1]).toBeLessThan(ys[0]);
    // 下に凸ではなく上に凸（放物線）：2階差分が負
    const d2 = ys[20] - 2 * ys[10] + ys[0];
    expect(d2).toBeLessThan(0);
  });

  it('上り坂で速度が0以下になると停止して失敗', () => {
    // 坂を低い側から登らせる（初速不足）
    const c = buildCourse([
      ['start', 0, 0, 0],
      ['slope', 1, 0, 0], // 辺3(低)から入り辺0(高)へ登る
      ['goal', 2, 0, 0, 1],
    ]);
    const sim = new Simulation(c, { startSpeed: 1 }).runToEnd();
    expect(sim.status).toBe('failed');
    expect(sim.failReason).toBe('stalled');
  });

  it('平らな直線が長すぎると一定の減衰で止まる', () => {
    const steps: Parameters<typeof buildCourse>[0] = [['start', -6, 0, 0]];
    for (let q = -5; q <= 6; q++) steps.push(['straight', q, 0, 0]);
    const sim = new Simulation(buildCourse(steps)).runToEnd();
    expect(sim.failReason).toBe('stalled');
  });

  it('下り坂では加速し、減衰だけなら減速する', () => {
    const c = buildCourse([
      ['start', 0, 0, 0, 1],
      ['slope', 1, 0, 3],
      ['straight', 2, 0, 0],
      ['goal', 3, 0],
    ]);
    const sim = new Simulation(c);
    const speedOn = new Map<number, number[]>();
    while (!sim.finished) {
      sim.step();
      if (sim.piece && sim.status !== 'falling') {
        const arr = speedOn.get(sim.piece.id) ?? [];
        arr.push(sim.speed);
        speedOn.set(sim.piece.id, arr);
      }
    }
    expect(sim.status).toBe('success');
    const slope = speedOn.get(2)!;
    const flat = speedOn.get(3)!;
    expect(slope[slope.length - 1]).toBeGreaterThan(slope[0]);
    expect(flat[flat.length - 1]).toBeLessThan(flat[0]);
    // 高低差による加速：v² の増分 ≈ 2g·Δh − 2·friction·距離
    const { gravity, friction } = DEFAULT_PHYSICS;
    const dv2 = slope[slope.length - 1] ** 2 - slope[0] ** 2;
    const len = Math.hypot(Math.sqrt(3), 0.5);
    expect(Math.abs(dv2 - (2 * gravity * 0.5 - 2 * friction * len))).toBeLessThan(0.2);
  });

  it('分岐は通るたびに出口を交互に切り替える', () => {
    // 分岐の出口2つを、それぞれゴールへ
    const c = buildCourse([
      ['start', -1, 0, 0],
      ['splitter', 0, 0, 3], // 入口(辺0)を西へ。出口は辺5と辺1
      ['goal', 0, 1],
      ['goal', 1, -1],
    ]);
    const first = new Simulation(c).runToEnd();
    expect(first.status).toBe('success');
    const firstGoal = first.events.find((e) => e.type === 'success')!.pieceId;

    // 再発射のときは分岐の状態を引き継ぐ
    const second = new Simulation(c, {}, first.toggles).runToEnd();
    const secondGoal = second.events.find((e) => e.type === 'success')!.pieceId;
    expect(new Set([firstGoal, secondGoal])).toEqual(new Set([3, 4]));
    // 3回目は1回目と同じ出口に戻る
    const third = new Simulation(c, {}, second.toggles).runToEnd();
    expect(third.events.find((e) => e.type === 'success')!.pieceId).toBe(firstGoal);
    // 引き継ぎ元の状態は変更されない
    expect(first.toggles.get(2)).toBe(1);
  });

  it('交差は2本の経路のどちらでも、まっすぐ抜ける', () => {
    for (const rot of [0, 1]) {
      const c = buildCourse([
        ['start', 0, 0, 0],
        ['cross', 1, 0, rot],
        ['goal', 2, 0],
      ]);
      const sim = new Simulation(c).runToEnd();
      expect(sim.status, `rot ${rot}`).toBe('success');
      expect(sim.events.filter((e) => e.type === 'enter').map((e) => e.pieceId)).toEqual([1, 2, 3]);
    }
    // 経路のない向き（回転2）では接続口がないので落ちる
    const c = buildCourse([
      ['start', 0, 0, 0],
      ['cross', 1, 0, 2],
      ['goal', 2, 0],
    ]);
    expect(new Simulation(c).runToEnd().failReason).toBe('fell');
  });

  it('合流は3つの入口のどれからでも辺0へ送り出し、出口からは入れない', () => {
    // 回転 rot の合流に西（ワールドの辺3）から入ると、ローカルの辺 3-rot から入る
    for (const rot of [1, 0, 5] as const) {
      const exit = neighbor(1, 0, rot);
      const c = buildCourse([
        ['start', 0, 0, 0],
        ['merge', 1, 0, rot],
        ['goal', exit.q, exit.r],
      ]);
      const sim = new Simulation(c).runToEnd();
      expect(sim.status, `rot ${rot}`).toBe('success');
    }
    const blocked = buildCourse([
      ['start', 0, 0, 0],
      ['merge', 1, 0, 3],
    ]);
    const sim = new Simulation(blocked).runToEnd();
    expect(sim.failReason).toBe('blocked');
  });

  it('Uターンは同じ辺・同じ高さへマーブルを送り返す', () => {
    // 分岐の辺2から入って辺0へ抜け、Uターンで戻り、分岐の辺0から辺4へ抜けてゴールする
    const out = neighbor(0, 0, 1);
    const goal = neighbor(0, 0, 5);
    const c = buildCourse([
      ['start', -1, 0, 0],
      ['splitter', 0, 0, 1],
      ['uturn', out.q, out.r, 4],
      ['goal', goal.q, goal.r],
    ]);
    const sim = new Simulation(c, {}, new Map([[2, 1]])).runToEnd();
    expect(sim.status).toBe('success');
    expect(sim.events.filter((e) => e.type === 'enter').map((e) => e.pieceId)).toEqual([1, 2, 3, 2, 4]);
  });

  it('Uターンから戻った先に経路がなければ止まる', () => {
    const c = buildCourse([
      ['start', 0, 0, 0],
      ['straight', 1, 0, 0],
      ['uturn', 2, 0, 3],
    ]);
    const sim = new Simulation(c).runToEnd();
    expect(sim.events.filter((e) => e.type === 'enter').map((e) => e.pieceId)).toEqual([1, 2, 3, 2]);
    expect(sim.failReason).toBe('blocked');
  });

  it('落下口から真下のタイルへ落ちる', () => {
    // ゴールの上に落下口。スタートを1レベル上げ、落下口の入口(辺0→西向き)へ
    const c2 = buildCourse([
      ['start', -1, 0, 0, 1],
      ['goal', 0, 0],
      ['drop', 0, 0, 3, 1],
    ]);
    const sim = new Simulation(c2).runToEnd();
    expect(sim.status).toBe('success');
    expect(sim.events.filter((e) => e.type === 'enter').map((e) => e.pieceId)).toEqual([1, 3, 2]);
  });

  it('落下口から隙間をあけた下のタイルへ、垂直に落ちて加速する', () => {
    const c = buildCourse([
      ['start', -1, 0, 0, 4],
      ['drop', 0, 0, 3, 4],
      ['straight', 0, 0, 0, 0],
      ['goal', 1, 0, 0, 0],
    ]);
    // 直線には up がないのでつながらない
    expect(new Simulation(c).runToEnd().status).toBe('failed');

    const c2 = buildCourse([
      ['start', -1, 0, 0, 4],
      ['drop', 0, 0, 3, 4],
      ['goal', 0, 0, 0, 0],
    ]);
    const sim = new Simulation(c2);
    let maxSpeed = 0;
    let x0 = NaN;
    let z0 = NaN;
    while (!sim.finished) {
      sim.step();
      // 落下口の下からゴールまで（レベル4→1 の上面）の区間は真下へまっすぐ落ちる
      if (sim.piece?.type === 'goal' && sim.position.y > 0.6) {
        if (Number.isNaN(x0)) {
          x0 = sim.position.x;
          z0 = sim.position.z;
        }
        expect(sim.position.x).toBeCloseTo(x0, 6);
        expect(sim.position.z).toBeCloseTo(z0, 6);
        maxSpeed = Math.max(maxSpeed, sim.speed);
      }
    }
    expect(sim.status).toBe('success');
    expect(sim.status).not.toBe('falling');
    // 1.5 の高さを落ちたぶん速くなる（v² ≈ 2gh）
    expect(maxSpeed).toBeGreaterThan(Math.sqrt(2 * DEFAULT_PHYSICS.gravity * 1.0));
  });

  it('同じコースなら毎回同じ結果になる（決定的）', () => {
    const run = () => {
      const sim = new Simulation(sampleCourse());
      const trace: number[] = [];
      let i = 0;
      while (!sim.finished) {
        sim.step();
        if (i++ % 50 === 0) trace.push(sim.position.x, sim.position.y, sim.position.z, sim.speed);
      }
      return { status: sim.status, time: sim.time, trace, events: sim.events };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
  });

  it('advance はフレーム分割に関係なく同じ結果になる', () => {
    const a = new Simulation(sampleCourse());
    const b = new Simulation(sampleCourse());
    for (let i = 0; i < 300; i++) a.advance(1 / 60);
    for (let i = 0; i < 100; i++) b.advance(3 / 60);
    expect(b.position).toEqual(a.position);
    expect(b.time).toBeCloseTo(a.time, 10);
  });

  it('サンプルコースはゴールに届く', () => {
    const sim = new Simulation(sampleCourse()).runToEnd();
    expect(sim.status).toBe('success');
    expect(sim.goalTime).toBeGreaterThan(0);
    expect(sim.goalTime).toBeLessThanOrEqual(sim.time);
  });
});

import { describe, expect, it } from 'vitest';
import { emptyCourse } from '../src/core/course';
import { AutoLauncher, type LauncherEvent } from '../src/core/launcher';
import { buildCourse, sampleCourse } from '../src/core/sampleCourse';

const runFor = (l: AutoLauncher, seconds: number, dt = 1 / 60): LauncherEvent[] => {
  const out: LauncherEvent[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(...l.advance(dt));
  return out;
};

describe('自動再発射', () => {
  it('スタートがなければ発射しない', () => {
    const l = new AutoLauncher(emptyCourse());
    expect(l.sim).toBeNull();
    expect(runFor(l, 2)).toEqual([]);
    expect(l.launches).toBe(0);
  });

  it('ゴールしたら goal → end を通知し、待ってから再発射する', () => {
    const l = new AutoLauncher(sampleCourse());
    const events = runFor(l, 12);
    const types = events.map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(['goal', 'end', 'launch']);
    expect(l.launches).toBeGreaterThanOrEqual(3);
    expect(l.lastResult?.status).toBe('success');
    const goal = events[0] as Extract<LauncherEvent, { type: 'goal' }>;
    expect(sampleCourse().pieces.find((p) => p.id === goal.pieceId)?.type).toBe('goal');
  });

  it('失敗しても再発射する', () => {
    const l = new AutoLauncher(buildCourse([['start', 0, 0, 0]]));
    const events = runFor(l, 8);
    expect(events.filter((e) => e.type === 'end').length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === 'launch').length).toBeGreaterThanOrEqual(2);
    expect(l.lastResult).toMatchObject({ status: 'failed', reason: 'fell' });
  });

  it('再発射のたびに分岐の出口が交互に切り替わる', () => {
    const c = buildCourse([
      ['start', -1, 0, 0],
      ['splitter', 0, 0, 3],
      ['goal', 0, 1],
      ['goal', 1, -1],
    ]);
    const l = new AutoLauncher(c);
    const goals = runFor(l, 12)
      .filter((e): e is Extract<LauncherEvent, { type: 'goal' }> => e.type === 'goal')
      .map((e) => e.pieceId);
    expect(goals.length).toBeGreaterThanOrEqual(4);
    expect(goals.slice(0, 4)).toEqual([goals[0], goals[1], goals[0], goals[1]]);
    expect(goals[0]).not.toBe(goals[1]);
  });

  it('コースを差し替えると最初から発射し直す', () => {
    const l = new AutoLauncher(sampleCourse());
    runFor(l, 1);
    l.setCourse(emptyCourse());
    expect(l.sim).toBeNull();
    l.setCourse(sampleCourse());
    expect(l.sim?.time).toBe(0);
    expect(l.lastResult).toBeNull();
  });
});

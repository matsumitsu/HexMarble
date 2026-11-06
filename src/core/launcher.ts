import type { PhysicsParams } from './constants';
import type { Course } from './course';
import { Simulation, type FailReason } from './simulation';

/** 再発射までの待ち時間 [s]（シミュレーション時間） */
export const RELAUNCH_DELAY = 0.8;

export interface LaunchResult {
  status: 'success' | 'failed';
  /** ゴール到達時刻、または失敗した時刻 */
  time: number;
  reason?: FailReason;
}

export type LauncherEvent =
  | { type: 'launch' }
  | { type: 'goal'; pieceId: number; time: number }
  | { type: 'chime'; pieceId: number }
  | { type: 'end'; result: LaunchResult };

/**
 * マーブルを繰り返し発射する。ゴールしても失敗しても、少し待ってからスタートから再発射する。
 * 分岐の切り替え状態は再発射のあいだ引き継ぐので、発射のたびに出口が交互に変わる。
 * スタートがないコースでは発射しない（sim は null）。
 */
export class AutoLauncher {
  sim: Simulation | null = null;
  lastResult: LaunchResult | null = null;
  /** これまでに発射した回数 */
  launches = 0;
  private wait = 0;
  private goalReported = false;
  private endReported = false;
  /** sim.events のうち、すでに伝えた件数 */
  private eventCursor = 0;

  constructor(
    public course: Course,
    private readonly params: Partial<PhysicsParams> = {},
    readonly relaunchDelay = RELAUNCH_DELAY,
  ) {
    this.restart();
  }

  /** コースを差し替えて、分岐の状態も初期化して発射し直す */
  setCourse(course: Course): void {
    this.course = course;
    this.lastResult = null;
    this.restart();
  }

  /** スタートから発射し直す。keepToggles が false なら分岐の状態も初期化する */
  restart(keepToggles = false): LauncherEvent[] {
    const toggles = keepToggles ? this.sim?.toggles : undefined;
    const sim = new Simulation(this.course, this.params, toggles);
    this.wait = 0;
    this.goalReported = false;
    this.endReported = false;
    this.eventCursor = 0;
    if (sim.failReason === 'no-start') {
      this.sim = null;
      return [];
    }
    this.sim = sim;
    this.launches++;
    return [{ type: 'launch' }];
  }

  /** シミュレーション時間を dt 秒進め、起きた出来事を返す */
  advance(dt: number): LauncherEvent[] {
    const sim = this.sim;
    if (!sim) return [];
    const events: LauncherEvent[] = [];
    if (!sim.finished) sim.advance(dt);
    for (; this.eventCursor < sim.events.length; this.eventCursor++) {
      const e = sim.events[this.eventCursor];
      if (e.type === 'chime' && e.pieceId !== undefined) events.push({ type: 'chime', pieceId: e.pieceId });
    }

    if (sim.status === 'success' && !this.goalReported) {
      this.goalReported = true;
      events.push({ type: 'goal', pieceId: sim.piece!.id, time: sim.goalTime ?? sim.time });
    }
    if (sim.finished) {
      if (!this.endReported) {
        this.endReported = true;
        this.lastResult =
          sim.status === 'success'
            ? { status: 'success', time: sim.goalTime ?? sim.time }
            : { status: 'failed', time: sim.time, reason: sim.failReason ?? undefined };
        events.push({ type: 'end', result: this.lastResult });
      } else {
        this.wait += dt;
      }
      if (this.wait >= this.relaunchDelay) events.push(...this.restart(true));
    }
    return events;
  }
}

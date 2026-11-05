import { DEFAULT_PHYSICS, LEVEL_HEIGHT, type PhysicsParams } from './constants';
import { CourseIndex, findConnection, toLocalPortId, toWorldPortId, type WorldPort } from './connections';
import type { Course, Piece } from './course';
import { axialToWorld, rotateXZ } from './hex';
import { getPart, type PortId, type RouteDef } from './parts';
import { buildPolyline, sampleAt, v3, type Polyline, type Vec3 } from './path';

export type SimStatus = 'ready' | 'rolling' | 'falling' | 'success' | 'failed';
export type FailReason = 'no-start' | 'fell' | 'stalled' | 'blocked' | 'timeout';

export interface WorldRoute {
  def: RouteDef;
  /** ワールド向きの入口（'start' はそのまま） */
  from: PortId | 'start';
  to: PortId | 'goal';
  poly: Polyline;
}

export interface SimEvent {
  time: number;
  type: 'enter' | 'switch' | 'success' | 'fail';
  pieceId?: number;
  reason?: FailReason;
}

/** パーツの経路をワールド座標に変換する */
export function worldRoutes(piece: Piece): WorldRoute[] {
  const { x: cx, z: cz } = axialToWorld(piece.q, piece.r);
  const baseY = piece.level * LEVEL_HEIGHT;
  return getPart(piece.type).routes.map((def) => {
    const pts = def.points.map((p) => {
      const rp = rotateXZ(p.x, p.z, piece.rot);
      return v3(cx + rp.x, baseY + p.y, cz + rp.z);
    });
    return {
      def,
      from: def.from === 'start' ? 'start' : toWorldPortId(def.from, piece.rot),
      to: def.to === 'goal' ? 'goal' : toWorldPortId(def.to, piece.rot),
      poly: buildPolyline(pts),
    };
  });
}

/**
 * 経路に沿った決定的な球の運動。
 * 速度は「高低差による加速（-g·dy/ds）」と「一定の減衰（friction）」だけで決まる。
 * 固定タイムステップで積分するので、同じコースなら毎回同じ結果になる。
 */
export class Simulation {
  readonly params: PhysicsParams;
  status: SimStatus = 'ready';
  failReason: FailReason | null = null;
  time = 0;
  /** ゴールに入った時刻 */
  goalTime: number | null = null;
  /** 経路に沿った速さ */
  speed = 0;
  /** 現在のパーツ */
  piece: Piece | null = null;
  route: WorldRoute | null = null;
  /** 経路上の弧長位置 */
  s = 0;
  /** 分岐パーツの切り替えカウンタ（pieceId → 通過回数） */
  readonly toggles = new Map<number, number>();
  readonly events: SimEvent[] = [];
  /** 球の中心位置 */
  position: Vec3 = v3(0, 0, 0);
  /** 落下中の速度ベクトル */
  private fallVel: Vec3 = v3(0, 0, 0);
  private fallTime = 0;
  private settled = false;
  private accumulator = 0;
  private readonly index: CourseIndex;
  private readonly routeCache = new Map<number, WorldRoute[]>();

  constructor(readonly course: Course, params: Partial<PhysicsParams> = {}) {
    this.params = { ...DEFAULT_PHYSICS, ...params };
    this.index = new CourseIndex(course);
    const start = course.pieces.find((p) => p.type === 'start');
    const startRoute = start && this.routesOf(start).find((r) => r.from === 'start');
    if (!start || !startRoute) {
      this.fail('no-start');
      return;
    }
    this.enter(start, startRoute, 0);
    this.speed = this.params.startSpeed;
  }

  get finished(): boolean {
    return this.status === 'failed' || (this.status === 'success' && this.settled);
  }

  routesOf(piece: Piece): WorldRoute[] {
    let r = this.routeCache.get(piece.id);
    if (!r) {
      r = worldRoutes(piece);
      this.routeCache.set(piece.id, r);
    }
    return r;
  }

  /** 実時間を進める。内部では固定ステップで積分する */
  advance(seconds: number, maxSteps = 5000): void {
    this.accumulator += seconds;
    let n = 0;
    while (this.accumulator >= this.params.dt && n < maxSteps) {
      this.step();
      this.accumulator -= this.params.dt;
      n++;
    }
    if (n >= maxSteps) this.accumulator = 0;
  }

  /** 終了するまで進める（テスト・判定用） */
  runToEnd(): this {
    while (!this.finished) this.step();
    return this;
  }

  step(): void {
    if (this.finished) return;
    const { dt, gravity, friction, maxTime } = this.params;
    if (this.status === 'ready') this.status = 'rolling';
    this.time += dt;
    if (this.time > maxTime && this.status !== 'success') {
      this.fail('timeout');
      return;
    }

    if (this.status === 'falling') {
      this.fallVel = v3(this.fallVel.x, this.fallVel.y - gravity * dt, this.fallVel.z);
      this.position = v3(
        this.position.x + this.fallVel.x * dt,
        this.position.y + this.fallVel.y * dt,
        this.position.z + this.fallVel.z * dt,
      );
      this.fallTime += dt;
      if (this.fallTime >= this.params.fallTime) this.fail('fell');
      return;
    }

    const route = this.route!;
    const { slope } = sampleAt(route.poly, this.s);
    this.speed += (-gravity * slope - friction) * dt;
    if (this.speed <= 0) {
      this.speed = 0;
      if (this.status === 'success') this.settled = true;
      else this.fail('stalled');
      return;
    }
    this.s += this.speed * dt;

    // 境界を越えたら接続先の経路へ乗り継ぐ（1ステップで複数パーツを越える場合も処理）
    while (this.route && this.s >= this.route.poly.length) {
      const cur = this.route;
      if (cur.to === 'goal') {
        this.s = cur.poly.length;
        this.speed = 0;
        this.settled = true;
        break;
      }
      const overflow = this.s - cur.poly.length;
      if (!this.transfer(cur, overflow)) return;
    }
    this.position = sampleAt(this.route!.poly, this.s).pos;
  }

  /** 出口から接続先へ乗り継ぐ。失敗・落下したら false */
  private transfer(cur: WorldRoute, overflow: number): boolean {
    const piece = this.piece!;
    const exitPort = getPart(piece.type).ports.find((p) => p.id === toLocalPortId(cur.to as PortId, piece.rot))!;
    const port: WorldPort = { id: cur.to as PortId, localId: exitPort.id, level: piece.level + exitPort.h };
    const conn = findConnection(this.index, piece, port);
    if (!conn) {
      const end = sampleAt(cur.poly, cur.poly.length);
      this.position = end.pos;
      this.fallVel = v3(end.tangent.x * this.speed, end.tangent.y * this.speed, end.tangent.z * this.speed);
      this.status = 'falling';
      this.fallTime = 0;
      return false;
    }
    const candidates = this.routesOf(conn.piece).filter((r) => r.from === conn.port.id);
    if (candidates.length === 0) {
      this.position = sampleAt(cur.poly, cur.poly.length).pos;
      this.fail('blocked');
      return false;
    }
    let next = candidates[0];
    if (candidates.length > 1) {
      const count = this.toggles.get(conn.piece.id) ?? 0;
      next = candidates[count % candidates.length];
      this.toggles.set(conn.piece.id, count + 1);
      this.events.push({ time: this.time, type: 'switch', pieceId: conn.piece.id });
    }
    this.enter(conn.piece, next, overflow);
    return true;
  }

  private enter(piece: Piece, route: WorldRoute, s: number): void {
    this.piece = piece;
    this.route = route;
    this.s = s;
    this.position = sampleAt(route.poly, Math.min(s, route.poly.length)).pos;
    this.events.push({ time: this.time, type: 'enter', pieceId: piece.id });
    if (route.to === 'goal' && this.status !== 'success') {
      this.status = 'success';
      this.goalTime = this.time;
      this.events.push({ time: this.time, type: 'success', pieceId: piece.id });
    }
  }

  private fail(reason: FailReason): void {
    this.status = 'failed';
    this.failReason = reason;
    this.events.push({ time: this.time, type: 'fail', reason, pieceId: this.piece?.id });
  }
}

export const FAIL_MESSAGES: Record<FailReason, string> = {
  'no-start': 'スタートがありません',
  fell: 'コースから落ちました',
  stalled: '勢いが足りず止まりました',
  blocked: '行き止まりです',
  timeout: '時間切れです',
};

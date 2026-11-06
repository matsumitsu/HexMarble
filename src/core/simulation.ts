import { BALL_RADIUS, DEFAULT_PHYSICS, LEVEL_HEIGHT, type PhysicsParams } from './constants';
import { CourseIndex, findConnection, toLocalPortId, toWorldPortId, type WorldPort } from './connections';
import { warpPairs, type Course, type Piece } from './course';
import { axialToWorld, rotateXZ, worldToAxial } from './hex';
import { getPart, type PortId, type RouteDef } from './parts';
import { buildPolyline, sampleAt, v3, type Polyline, type Vec3 } from './path';

/** 'falling' は経路から外れて落ちている（失敗が確定する）、'flying' はジャンプ台から飛んでいる（着地できる） */
export type SimStatus = 'ready' | 'rolling' | 'falling' | 'flying' | 'success' | 'failed';
export type FailReason = 'no-start' | 'fell' | 'stalled' | 'blocked' | 'timeout' | 'no-warp' | 'crashed';

export interface WorldRoute {
  def: RouteDef;
  /** ワールド向きの入口（'start' / 'warp' はそのまま） */
  from: RouteDef['from'];
  to: RouteDef['to'];
  poly: Polyline;
}

export interface SimEvent {
  time: number;
  type: 'enter' | 'switch' | 'success' | 'fail' | 'chime' | 'jump' | 'land' | 'warp';
  pieceId?: number;
  reason?: FailReason;
}

const isPortId = (id: string | number): id is PortId => typeof id === 'number' || id === 'up' || id === 'down';

function toWorld<T extends string | number>(id: T, rot: number): T {
  return (isPortId(id) ? toWorldPortId(id, rot) : id) as T;
}

/** ジャンプ台から飛んできたマーブルを受け止める高さ（マーブルの中心）。土台の上面にマーブルが触れる高さ */
export function catchHeight(piece: Piece): number {
  return (piece.level + getPart(piece.type).span - 1) * LEVEL_HEIGHT + LEVEL_HEIGHT / 2 + BALL_RADIUS;
}

/** タイルの経路をワールド座標に変換する */
export function worldRoutes(piece: Piece): WorldRoute[] {
  const { x: cx, z: cz } = axialToWorld(piece.q, piece.r);
  const baseY = piece.level * LEVEL_HEIGHT;
  return getPart(piece.type).routes.map((def) => {
    const pts = def.points.map((p) => {
      const rp = rotateXZ(p.x, p.z, piece.rot);
      return v3(cx + rp.x, baseY + p.y, cz + rp.z);
    });
    return { def, from: toWorld(def.from, piece.rot), to: toWorld(def.to, piece.rot), poly: buildPolyline(pts) };
  });
}

/**
 * 経路に沿った決定的なマーブルの運動。
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
  /** 現在のタイル */
  piece: Piece | null = null;
  route: WorldRoute | null = null;
  /** 経路上の弧長位置 */
  s = 0;
  /** 分岐タイルの切り替えカウンタ（pieceId → 通過回数） */
  readonly toggles: Map<number, number>;
  readonly events: SimEvent[] = [];
  /** マーブルの中心位置 */
  position: Vec3 = v3(0, 0, 0);
  /** 落下中の速度ベクトル */
  private fallVel: Vec3 = v3(0, 0, 0);
  private fallTime = 0;
  private settled = false;
  private accumulator = 0;
  private readonly index: CourseIndex;
  private readonly routeCache = new Map<number, WorldRoute[]>();
  private readonly warps: ReturnType<typeof warpPairs>;
  /** ジャンプ台から飛び出したタイル（踏み切ったタイルには衝突しない） */
  private launchedFrom: number | null = null;

  /**
   * @param toggles 分岐の切り替え状態の初期値。再発射のときに前回の状態を渡すと、
   *   発射のたびに出口が交互に切り替わる（渡した Map は変更しない）
   */
  constructor(readonly course: Course, params: Partial<PhysicsParams> = {}, toggles?: ReadonlyMap<number, number>) {
    this.params = { ...DEFAULT_PHYSICS, ...params };
    this.toggles = new Map(toggles);
    this.index = new CourseIndex(course);
    this.warps = warpPairs(course);
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

    if (this.status === 'falling' || this.status === 'flying') {
      const prevY = this.position.y;
      this.fallVel = v3(this.fallVel.x, this.fallVel.y - gravity * dt, this.fallVel.z);
      this.position = v3(
        this.position.x + this.fallVel.x * dt,
        this.position.y + this.fallVel.y * dt,
        this.position.z + this.fallVel.z * dt,
      );
      this.fallTime += dt;
      if (this.status === 'flying') this.stepFlight(prevY);
      else if (this.fallTime >= this.params.fallTime) this.fail('fell');
      return;
    }

    const route = this.route!;
    const def = route.def;
    const sample = sampleAt(route.poly, this.s);
    if (def.conveyor !== undefined) {
      this.speed = def.conveyor;
    } else {
      this.speed += (-gravity * sample.slope - friction) * dt;
      if (def.drive) {
        const { speed: target, accel } = def.drive;
        this.speed = this.speed < target ? Math.min(target, this.speed + accel * dt) : Math.max(target, this.speed - accel * dt);
      }
    }
    if (def.loop && this.status !== 'success') {
      const f = this.s / route.poly.length;
      if (f > def.loop.from && f < def.loop.to) {
        // 最下点からの角度 θ で cosθ = 1 - 高さ/半径。垂直抗力 ∝ v²/R + g·cosθ が負なら経路から離れる
        const rel = sample.pos.y - (this.piece!.level * LEVEL_HEIGHT + def.loop.bottomY);
        const cos = 1 - rel / def.loop.radius;
        if ((this.speed * this.speed) / def.loop.radius + gravity * cos < 0) {
          this.position = sample.pos;
          this.leaveTrack(sample.tangent, 'falling');
          return;
        }
      }
    }
    if (this.speed <= 0) {
      this.speed = 0;
      if (this.status === 'success') this.settled = true;
      else this.fail('stalled');
      return;
    }
    this.s += this.speed * dt;

    // 境界を越えたら接続先の経路へ乗り継ぐ（1ステップで複数タイルを越える場合も処理）
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

  /** 経路を離れて宙に出る（落下 / ジャンプ） */
  private leaveTrack(tangent: Vec3, status: 'falling' | 'flying'): void {
    this.fallVel = v3(tangent.x * this.speed, tangent.y * this.speed, tangent.z * this.speed);
    this.status = status;
    this.fallTime = 0;
  }

  /**
   * ジャンプ中の1ステップ。上に受け口のあるタイルの上面を、受け止められる範囲で下向きに通り抜けたら着地する。
   * それ以外のタイルや地面に当たったら失敗。
   */
  private stepFlight(prevY: number): void {
    const { x, y, z } = this.position;
    const cell = worldToAxial(x, z);
    for (const p of this.index.at(cell.q, cell.r)) {
      if (p.id === this.launchedFrom) continue;
      const def = getPart(p.type);
      const top = catchHeight(p);
      if (def.catchRadius && prevY >= top && y < top) {
        const c = axialToWorld(p.q, p.r);
        if (Math.hypot(x - c.x, z - c.z) <= def.catchRadius) {
          const candidates = this.routesOf(p).filter((r) => r.from === 'up');
          if (candidates.length > 0) {
            const route = this.pickRoute(p, candidates);
            const rest = route.poly.pts.filter((pt) => pt.y < y - 1e-6);
            const speed = Math.hypot(this.fallVel.x, this.fallVel.y, this.fallVel.z);
            this.status = 'rolling';
            this.events.push({ time: this.time, type: 'land', pieceId: p.id });
            this.enter(p, { ...route, poly: buildPolyline([this.position, ...rest]) }, 0);
            this.speed = speed;
            return;
          }
        }
      }
      if (y < top && y > p.level * LEVEL_HEIGHT - BALL_RADIUS) {
        this.fail('crashed');
        return;
      }
    }
    if (y < BALL_RADIUS) this.fail('crashed');
    else if (this.fallTime > 8) this.fail('fell');
  }

  /** 同じ入口の経路が複数あれば、通るたびに交互に選ぶ（分岐） */
  private pickRoute(piece: Piece, candidates: WorldRoute[]): WorldRoute {
    if (candidates.length === 1) return candidates[0];
    const count = this.toggles.get(piece.id) ?? 0;
    this.toggles.set(piece.id, count + 1);
    this.events.push({ time: this.time, type: 'switch', pieceId: piece.id });
    return candidates[count % candidates.length];
  }

  /** 出口から接続先へ乗り継ぐ。失敗・落下したら false */
  private transfer(cur: WorldRoute, overflow: number): boolean {
    const piece = this.piece!;
    if (cur.to === 'air') {
      const end = sampleAt(cur.poly, cur.poly.length);
      this.position = end.pos;
      this.launchedFrom = piece.id;
      this.events.push({ time: this.time, type: 'jump', pieceId: piece.id });
      this.leaveTrack(end.tangent, 'flying');
      return false;
    }
    if (cur.to === 'warp') {
      const partnerId = this.warps.get(piece.id)?.partner;
      const partner = partnerId != null ? this.course.pieces.find((p) => p.id === partnerId) : undefined;
      const out = partner && this.routesOf(partner).find((r) => r.from === 'warp');
      if (!partner || !out) {
        this.position = sampleAt(cur.poly, cur.poly.length).pos;
        this.fail('no-warp');
        return false;
      }
      this.events.push({ time: this.time, type: 'warp', pieceId: piece.id });
      this.enter(partner, out, overflow);
      return true;
    }
    const exitPort = getPart(piece.type).ports.find((p) => p.id === toLocalPortId(cur.to as PortId, piece.rot))!;
    const port: WorldPort = { id: cur.to as PortId, localId: exitPort.id, level: piece.level + exitPort.h };
    const conn = findConnection(this.index, piece, port);
    if (!conn) {
      const end = sampleAt(cur.poly, cur.poly.length);
      this.position = end.pos;
      this.leaveTrack(end.tangent, 'falling');
      return false;
    }
    const candidates = this.routesOf(conn.piece).filter((r) => r.from === conn.port.id);
    if (candidates.length === 0) {
      this.position = sampleAt(cur.poly, cur.poly.length).pos;
      this.fail('blocked');
      return false;
    }
    let next = this.pickRoute(conn.piece, candidates);
    // 落下口から隙間をあけて下のタイルへ落ちるときは、出口から入口までの垂直な区間を経路の先頭に足す
    const exit = sampleAt(cur.poly, cur.poly.length).pos;
    const entry = next.poly.pts[0];
    if (exit.y - entry.y > 1e-6) {
      next = { ...next, poly: buildPolyline([exit, ...next.poly.pts]) };
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
    if (getPart(piece.type).chime) this.events.push({ time: this.time, type: 'chime', pieceId: piece.id });
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
  'no-warp': 'ワープの組の相手がありません',
  crashed: 'タイルか地面にぶつかりました',
};

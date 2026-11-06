import { describe, expect, it } from 'vitest';
import { analyzeConnections, areConnected, CourseIndex, findConnection, placementConnects, worldPorts } from '../src/core/connections';
import { emptyCourse, placePiece, type Course } from '../src/core/course';
import { axialToWorld, neighbor, oppositeSide, rotateXZ, SIDES, worldToAxial } from '../src/core/hex';
import { PARTS, portLocalPosition } from '../src/core/parts';
import { buildCourse } from '../src/core/sampleCourse';
import { worldRoutes } from '../src/core/simulation';

const place = (c: Course, ...args: Parameters<typeof placePiece> extends [Course, ...infer R] ? R : never): Course => {
  const res = placePiece(c, ...args);
  if (!res.ok) throw new Error(res.reason);
  return res.course;
};

describe('hex grid', () => {
  it('隣接セルの中心距離は √3 で、辺の向きと一致する', () => {
    for (const side of SIDES) {
      const n = neighbor(0, 0, side);
      const w = axialToWorld(n.q, n.r);
      expect(Math.hypot(w.x, w.z)).toBeCloseTo(Math.sqrt(3));
      const angle = Math.atan2(-w.z, w.x);
      const expected = (side * Math.PI) / 3;
      expect(Math.cos(angle)).toBeCloseTo(Math.cos(expected));
      expect(Math.sin(angle)).toBeCloseTo(Math.sin(expected));
    }
  });

  it('ワールド座標からアキシャル座標へ戻せる', () => {
    for (let q = -3; q <= 3; q++)
      for (let r = -3; r <= 3; r++) {
        const w = axialToWorld(q, r);
        expect(worldToAxial(w.x + 0.2, w.z - 0.3)).toEqual({ q, r });
      }
  });

  it('60°回転で辺 i の中点は辺 i+1 の中点へ移る', () => {
    const e0 = portLocalPosition({ id: 0, h: 0 });
    const e1 = portLocalPosition({ id: 1, h: 0 });
    const r = rotateXZ(e0.x, e0.z, 1);
    expect(r.x).toBeCloseTo(e1.x);
    expect(r.z).toBeCloseTo(e1.z);
  });
});

describe('タイル定義', () => {
  it('経路の端点は接続口の位置と一致する', () => {
    for (const def of Object.values(PARTS)) {
      for (const route of def.routes) {
        const first = route.points[0];
        const last = route.points[route.points.length - 1];
        if (route.from !== 'start' && route.from !== 'warp') {
          const port = def.ports.find((p) => p.id === route.from);
          expect(port, `${def.type} from ${route.from}`).toBeDefined();
          const pos = portLocalPosition(port!);
          expect(first.x).toBeCloseTo(pos.x);
          expect(first.y).toBeCloseTo(pos.y);
          expect(first.z).toBeCloseTo(pos.z);
        }
        if (route.to !== 'goal' && route.to !== 'air' && route.to !== 'warp') {
          const port = def.ports.find((p) => p.id === route.to);
          expect(port, `${def.type} to ${route.to}`).toBeDefined();
          const pos = portLocalPosition(port!);
          expect(last.x).toBeCloseTo(pos.x);
          expect(last.y).toBeCloseTo(pos.y);
          expect(last.z).toBeCloseTo(pos.z);
        }
      }
    }
  });

  it('隣り合うタイルの接続口はワールド座標でも同じ点になる', () => {
    let c = emptyCourse();
    c = place(c, 'straight', 0, 0, 0);
    c = place(c, 'curve60', 1, 0, 3);
    const [a, b] = c.pieces;
    const ra = worldRoutes(a).find((r) => r.to === 0)!;
    const rb = worldRoutes(b).find((r) => r.from === 3)!;
    const pa = ra.poly.pts[ra.poly.pts.length - 1];
    const pb = rb.poly.pts[0];
    expect(pa.x).toBeCloseTo(pb.x);
    expect(pa.y).toBeCloseTo(pb.y);
    expect(pa.z).toBeCloseTo(pb.z);
  });
});

describe('接続判定', () => {
  it('回転すると接続口の向きも回転する', () => {
    const ports = worldPorts({ type: 'straight', level: 0, rot: 1 }).map((p) => p.id);
    expect(ports).toEqual([1, 4]);
  });

  it('向かい合う辺の接続口が同じ高さならつながる', () => {
    let c = emptyCourse();
    c = place(c, 'straight', 0, 0, 0);
    c = place(c, 'straight', 1, 0, 0);
    expect(areConnected(c, 1, 2)).toBe(true);
    expect(areConnected(c, 2, 1)).toBe(true);
  });

  it('向きが合わなければつながらない', () => {
    let c = emptyCourse();
    c = place(c, 'straight', 0, 0, 0);
    c = place(c, 'straight', 1, 0, 1); // 辺1-4 向き
    expect(areConnected(c, 1, 2)).toBe(false);
  });

  it('高さが違えばつながらない', () => {
    let c = emptyCourse();
    c = place(c, 'straight', 0, 0, 0);
    c = place(c, 'straight', 1, 0, 0, 1);
    expect(areConnected(c, 1, 2)).toBe(false);
  });

  it('坂は高い側で1つ上のレベルとつながる', () => {
    let c = emptyCourse();
    c = place(c, 'straight', 0, 0, 0, 1); // レベル1
    c = place(c, 'slope', 1, 0, 3); // 高い側(辺0)を西(辺3)へ
    c = place(c, 'straight', 2, 0, 0); // レベル0
    const [straightHigh, slope, straightLow] = c.pieces;
    expect(areConnected(c, straightHigh.id, slope.id)).toBe(true);
    expect(areConnected(c, slope.id, straightLow.id)).toBe(true);
  });

  it('坂を逆向きに置くと高さが合わない', () => {
    let c = emptyCourse();
    c = place(c, 'straight', 0, 0, 0, 1);
    c = place(c, 'slope', 1, 0, 0);
    expect(areConnected(c, 1, 2)).toBe(false);
  });

  it('落下口の下の接続口は、真下のタイルの上の接続口とつながる', () => {
    let c = emptyCourse();
    c = place(c, 'goal', 0, 0);
    c = place(c, 'drop', 0, 0, 0);
    const index = new CourseIndex(c);
    const drop = c.pieces[1];
    const down = worldPorts(drop).find((p) => p.id === 'down')!;
    expect(findConnection(index, drop, down)?.piece.id).toBe(1);
  });

  it('落下口は、隙間があっても真下で一番近いタイルの上の接続口とつながる', () => {
    let c = emptyCourse();
    c = place(c, 'goal', 0, 0, 0, 0);
    c = place(c, 'drop', 0, 0, 0, 4);
    const index = new CourseIndex(c);
    const drop = c.pieces[1];
    const down = worldPorts(drop).find((p) => p.id === 'down')!;
    expect(findConnection(index, drop, down)?.piece.id).toBe(1);
    // ゴール側の up からも落下口へつながる（対称）
    const goal = c.pieces[0];
    const up = worldPorts(goal).find((p) => p.id === 'up')!;
    expect(findConnection(index, goal, up)?.piece.id).toBe(2);
  });

  it('落下口の真下で一番近いタイルに上の接続口がなければつながらない', () => {
    let c = emptyCourse();
    c = place(c, 'goal', 0, 0, 0, 0);
    c = place(c, 'straight', 0, 0, 0, 2); // 間に受け口のないタイル
    c = place(c, 'drop', 0, 0, 0, 4);
    const index = new CourseIndex(c);
    const drop = c.pieces[2];
    const down = worldPorts(drop).find((p) => p.id === 'down')!;
    expect(findConnection(index, drop, down)).toBeNull();
  });

  it('analyzeConnections は接続を重複なく数え、空いた接続口を返す', () => {
    let c = emptyCourse();
    c = place(c, 'straight', 0, 0, 0);
    c = place(c, 'straight', 1, 0, 0);
    const { connections, openPorts } = analyzeConnections(c);
    expect(connections).toHaveLength(1);
    expect(openPorts.map((p) => [p.piece.id, p.port.id])).toEqual([
      [1, 3],
      [2, 0],
    ]);
  });

  it('placementConnects は仮置きでつながるかを判定する', () => {
    const c = place(emptyCourse(), 'straight', 0, 0, 0);
    const index = new CourseIndex(c);
    expect(placementConnects(index, 'straight', 1, 0, 0, 0)).toBe(true);
    expect(placementConnects(index, 'straight', 1, 0, 0, 1)).toBe(false);
    expect(placementConnects(index, 'straight', 1, 0, 1, 0)).toBe(false);
  });

  it('全方向・全回転で接続の対称性が成り立つ', () => {
    for (const side of SIDES) {
      const n = neighbor(0, 0, side);
      // 辺 side 向きの直線 (rot = side) と、その隣の直線
      const c = buildCourse([
        ['straight', 0, 0, side],
        ['straight', n.q, n.r, oppositeSide(side)],
      ]);
      expect(areConnected(c, 1, 2)).toBe(true);
    }
  });
});

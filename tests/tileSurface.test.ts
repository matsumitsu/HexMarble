import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, HEX_SIZE, LEVEL_HEIGHT } from '../src/core/constants';
import { hexCorner } from '../src/core/hex';
import { PARTS, type PartType } from '../src/core/parts';
import { decksOf, DROP_HOLE_RADIUS, GROOVE_RADIUS, holeRadius, PLATE_TOP, surfaceHeight } from '../src/render/tileSurface';

/** 宙に浮いた樋（螺旋・ループ）やリフトの縦穴を通る区間があるタイル */
const FLOATING: PartType[] = ['spiral', 'loop', 'lift'];

const trackTypes = Object.keys(PARTS) as PartType[];

describe('タイルの土台とハーフパイプ', () => {
  it('土台の厚みは占有する高さの半分', () => {
    expect(PLATE_TOP).toBeCloseTo(LEVEL_HEIGHT / 2);
    // 坂（2レベル分）はくさび形で、低い側 0.25・高い側 0.75
    expect(surfaceHeight('slope', -0.7, 0.4)).toBeCloseTo(PLATE_TOP + (LEVEL_HEIGHT * (0.866 - 0.7)) / (2 * 0.866), 2);
  });

  it('マーブルは溝の底にちょうど接する（浮かず、めり込まない）', () => {
    for (const type of trackTypes) {
      for (const route of PARTS[type].routes) {
        if (route.from === 'up') continue; // 上から落ちてくる区間は宙を通る
        const pts = route.points;
        pts.forEach((p, i) => {
          const hole = holeRadius(type);
          if (hole > 0 && Math.hypot(p.x, p.z) < hole + 0.01) return;
          // マーブルの高さにある一番上の段
          const deck = Math.max(...decksOf(type).filter((d) => d * LEVEL_HEIGHT <= p.y));
          const h = surfaceHeight(type, p.x, p.z, deck);
          const where = `${type} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
          if (Number.isNaN(h)) return;
          // 浮かない（溝の底がマーブルの下端より上にない）
          expect(h, where).toBeLessThanOrEqual(p.y - BALL_RADIUS + 1e-6);
          if (FLOATING.includes(type) && p.y - BALL_RADIUS - h > 0.01) return; // 樋・縦穴の区間
          // 傾いた区間は水平距離で彫るため、傾き α に応じて R(1/cosα - 1) ほど深くなる。それ以外は 1cm 未満
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(pts.length - 1, i + 1)];
          const tan = Math.abs(b.y - a.y) / Math.max(1e-9, Math.hypot(b.x - a.x, b.z - a.z));
          const extra = GROOVE_RADIUS * (Math.sqrt(1 + tan * tan) - 1);
          expect(p.y - BALL_RADIUS - h, where).toBeLessThan(0.01 + extra);
        });
      }
    }
  });

  it('溝の外側は土台の上面のまま', () => {
    expect(surfaceHeight('straight', 0, 0.5)).toBeCloseTo(PLATE_TOP);
    expect(surfaceHeight('straight', 0, GROOVE_RADIUS + 0.01)).toBeCloseTo(PLATE_TOP);
    expect(surfaceHeight('straight', 0, GROOVE_RADIUS * 0.5)).toBeLessThan(PLATE_TOP);
  });

  it('溝が土台を突き抜けない（落下口の穴を除く）', () => {
    for (const type of trackTypes) {
      for (let i = 0; i < 6; i++) {
        const c = hexCorner(i, HEX_SIZE * 0.97);
        for (let k = 0; k <= 20; k++) {
          const h = surfaceHeight(type, (c.x * k) / 20, (c.z * k) / 20);
          if (Number.isNaN(h)) continue;
          // 漏斗はすり鉢の底（穴のまわり）が薄い
          expect(h, type).toBeGreaterThan(type === 'funnel' ? 0.02 : 0.05);
        }
      }
    }
  });

  it('落下口の中心には穴があいている', () => {
    expect(surfaceHeight('drop', 0, 0)).toBeNaN();
    expect(surfaceHeight('drop', 0, DROP_HOLE_RADIUS + 0.05)).toBeLessThan(PLATE_TOP);
  });
});

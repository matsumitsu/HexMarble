import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, HEX_SIZE, LEVEL_HEIGHT } from '../src/core/constants';
import { hexCorner } from '../src/core/hex';
import { PARTS, type PartType } from '../src/core/parts';
import { DROP_HOLE_RADIUS, GROOVE_RADIUS, PLATE_TOP, surfaceHeight } from '../src/render/tileSurface';

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
        for (const p of route.points) {
          if (type === 'drop' && Math.hypot(p.x, p.z) < DROP_HOLE_RADIUS + 0.01) continue;
          const h = surfaceHeight(type, p.x, p.z);
          const where = `${type} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;
          // 浮かない（溝の底がマーブルの下端より上にない）
          expect(h, where).toBeLessThanOrEqual(p.y - BALL_RADIUS + 1e-6);
          // 傾いた区間は水平距離で彫るためわずかに深くなるが、1cm 未満
          expect(p.y - BALL_RADIUS - h, where).toBeLessThan(0.01);
        }
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
          expect(h, type).toBeGreaterThan(0.05);
        }
      }
    }
  });

  it('落下口の中心には穴があいている', () => {
    expect(surfaceHeight('drop', 0, 0)).toBeNaN();
    expect(surfaceHeight('drop', 0, DROP_HOLE_RADIUS + 0.05)).toBeLessThan(PLATE_TOP);
  });
});

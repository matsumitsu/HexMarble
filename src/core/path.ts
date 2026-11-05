export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** 弧長テーブル付きの折れ線。経路の移動計算はこれだけを使う */
export interface Polyline {
  readonly pts: readonly Vec3[];
  /** 各点までの累積弧長 */
  readonly cum: readonly number[];
  readonly length: number;
}

export function buildPolyline(pts: readonly Vec3[]): Polyline {
  const clean: Vec3[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (!last || dist(last, p) > 1e-9) clean.push(p);
  }
  if (clean.length < 2) throw new Error('経路には2点以上が必要です');
  const cum = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + dist(clean[i - 1], clean[i]));
  return { pts: clean, cum, length: cum[cum.length - 1] };
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** 弧長 s に対応する区間番号（二分探索） */
export function segmentAt(pl: Polyline, s: number): number {
  const { cum } = pl;
  if (s <= 0) return 0;
  if (s >= pl.length) return cum.length - 2;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface PathSample {
  pos: Vec3;
  /** 単位接線ベクトル */
  tangent: Vec3;
  /** 高さの弧長微分 dy/ds */
  slope: number;
}

export function sampleAt(pl: Polyline, s: number): PathSample {
  const i = segmentAt(pl, s);
  const a = pl.pts[i];
  const b = pl.pts[i + 1];
  const segLen = pl.cum[i + 1] - pl.cum[i];
  const t = Math.min(1, Math.max(0, (s - pl.cum[i]) / segLen));
  const tangent = v3((b.x - a.x) / segLen, (b.y - a.y) / segLen, (b.z - a.z) / segLen);
  return {
    pos: v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
    tangent,
    slope: tangent.y,
  };
}

/** 2次ベジェ曲線をサンプリング（端点を含む n+1 点） */
export function quadBezier(p0: Vec3, p1: Vec3, p2: Vec3, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(
      v3(
        u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
        u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
      ),
    );
  }
  return out;
}

export function lineSegment(a: Vec3, b: Vec3, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
  }
  return out;
}

/** 点列を連結する（つなぎ目の重複点は除く） */
export function joinPaths(...parts: Vec3[][]): Vec3[] {
  const out: Vec3[] = [];
  for (const part of parts) {
    for (const p of part) {
      const last = out[out.length - 1];
      if (!last || dist(last, p) > 1e-9) out.push(p);
    }
  }
  return out;
}

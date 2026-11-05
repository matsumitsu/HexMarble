/** 六角形セルの外接円半径（ワールド単位） */
export const HEX_SIZE = 1;
/** 六角形の中心から辺の中点までの距離 */
export const APOTHEM = (HEX_SIZE * Math.sqrt(3)) / 2;
/** 高さ1レベルあたりのワールド高さ */
export const LEVEL_HEIGHT = 0.5;
/** 置ける最大レベル（0〜MAX_LEVEL） */
export const MAX_LEVEL = 8;
/** グリッドの半径（中心セルからのセル数） */
export const GRID_RADIUS = 6;
/** 球の半径 */
export const BALL_RADIUS = 0.12;
/** レール上を転がる球の中心の、パーツ底面からの高さ */
export const TRACK_Y = 0.2;

export interface PhysicsParams {
  /** 重力加速度 */
  gravity: number;
  /** 一定の減衰（転がり抵抗による減速度） */
  friction: number;
  /** 固定タイムステップ [s] */
  dt: number;
  /** スタートの初速 */
  startSpeed: number;
  /** シミュレーションの打ち切り時間 [s] */
  maxTime: number;
  /** 落下を演出する時間 [s]（経過後に失敗確定） */
  fallTime: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  gravity: 6,
  friction: 0.25,
  dt: 1 / 240,
  startSpeed: 2.2,
  maxTime: 180,
  fallTime: 1.6,
};

import * as THREE from 'three';

const ROCKETS = 3;
const SPARKS = 48;
const RISE_TIME = 0.42;
const RISE_SPEED = 2.6;
const SPARK_LIFE = 1.0;
const GRAVITY = 2.2;
const COLORS = [0xffd23f, 0x3fb8af, 0xe55381, 0x7f7eff, 0xff7a45].map((c) => new THREE.Color(c));

interface Rocket {
  delay: number;
  origin: THREE.Vector3;
  drift: THREE.Vector3;
  color: THREE.Color;
}

/**
 * ゴールタイルから打ち上がる小さな花火。
 * 加算合成の点群で描き、色を暗くしてフェードさせる（未使用の点は黒＝見えない）。
 */
export class Fireworks {
  readonly points: THREE.Points;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly vel = new Float32Array(ROCKETS * SPARKS * 3);
  private readonly dir = new Float32Array(ROCKETS * SPARKS * 3);
  private rockets: Rocket[] = [];
  private t = 0;
  private active = false;
  private seed = 1;

  constructor() {
    const n = ROCKETS * SPARKS;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    this.col = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.075, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    // 爆発の方向は球面上に均等に散らす（毎回同じ形）
    for (let i = 0; i < n; i++) {
      const k = i % SPARKS;
      const y = 1 - (2 * (k + 0.5)) / SPARKS;
      const r = Math.sqrt(1 - y * y);
      const a = k * 2.399963 + Math.floor(i / SPARKS);
      this.dir.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    }
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  launch(at: THREE.Vector3): void {
    this.rockets = Array.from({ length: ROCKETS }, (_, i) => ({
      delay: i * 0.18,
      origin: at.clone(),
      drift: new THREE.Vector3((this.rnd() - 0.5) * 0.9, 0, (this.rnd() - 0.5) * 0.9),
      color: COLORS[Math.floor(this.rnd() * COLORS.length)],
    }));
    this.t = 0;
    this.active = true;
    this.points.visible = true;
  }

  clear(): void {
    this.active = false;
    this.points.visible = false;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    let alive = false;
    const c = new THREE.Color();
    this.rockets.forEach((rk, ri) => {
      const lt = this.t - rk.delay;
      for (let k = 0; k < SPARKS; k++) {
        const i = ri * SPARKS + k;
        if (lt < 0) {
          this.col.setXYZ(i, 0, 0, 0);
          alive = true;
          continue;
        }
        if (lt < RISE_TIME) {
          // 上昇中：先頭の数個の点で尾を引く
          const lag = Math.min(k, 5) * 0.03;
          const tt = Math.max(0, lt - lag);
          this.pos.setXYZ(i, rk.origin.x + rk.drift.x * tt, rk.origin.y + RISE_SPEED * tt, rk.origin.z + rk.drift.z * tt);
          const bright = k < 6 ? 1 - k / 6 : 0;
          c.copy(rk.color).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(bright);
          this.col.setXYZ(i, c.r, c.g, c.b);
          if (lt + dt >= RISE_TIME) {
            const sp = 0.9 + ((k * 7) % 5) * 0.08;
            this.vel.set([this.dir[i * 3] * sp + rk.drift.x * 0.3, this.dir[i * 3 + 1] * sp + 0.4, this.dir[i * 3 + 2] * sp + rk.drift.z * 0.3], i * 3);
            this.pos.setXYZ(i, rk.origin.x + rk.drift.x * RISE_TIME, rk.origin.y + RISE_SPEED * RISE_TIME, rk.origin.z + rk.drift.z * RISE_TIME);
          }
          alive = true;
          continue;
        }
        const et = lt - RISE_TIME;
        if (et > SPARK_LIFE) {
          this.col.setXYZ(i, 0, 0, 0);
          continue;
        }
        alive = true;
        this.vel[i * 3 + 1] -= GRAVITY * dt;
        const drag = Math.exp(-2.2 * dt);
        this.vel[i * 3] *= drag;
        this.vel[i * 3 + 1] *= drag;
        this.vel[i * 3 + 2] *= drag;
        this.pos.setXYZ(
          i,
          this.pos.getX(i) + this.vel[i * 3] * dt,
          this.pos.getY(i) + this.vel[i * 3 + 1] * dt,
          this.pos.getZ(i) + this.vel[i * 3 + 2] * dt,
        );
        const fade = 1 - et / SPARK_LIFE;
        const twinkle = 0.75 + 0.25 * Math.sin((et * 30 + k) * 1.7);
        c.copy(rk.color).multiplyScalar(fade * fade * twinkle * 1.4);
        this.col.setXYZ(i, c.r, c.g, c.b);
      }
    });
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    if (!alive) this.clear();
  }
}

import * as THREE from 'three';
import { BALL_RADIUS, GRID_RADIUS, HEX_SIZE, LEVEL_HEIGHT } from '../core/constants';
import { analyzeConnections } from '../core/connections';
import { warpPairs, type Course, type Piece } from '../core/course';
import { axialToWorld, cellsInRadius, hexCorner, type Axial } from '../core/hex';
import { getPart, portLocalPosition, type PartType } from '../core/parts';
import { Fireworks } from './fireworks';
import { createGhostMesh, createPartMesh, hexShape } from './meshes';

export type CellHighlight = 'none' | 'placeable' | 'connects' | 'blocked';

const GHOST_COLORS: Record<CellHighlight, THREE.Color> = {
  none: new THREE.Color(0x35557a),
  placeable: new THREE.Color(0x4a7fc0),
  connects: new THREE.Color(0x2fdf81),
  blocked: new THREE.Color(0x80304a),
};

const TILE_COLORS: Record<CellHighlight, THREE.Color> = {
  none: new THREE.Color(0x1e2738),
  placeable: new THREE.Color(0x35557a),
  connects: new THREE.Color(0x2fbf71),
  blocked: new THREE.Color(0x3a2230),
};

interface PieceEntry {
  sig: string;
  group: THREE.Group;
}

const sigOf = (p: Piece, warpPair: string) => `${p.type}|${p.q}|${p.r}|${p.level}|${p.rot}|${warpPair}`;

/** ワープの組ごとの色。組の相手がいないワープは灰色 */
const WARP_COLORS = [0x4cc9f0, 0xf72585, 0x80ed99, 0xffd166, 0xb388eb, 0xff8c42];
export function warpColor(pair: number | null): number {
  return pair === null ? 0x666c78 : WARP_COLORS[pair % WARP_COLORS.length];
}

/** コースの3D表示。ロジックは持たず、渡された状態を描くだけ */
export class CourseView {
  readonly root = new THREE.Group();
  readonly cells: Axial[] = cellsInRadius(GRID_RADIUS);
  readonly tiles: THREE.InstancedMesh;
  /** ゴースト：設置モードで、置こうとしているレベルに出す半透明の六角グリッド。配置できるかの色分けもここに出す */
  private readonly levelGhost: THREE.Group;
  private readonly levelGhostCells: THREE.InstancedMesh;
  private readonly piecesRoot = new THREE.Group();
  private readonly entries = new Map<number, PieceEntry>();
  private readonly ghostMats = {
    ok: new THREE.MeshStandardMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.45, depthWrite: false }),
    ng: new THREE.MeshStandardMaterial({ color: 0xff5d73, transparent: true, opacity: 0.4, depthWrite: false }),
  };
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  /** 宙に置くタイルの高さが分かるよう、地面までの目安線と地面の枠を出す */
  private readonly ghostGuide: THREE.Group;
  private readonly selection: THREE.LineLoop;
  private readonly hover: THREE.LineLoop;
  private readonly portMarkers: THREE.InstancedMesh;
  readonly ball: THREE.Mesh;
  private readonly fireworks = new Fireworks();
  private time = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.root.add(this.piecesRoot);

    // 地面
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(HEX_SIZE * Math.sqrt(3) * (GRID_RADIUS + 1.2), HEX_SIZE * Math.sqrt(3) * (GRID_RADIUS + 1.6), 0.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.95 }),
    );
    base.rotation.y = Math.PI / 6;
    base.position.y = -0.24;
    base.receiveShadow = true;
    this.root.add(base);

    const tileGeo = new THREE.ExtrudeGeometry(hexShape(HEX_SIZE * 0.95), { depth: 0.03, bevelEnabled: false });
    tileGeo.rotateX(-Math.PI / 2);
    tileGeo.translate(0, -0.035, 0);
    this.tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), this.cells.length);
    const m = new THREE.Matrix4();
    this.cells.forEach((c, i) => {
      const w = axialToWorld(c.q, c.r);
      m.makeTranslation(w.x, 0, w.z);
      this.tiles.setMatrixAt(i, m);
      this.tiles.setColorAt(i, TILE_COLORS.none);
    });
    this.tiles.receiveShadow = true;
    this.root.add(this.tiles);

    const ghostGeo = new THREE.ShapeGeometry(hexShape(HEX_SIZE * 0.93));
    ghostGeo.rotateX(-Math.PI / 2);
    this.levelGhostCells = new THREE.InstancedMesh(
      ghostGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
      this.cells.length,
    );
    const edge: number[] = [];
    this.cells.forEach((c, i) => {
      const w = axialToWorld(c.q, c.r);
      m.makeTranslation(w.x, 0, w.z);
      this.levelGhostCells.setMatrixAt(i, m);
      this.levelGhostCells.setColorAt(i, TILE_COLORS.placeable);
      for (let k = 0; k < 6; k++) {
        const c0 = hexCorner(k, HEX_SIZE * 0.93);
        const c1 = hexCorner((k + 1) % 6, HEX_SIZE * 0.93);
        edge.push(w.x + c0.x, 0, w.z + c0.z, w.x + c1.x, 0, w.z + c1.z);
      }
    });
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    const edges = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.levelGhostCells.renderOrder = 1;
    edges.renderOrder = 2;
    this.levelGhost = new THREE.Group();
    this.levelGhost.add(this.levelGhostCells, edges);
    this.levelGhost.visible = false;
    this.root.add(this.levelGhost);

    this.selection = hexOutline(0xffffff, 1.0);
    this.hover = hexOutline(0x9fd3ff, 0.97);
    this.selection.visible = false;
    this.hover.visible = false;
    this.root.add(this.selection, this.hover);

    // 目安線は高さ1の線を scale.y で伸ばす
    const pole = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]),
      new THREE.LineDashedMaterial({ color: 0x9fd3ff, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.8 }),
    );
    pole.computeLineDistances();
    const ground = hexOutline(0x9fd3ff, 0.6);
    ground.position.y = 0.02;
    this.ghostGuide = new THREE.Group();
    this.ghostGuide.add(pole, ground);
    this.ghostGuide.visible = false;
    this.root.add(this.ghostGuide);

    this.portMarkers = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff9f43 }),
      512,
    );
    this.portMarkers.count = 0;
    this.root.add(this.portMarkers);

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0xff7a45, metalness: 0.35, roughness: 0.18, emissive: 0x3a1000 }),
    );
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.root.add(this.ball);

    this.root.add(this.fireworks.points);
  }

  /** コースの変化分だけメッシュを作り直す */
  syncCourse(course: Course, showPorts: boolean): void {
    const alive = new Set<number>();
    const warps = warpPairs(course);
    for (const p of course.pieces) {
      alive.add(p.id);
      const wp = warps.get(p.id);
      const warpPair = wp ? (wp.partner === null ? null : wp.pair) : null;
      const sig = sigOf(p, wp ? String(warpPair) : '');
      const e = this.entries.get(p.id);
      if (e && e.sig === sig) continue;
      if (e) this.piecesRoot.remove(e.group);
      const group = createPartMesh(p.type);
      const w = axialToWorld(p.q, p.r);
      group.position.set(w.x, p.level * LEVEL_HEIGHT, w.z);
      group.rotation.y = (p.rot * Math.PI) / 3;
      group.userData.pieceId = p.id;
      group.traverse((o) => (o.userData.pieceId = p.id));
      if (wp) this.paintWarp(group, warpColor(warpPair));
      this.piecesRoot.add(group);
      this.entries.set(p.id, { sig, group });
    }
    for (const [id, e] of this.entries) {
      if (!alive.has(id)) {
        this.piecesRoot.remove(e.group);
        this.entries.delete(id);
      }
    }
    this.updatePortMarkers(course, showPorts);
  }

  /** ワープの輪を組の色で塗る（タイルごとに材質を複製する） */
  private paintWarp(group: THREE.Group, color: number): void {
    const ring = group.getObjectByName('portal') as THREE.Mesh | undefined;
    const core = group.getObjectByName('portalCore') as THREE.Mesh | undefined;
    if (ring) {
      const m = (ring.material as THREE.MeshStandardMaterial).clone();
      m.color.setHex(color);
      m.emissive.setHex(color).multiplyScalar(0.6);
      ring.material = m;
    }
    if (core) {
      const m = (core.material as THREE.MeshBasicMaterial).clone();
      m.color.setHex(color);
      core.material = m;
    }
  }

  /** チャイムの鐘を揺らす */
  ringChime(pieceId: number): void {
    const bell = this.entries.get(pieceId)?.group.getObjectByName('bell');
    if (bell) bell.userData.ringAt = this.time;
  }

  /** つながっていない接続口に印を付ける */
  private updatePortMarkers(course: Course, show: boolean): void {
    if (!show) {
      this.portMarkers.count = 0;
      return;
    }
    const { openPorts } = analyzeConnections(course);
    const m = new THREE.Matrix4();
    let n = 0;
    for (const { piece, port } of openPorts) {
      if (port.id === 'up' || port.id === 'down') continue;
      if (piece.type === 'goal') continue; // ゴールは全方向が入口なので印を省く
      if (n >= this.portMarkers.instanceMatrix.count) break;
      const def = getPart(piece.type).ports.find((p) => p.id === port.localId)!;
      const local = portLocalPosition(def);
      const v = new THREE.Vector3(local.x * 1.04, local.y, local.z * 1.04).applyAxisAngle(new THREE.Vector3(0, 1, 0), (piece.rot * Math.PI) / 3);
      const w = axialToWorld(piece.q, piece.r);
      m.makeTranslation(w.x + v.x, piece.level * LEVEL_HEIGHT + v.y, w.z + v.z);
      this.portMarkers.setMatrixAt(n++, m);
    }
    this.portMarkers.count = n;
    this.portMarkers.instanceMatrix.needsUpdate = true;
  }

  pieceGroups(): THREE.Object3D[] {
    return [...this.entries.values()].map((e) => e.group);
  }

  /** 配置できるか・つながるかをゴーストのセルに色分けする */
  setHighlights(get: (cell: Axial) => CellHighlight): void {
    this.cells.forEach((c, i) => this.levelGhostCells.setColorAt(i, GHOST_COLORS[get(c)]));
    if (this.levelGhostCells.instanceColor) this.levelGhostCells.instanceColor.needsUpdate = true;
  }

  /** ゴースト（設置レベルの半透明グリッド）を出す。null で隠す */
  setLevelGhost(level: number | null): void {
    this.levelGhost.visible = level !== null;
    if (level !== null) this.levelGhost.position.y = level * LEVEL_HEIGHT + 0.004;
  }

  setGhost(type: PartType | null, cell: Axial | null, level: number, rot: number, ok: boolean): void {
    this.ghostGuide.visible = !!(type && cell && level > 0);
    if (this.ghostGuide.visible && cell) {
      const w = axialToWorld(cell.q, cell.r);
      this.ghostGuide.position.set(w.x, 0, w.z);
      this.ghostGuide.children[0].scale.y = level * LEVEL_HEIGHT;
    }
    const key = type && cell ? `${type}|${ok}` : '';
    if (key !== this.ghostKey) {
      if (this.ghost) this.root.remove(this.ghost);
      this.ghost = type && cell ? createGhostMesh(type, ok ? this.ghostMats.ok : this.ghostMats.ng) : null;
      if (this.ghost) this.root.add(this.ghost);
      this.ghostKey = key;
    }
    if (this.ghost && cell) {
      const w = axialToWorld(cell.q, cell.r);
      this.ghost.position.set(w.x, level * LEVEL_HEIGHT + 0.01, w.z);
      this.ghost.rotation.y = (rot * Math.PI) / 3;
    }
  }

  setHover(cell: Axial | null, level = 0): void {
    this.hover.visible = !!cell;
    if (cell) {
      const w = axialToWorld(cell.q, cell.r);
      this.hover.position.set(w.x, level * LEVEL_HEIGHT + 0.02, w.z);
    }
  }

  setSelection(piece: Piece | null): void {
    this.selection.visible = !!piece;
    if (piece) {
      const w = axialToWorld(piece.q, piece.r);
      const top = piece.level + getPart(piece.type).span;
      this.selection.position.set(w.x, top * LEVEL_HEIGHT + 0.03, w.z);
    }
  }

  /** 分岐タイルの羽根の向きとシーソーの傾きを、次にマーブルが向かう出口に合わせる */
  setSplitterStates(course: Course, toggles: ReadonlyMap<number, number>): void {
    for (const p of course.pieces) {
      if (p.type === 'seesaw') {
        const plank = this.entries.get(p.id)?.group.getObjectByName('plank');
        if (!plank) continue;
        // 次の出口（0: 辺1 = -z 側, 1: 辺5 = +z 側）の側を低くする
        const target = (toggles.get(p.id) ?? 0) % 2 === 0 ? -0.22 : 0.22;
        plank.rotation.x += (target - plank.rotation.x) * 0.25;
        continue;
      }
      if (p.type !== 'splitter') continue;
      const flipper = this.entries.get(p.id)?.group.getObjectByName('flipper');
      if (!flipper) continue;
      const next = (toggles.get(p.id) ?? 0) % 2;
      const target = next === 0 ? -0.45 : 0.45;
      flipper.rotation.y += (target - flipper.rotation.y) * 0.3;
    }
  }

  setBall(pos: { x: number; y: number; z: number } | null): void {
    this.ball.visible = !!pos;
    if (pos) this.ball.position.set(pos.x, pos.y, pos.z);
  }

  /** ゴールタイルから小さな花火を打ち上げる */
  launchFireworks(piece: Piece): void {
    const w = axialToWorld(piece.q, piece.r);
    this.fireworks.launch(new THREE.Vector3(w.x, (piece.level + getPart(piece.type).span) * LEVEL_HEIGHT, w.z));
  }

  clearEffects(): void {
    this.fireworks.clear();
  }

  /** 毎フレームのアニメーション */
  tick(dt: number): void {
    this.time += dt;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 5);
    (this.selection.material as THREE.LineBasicMaterial).opacity = pulse;
    for (const e of this.entries.values()) {
      const gem = e.group.getObjectByName('gem');
      if (gem) {
        gem.rotation.y = this.time * 1.5;
        gem.position.y = (gem.userData.baseY as number) + Math.sin(this.time * 2) * 0.05;
      }
      const bell = e.group.getObjectByName('bell');
      if (bell) {
        const t = this.time - ((bell.userData.ringAt as number | undefined) ?? -99);
        bell.rotation.x = t < 3 ? Math.sin(t * 18) * 0.5 * Math.exp(-t * 2.2) : 0;
      }
      const car = e.group.getObjectByName('liftCar');
      if (car) {
        const k = 0.5 - 0.5 * Math.cos(this.time * 1.6);
        car.position.y = car.userData.y0 + (car.userData.y1 - car.userData.y0) * k;
      }
      const core = e.group.getObjectByName('portalCore');
      if (core) core.scale.setScalar(0.85 + 0.15 * Math.sin(this.time * 4));
    }
    this.fireworks.update(dt);
  }
}

function hexOutline(color: number, scale: number): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const c = hexCorner(i, HEX_SIZE * scale);
    pts.push(new THREE.Vector3(c.x, 0, c.z));
  }
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true }));
  line.renderOrder = 10;
  return line;
}


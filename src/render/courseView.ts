import * as THREE from 'three';
import { BALL_RADIUS, GRID_RADIUS, HEX_SIZE, LEVEL_HEIGHT } from '../core/constants';
import { analyzeConnections } from '../core/connections';
import type { Course, Piece } from '../core/course';
import { axialToWorld, cellsInRadius, hexCorner, type Axial } from '../core/hex';
import { getPart, portLocalPosition, type PartType } from '../core/parts';
import { Fireworks } from './fireworks';
import { createGhostMesh, createPartMesh, hexShape } from './meshes';

export type CellHighlight = 'none' | 'placeable' | 'connects' | 'blocked';

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

const sigOf = (p: Piece) => `${p.type}|${p.q}|${p.r}|${p.level}|${p.rot}`;

/** コースの3D表示。ロジックは持たず、渡された状態を描くだけ */
export class CourseView {
  readonly root = new THREE.Group();
  readonly cells: Axial[] = cellsInRadius(GRID_RADIUS);
  readonly tiles: THREE.InstancedMesh;
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
    for (const p of course.pieces) {
      alive.add(p.id);
      const sig = sigOf(p);
      const e = this.entries.get(p.id);
      if (e && e.sig === sig) continue;
      if (e) this.piecesRoot.remove(e.group);
      const group = createPartMesh(p.type);
      const w = axialToWorld(p.q, p.r);
      group.position.set(w.x, p.level * LEVEL_HEIGHT, w.z);
      group.rotation.y = (p.rot * Math.PI) / 3;
      group.userData.pieceId = p.id;
      group.traverse((o) => (o.userData.pieceId = p.id));
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

  setHighlights(get: (cell: Axial) => CellHighlight): void {
    this.cells.forEach((c, i) => this.tiles.setColorAt(i, TILE_COLORS[get(c)]));
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
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

  /** 分岐タイルの羽根の向きを、次にマーブルが向かう出口に合わせる */
  setSplitterStates(course: Course, toggles: ReadonlyMap<number, number>): void {
    for (const p of course.pieces) {
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


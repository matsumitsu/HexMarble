import * as THREE from 'three';
import { GRID_RADIUS, HEX_SIZE, MAX_LEVEL } from './core/constants';
import { CourseIndex, placementConnects } from './core/connections';
import {
  canPlace,
  emptyCourse,
  getPiece,
  lowerPiece,
  placePiece,
  raisePiece,
  removePiece,
  rotatePiece,
  stackTop,
  type Course,
  type EditResult,
  type Piece,
} from './core/course';
import { History } from './core/history';
import { mod6, worldToAxial, type Axial } from './core/hex';
import { AutoLauncher, type LaunchResult } from './core/launcher';
import { getPart, PALETTE_ORDER, type PartType } from './core/parts';
import { sampleCourse } from './core/sampleCourse';
import { FAIL_MESSAGES } from './core/simulation';
import { CourseView, type CellHighlight } from './render/courseView';
import { createScene, type SceneContext } from './render/scene';
import { downloadJson, loadFromLocal, readJsonFile, saveToLocal } from './storage';
import { Ui, type Mode } from './ui/ui';

/** 右クリック長押しで削除するまでの時間 [ms] */
const HOLD_TO_DELETE_MS = 500;
/** これ以上ポインタが動いたらクリック・長押しではなくドラッグとみなす [px] */
const DRAG_THRESHOLD = 6;

export class App {
  private readonly ctx: SceneContext;
  private readonly view: CourseView;
  private readonly ui: Ui;
  private readonly history: History<Course>;
  private readonly launcher: AutoLauncher;
  private mode: Mode = 'edit';
  private tool: PartType | null = null;
  private ghostRot = 0;
  /** 設置モードで E / Shift+E で指定した設置レベル（null ならセルの最上部） */
  private placeLevel: number | null = null;
  private selectedId: number | null = null;
  private hoverCell: Axial | null = null;
  private hoverPieceId: number | null = null;
  /** 実行モードでの再生状態（編集モードでは常に再生する） */
  private playing = true;
  private speed = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private downAt: { x: number; y: number } | null = null;
  private hold: { x: number; y: number; pieceId: number; timer: number } | null = null;
  private lastTime = performance.now();
  private highlightsDirty = true;

  constructor(root: HTMLElement) {
    this.ui = new Ui(root, {
      onMode: (m) => this.setMode(m),
      onTool: (t) => this.setTool(t),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onRotate: (d) => this.selectedId !== null && this.apply(rotatePiece(this.course, this.selectedId, d)),
      onRaise: () => this.selectedId !== null && this.apply(raisePiece(this.course, this.selectedId)),
      onLower: () => this.selectedId !== null && this.apply(lowerPiece(this.course, this.selectedId)),
      onDelete: () => this.selectedId !== null && this.deletePiece(this.selectedId),
      onPlayPause: () => this.togglePlay(),
      onReset: () => this.relaunch(),
      onSpeed: (s) => {
        this.speed = s;
        this.refreshUi();
      },
      onSave: () => {
        saveToLocal(this.course);
        this.ui.toast('ブラウザに保存しました');
      },
      onLoad: () => this.loadLocal(),
      onExport: () => downloadJson(this.course),
      onImport: (f) =>
        readJsonFile(f)
          .then((c) => this.replaceCourse(c, 'JSONファイルを読み込みました'))
          .catch((e: Error) => this.ui.toast(`読み込めませんでした：${e.message}`, 'error')),
      onNew: () => this.replaceCourse(emptyCourse(), '新しいコースです'),
      onSample: () => this.replaceCourse(sampleCourse(), 'サンプルコースを読み込みました'),
    });
    this.ctx = createScene(this.ui.viewport);
    this.view = new CourseView(this.ctx.scene);

    let initial = sampleCourse();
    try {
      initial = loadFromLocal() ?? initial;
    } catch {
      /* 壊れた保存データは無視してサンプルを使う */
    }
    this.history = new History(initial);
    this.launcher = new AutoLauncher(initial);
    this.bindInput();
    this.onCourseChanged();
    requestAnimationFrame(this.frame);
  }

  get course(): Course {
    return this.history.present;
  }

  private get selected(): Piece | null {
    return this.selectedId === null ? null : (getPiece(this.course, this.selectedId) ?? null);
  }

  private get hoveredPiece(): Piece | null {
    return this.hoverPieceId === null ? null : (getPiece(this.course, this.hoverPieceId) ?? null);
  }

  // ---- 編集 ----

  private apply(res: EditResult, select = true): boolean {
    if (!res.ok) {
      this.ui.toast(res.reason, 'error');
      return false;
    }
    this.history.push(res.course);
    if (select && res.pieceId !== undefined) this.selectedId = res.pieceId;
    this.onCourseChanged();
    return true;
  }

  private replaceCourse(course: Course, msg: string): void {
    this.setMode('edit');
    this.history.push(course);
    this.selectedId = null;
    this.onCourseChanged();
    this.ui.toast(msg);
  }

  private loadLocal(): void {
    try {
      const c = loadFromLocal();
      if (!c) {
        this.ui.toast('保存されたコースがありません', 'error');
        return;
      }
      this.replaceCourse(c, 'ブラウザから読み込みました');
    } catch (e) {
      this.ui.toast(`読み込めませんでした：${(e as Error).message}`, 'error');
    }
  }

  private undo(): void {
    if (this.mode !== 'edit' || !this.history.undo()) return;
    this.onCourseChanged();
  }

  private redo(): void {
    if (this.mode !== 'edit' || !this.history.redo()) return;
    this.onCourseChanged();
  }

  /**
   * R キー。設置モードなら置く前のタイルを、そうでなければカーソル下のタイル
   * （なければ選択中のタイル）を回転する
   */
  private rotateKey(delta: number): void {
    if (this.tool) {
      this.ghostRot = mod6(this.ghostRot + delta);
      this.highlightsDirty = true;
      this.updateGhost();
      return;
    }
    const target = this.hoveredPiece ?? this.selected;
    if (target) this.apply(rotatePiece(this.course, target.id, delta), false);
  }

  /** E キー。カーソル下のタイル（なければ選択中のタイル）を1レベル上げる / 下げる */
  private levelKey(up: boolean): void {
    if (this.tool) {
      const cell = this.hoverCell;
      const cur = cell ? this.ghostLevel(cell) : (this.placeLevel ?? 0);
      const next = Math.min(MAX_LEVEL, Math.max(0, cur + (up ? 1 : -1)));
      this.placeLevel = next;
      this.highlightsDirty = true;
      this.updateGhost();
      this.ui.toast(`設置レベル ${next}`);
      return;
    }
    const target = this.hoveredPiece ?? this.selected;
    if (!target) return;
    this.apply(up ? raisePiece(this.course, target.id) : lowerPiece(this.course, target.id), false);
    this.updateGhost();
  }

  /** WASD で押されているキー */
  private readonly moveKeys = new Set<string>();

  /** 押されている WASD に従い、カメラを視線方向基準で水平に動かす */
  private moveCamera(dt: number): void {
    if (this.moveKeys.size === 0) return;
    const { camera, controls } = this.ctx;
    const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0);
    if (fwd.lengthSq() < 1e-8) return;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = new THREE.Vector3();
    if (this.moveKeys.has('w')) dir.add(fwd);
    if (this.moveKeys.has('s')) dir.sub(fwd);
    if (this.moveKeys.has('d')) dir.add(right);
    if (this.moveKeys.has('a')) dir.sub(right);
    if (dir.lengthSq() === 0) return;
    const speed = camera.position.distanceTo(controls.target) * 0.8;
    const move = dir.normalize().multiplyScalar(speed * dt);
    // グリッドから離れすぎないように注視点を制限する
    const limit = GRID_RADIUS * HEX_SIZE * 2.2;
    const next = controls.target.clone().add(move);
    const len = Math.hypot(next.x, next.z);
    if (len > limit) {
      next.x *= limit / len;
      next.z *= limit / len;
    }
    move.subVectors(next, controls.target);
    controls.target.add(move);
    camera.position.add(move);
  }

  /** Q キー。設置モードなら終了し、そうでなければカーソル下のタイルを種類・向きごと拾う */
  private eyedropper(): void {
    if (this.tool) {
      this.setTool(null);
      return;
    }
    const p = this.hoveredPiece;
    if (!p) return;
    this.ghostRot = p.rot;
    this.setTool(p.type);
    this.placeLevel = p.level;
    this.highlightsDirty = true;
    this.updateGhost();
    this.ui.toast(`${getPart(p.type).name}を拾いました`);
  }

  private deletePiece(id: number): void {
    if (this.apply(removePiece(this.course, id), false) && this.selectedId === id) {
      this.selectedId = null;
      this.onCourseChanged();
    }
  }

  private setTool(tool: PartType | null): void {
    if (this.mode !== 'edit') this.setMode('edit');
    this.tool = tool;
    if (tool) this.selectedId = null;
    else this.placeLevel = null;
    this.highlightsDirty = true;
    this.view.setSelection(null);
    this.updateGhost();
    this.refreshUi();
  }

  private onCourseChanged(): void {
    if (this.selectedId !== null && !this.selected) this.selectedId = null;
    if (this.hoverPieceId !== null && !this.hoveredPiece) this.hoverPieceId = null;
    if (this.launcher.course !== this.course) {
      this.launcher.setCourse(this.course);
      this.view.clearEffects();
    }
    this.view.syncCourse(this.course, this.mode === 'edit');
    this.view.setSelection(this.mode === 'edit' ? this.selected : null);
    this.highlightsDirty = true;
    this.updateGhost();
    this.refreshUi();
  }

  /** 配置できるセル・つながるセルをハイライトする */
  private updateHighlights(): void {
    this.highlightsDirty = false;
    const tool = this.tool;
    if (this.mode !== 'edit' || !tool) {
      this.view.setHighlights(() => 'none');
      return;
    }
    const index = new CourseIndex(this.course);
    this.view.setHighlights(({ q, r }): CellHighlight => {
      const check = canPlace(this.course, tool, q, r, this.placeLevel ?? undefined);
      if (!check.ok) return 'blocked';
      return placementConnects(index, tool, q, r, check.level, this.ghostRot) ? 'connects' : 'placeable';
    });
  }

  /** 設置モードでカーソル位置に置くときのレベル（未指定ならセルの最上部） */
  private ghostLevel(cell: Axial): number {
    return this.placeLevel ?? stackTop(this.course, cell.q, cell.r);
  }

  private updateGhost(): void {
    const cell = this.mode === 'edit' ? this.hoverCell : null;
    if (!cell || !this.tool) {
      this.view.setGhost(null, null, 0, 0, false);
      // 選択ツールではカーソル下のタイルの上面に枠を出す（R・Q の対象）
      const hp = this.hoveredPiece;
      if (cell && hp) this.view.setHover(cell, hp.level + getPart(hp.type).span);
      else this.view.setHover(cell, cell ? stackTop(this.course, cell.q, cell.r) : 0);
      return;
    }
    const level = this.ghostLevel(cell);
    const check = canPlace(this.course, this.tool, cell.q, cell.r, level);
    this.view.setGhost(this.tool, cell, level, this.ghostRot, check.ok);
    this.view.setHover(cell, level);
  }

  // ---- マーブルの発射 ----

  private setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.downAt = null;
    this.cancelHold();
    if (mode === 'run') {
      this.hoverCell = null;
      this.hoverPieceId = null;
      this.relaunch();
      this.playing = true;
    }
    this.onCourseChanged();
  }

  /** スタートから発射し直す（分岐の状態も初期化） */
  private relaunch(): void {
    this.launcher.restart();
    this.view.clearEffects();
    this.refreshUi();
  }

  private togglePlay(): void {
    if (this.mode !== 'run') {
      this.setMode('run');
      return;
    }
    this.playing = !this.playing;
    this.refreshUi();
  }

  private resultText(r: LaunchResult): string {
    return r.status === 'success' ? `ゴール ${r.time.toFixed(2)} 秒` : `失敗：${FAIL_MESSAGES[r.reason ?? 'fell']}`;
  }

  private runStatus(): { text: string; kind: 'idle' | 'running' | 'success' | 'failed' } {
    const s = this.launcher.sim;
    if (!s) return { text: FAIL_MESSAGES['no-start'], kind: 'failed' };
    const last = this.launcher.lastResult;
    const suffix = last ? `（前回：${this.resultText(last)}）` : '';
    if (s.finished && last) return { text: this.resultText(last), kind: last.status };
    switch (s.status) {
      case 'ready':
      case 'rolling':
        return { text: `走行中 ${s.time.toFixed(2)} 秒${suffix}`, kind: 'running' };
      case 'falling':
        return { text: `落下中…${suffix}`, kind: 'failed' };
      case 'success':
        return { text: `ゴール ${(s.goalTime ?? s.time).toFixed(2)} 秒`, kind: 'success' };
      case 'failed':
        return { text: `失敗：${FAIL_MESSAGES[s.failReason!]}`, kind: 'failed' };
    }
  }

  private refreshUi(): void {
    const st = this.runStatus();
    this.ui.update({
      mode: this.mode,
      tool: this.tool,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      selected: this.tool ? null : this.selected,
      playing: this.playing,
      speed: this.speed,
      statusText: st.text,
      statusKind: st.kind,
    });
  }

  // ---- 入力 ----

  private pick(ev: { clientX: number; clientY: number }): { cell: Axial | null; pieceId: number | null } {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    const hits = this.raycaster.intersectObjects([this.view.tiles, ...this.view.pieceGroups()], true);
    for (const hit of hits) {
      const pid = hit.object.userData.pieceId as number | undefined;
      if (pid !== undefined) {
        const p = getPiece(this.course, pid);
        if (p) return { cell: { q: p.q, r: p.r }, pieceId: pid };
      }
      if (hit.object === this.view.tiles && hit.instanceId !== undefined) {
        return { cell: this.view.cells[hit.instanceId], pieceId: null };
      }
    }
    // グリッドの外側でも、地面の平面上の位置からセルを求める
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, pt)) return { cell: worldToAxial(pt.x, pt.z), pieceId: null };
    return { cell: null, pieceId: null };
  }

  private startHold(ev: PointerEvent): void {
    this.cancelHold();
    const { pieceId } = this.pick(ev);
    if (pieceId === null) return;
    const timer = window.setTimeout(() => {
      const h = this.hold;
      this.hold = null;
      this.ui.hideHold();
      if (h && getPiece(this.course, h.pieceId)) this.deletePiece(h.pieceId);
    }, HOLD_TO_DELETE_MS);
    this.hold = { x: ev.clientX, y: ev.clientY, pieceId, timer };
    this.ui.showHold(ev.clientX, ev.clientY, HOLD_TO_DELETE_MS);
  }

  private cancelHold(): void {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.hold = null;
    this.ui.hideHold();
  }

  private bindInput(): void {
    const el = this.ctx.renderer.domElement;
    el.addEventListener('pointermove', (ev) => {
      if (this.hold && Math.hypot(ev.clientX - this.hold.x, ev.clientY - this.hold.y) > DRAG_THRESHOLD) this.cancelHold();
      if (this.mode !== 'edit') return;
      const { cell, pieceId } = this.pick(ev);
      const inGrid = cell && this.view.cells.some((c) => c.q === cell.q && c.r === cell.r) ? cell : null;
      if (inGrid?.q !== this.hoverCell?.q || inGrid?.r !== this.hoverCell?.r || pieceId !== this.hoverPieceId) {
        this.hoverCell = inGrid;
        this.hoverPieceId = pieceId;
        this.updateGhost();
      }
    });
    el.addEventListener('pointerleave', () => {
      this.hoverCell = null;
      this.hoverPieceId = null;
      this.cancelHold();
      this.updateGhost();
    });
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button === 0) this.downAt = { x: ev.clientX, y: ev.clientY };
      if (ev.button === 2 && this.mode === 'edit') this.startHold(ev);
    });
    el.addEventListener('pointercancel', () => this.cancelHold());
    el.addEventListener('pointerup', (ev) => {
      if (ev.button === 2) this.cancelHold();
      const d = this.downAt;
      this.downAt = null;
      if (ev.button !== 0 || !d || this.mode !== 'edit') return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > DRAG_THRESHOLD) return; // ドラッグはカメラ操作
      const { cell, pieceId } = this.pick(ev);
      if (this.tool) {
        if (cell) this.apply(placePiece(this.course, this.tool, cell.q, cell.r, this.ghostRot, this.ghostLevel(cell)), false);
      } else {
        this.selectedId = pieceId;
        this.onCourseChanged();
      }
    });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());

    window.addEventListener('keydown', (ev) => {
      const target = ev.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      const ctrl = ev.ctrlKey || ev.metaKey;
      const key = ev.key;
      const lower = key.toLowerCase();
      if (!ctrl && !ev.altKey && 'wasd'.includes(lower) && lower.length === 1) {
        this.moveKeys.add(lower);
        return;
      }
      if (ctrl && lower === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) this.redo();
        else this.undo();
      } else if (ctrl && lower === 'y') {
        ev.preventDefault();
        this.redo();
      } else if (ctrl || ev.altKey) {
        return;
      } else if (key === 'Tab') {
        ev.preventDefault();
        this.setMode(this.mode === 'edit' ? 'run' : 'edit');
      } else if (key === ' ') {
        ev.preventDefault();
        this.togglePlay();
      } else if (this.mode === 'run') {
        if (key === 'Backspace' || lower === 'x') this.relaunch();
        else if (key === 'Escape') this.setMode('edit');
      } else if (lower === 'r') {
        this.rotateKey(ev.shiftKey ? 1 : -1);
      } else if (lower === 'q') {
        this.eyedropper();
      } else if (lower === 'e') {
        this.levelKey(!ev.shiftKey);
      } else if (key === 'Delete' || key === 'Backspace') {
        ev.preventDefault();
        if (this.selectedId !== null) this.deletePiece(this.selectedId);
      } else if (key === 'PageUp' || key === ']') {
        ev.preventDefault();
        if (this.selectedId !== null) this.apply(raisePiece(this.course, this.selectedId));
      } else if (key === 'PageDown' || key === '[') {
        ev.preventDefault();
        if (this.selectedId !== null) this.apply(lowerPiece(this.course, this.selectedId));
      } else if (key === 'Escape') {
        this.selectedId = null;
        this.setTool(null);
        this.onCourseChanged();
      } else if (/^[1-9]$/.test(key)) {
        const t = PALETTE_ORDER[Number(key) - 1];
        if (t) this.setTool(this.tool === t ? null : t);
      }
    });
    window.addEventListener('keyup', (ev) => this.moveKeys.delete(ev.key.toLowerCase()));
    window.addEventListener('blur', () => this.moveKeys.clear());
  }

  // ---- ループ ----

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.highlightsDirty) this.updateHighlights();

    // 編集モードでも常にマーブルを転がし、ゴール・失敗後は自動で再発射する
    if (this.mode === 'edit' || this.playing) {
      for (const e of this.launcher.advance(dt * this.speed)) {
        if (e.type === 'goal') {
          const goal = getPiece(this.course, e.pieceId);
          if (goal) this.view.launchFireworks(goal);
        }
      }
      if (this.mode === 'run') this.refreshUi();
    }
    const sim = this.launcher.sim;
    this.view.setBall(sim ? sim.position : null);
    this.view.setSplitterStates(this.course, sim ? sim.toggles : new Map());

    this.view.tick(dt);
    this.moveCamera(dt);
    this.ctx.controls.update();
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    requestAnimationFrame(this.frame);
  };
}

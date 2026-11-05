import * as THREE from 'three';
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
import { worldToAxial, type Axial } from './core/hex';
import { mod6 } from './core/hex';
import { PALETTE_ORDER, type PartType } from './core/parts';
import { sampleCourse } from './core/sampleCourse';
import { FAIL_MESSAGES, Simulation } from './core/simulation';
import { CourseView, type CellHighlight } from './render/courseView';
import { createScene, type SceneContext } from './render/scene';
import { downloadJson, loadFromLocal, readJsonFile, saveToLocal } from './storage';
import { Ui, type Mode } from './ui/ui';

export class App {
  private readonly ctx: SceneContext;
  private readonly view: CourseView;
  private readonly ui: Ui;
  private readonly history: History<Course>;
  private mode: Mode = 'edit';
  private tool: PartType | null = null;
  private ghostRot = 0;
  private selectedId: number | null = null;
  private hoverCell: Axial | null = null;
  private sim: Simulation | null = null;
  private playing = false;
  private speed = 1;
  private reported = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private downAt: { x: number; y: number } | null = null;
  private lastTime = performance.now();
  private highlightsDirty = true;

  constructor(root: HTMLElement) {
    this.ui = new Ui(root, {
      onMode: (m) => this.setMode(m),
      onTool: (t) => this.setTool(t),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onRotate: (d) => this.rotateSelected(d),
      onRaise: () => this.selectedId !== null && this.apply(raisePiece(this.course, this.selectedId)),
      onLower: () => this.selectedId !== null && this.apply(lowerPiece(this.course, this.selectedId)),
      onDelete: () => this.deleteSelected(),
      onPlayPause: () => this.togglePlay(),
      onReset: () => this.resetRun(),
      onSpeed: (s) => {
        this.speed = s;
        this.refreshUi();
      },
      onSave: () => {
        saveToLocal(this.course);
        this.ui.toast('ブラウザに保存しました');
      },
      onLoad: () => this.loadLocal(true),
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

  private loadLocal(notify: boolean): void {
    try {
      const c = loadFromLocal();
      if (!c) {
        if (notify) this.ui.toast('保存されたコースがありません', 'error');
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

  private rotateSelected(delta: number): void {
    if (this.tool) {
      this.ghostRot = mod6(this.ghostRot + delta);
      this.highlightsDirty = true;
      this.updateGhost();
      return;
    }
    if (this.selectedId !== null) this.apply(rotatePiece(this.course, this.selectedId, delta));
  }

  private deleteSelected(): void {
    if (this.selectedId === null) return;
    if (this.apply(removePiece(this.course, this.selectedId), false)) this.selectedId = null;
    this.onCourseChanged();
  }

  private setTool(tool: PartType | null): void {
    if (this.mode !== 'edit') this.setMode('edit');
    this.tool = tool;
    if (tool) this.selectedId = null;
    this.highlightsDirty = true;
    this.updateGhost();
    this.refreshUi();
  }

  private onCourseChanged(): void {
    if (this.selectedId !== null && !this.selected) this.selectedId = null;
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
      const check = canPlace(this.course, tool, q, r);
      if (!check.ok) return 'blocked';
      return placementConnects(index, tool, q, r, check.level, this.ghostRot) ? 'connects' : 'placeable';
    });
  }

  private updateGhost(): void {
    const cell = this.mode === 'edit' && this.tool ? this.hoverCell : null;
    if (!cell || !this.tool) {
      this.view.setGhost(null, null, 0, 0, false);
      this.view.setHover(this.mode === 'edit' ? this.hoverCell : null, this.hoverCell ? stackTop(this.course, this.hoverCell.q, this.hoverCell.r) : 0);
      return;
    }
    const check = canPlace(this.course, this.tool, cell.q, cell.r);
    const level = check.ok ? check.level : stackTop(this.course, cell.q, cell.r);
    this.view.setGhost(this.tool, cell, level, this.ghostRot, check.ok);
    this.view.setHover(cell, level);
  }

  // ---- 実行 ----

  private setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.downAt = null;
    if (mode === 'run') {
      this.resetRun();
      this.playing = true;
    } else {
      this.sim = null;
      this.playing = false;
      this.view.setBall(null);
      this.view.clearEffects();
      this.ui.hideBanner();
    }
    this.onCourseChanged();
  }

  private resetRun(): void {
    this.sim = new Simulation(this.course);
    this.reported = false;
    this.playing = false;
    this.ui.hideBanner();
    this.view.clearEffects();
    this.view.setBall(this.sim.status === 'failed' ? null : this.sim.position);
    if (this.sim.status === 'failed') this.reportEnd();
    this.refreshUi();
  }

  private togglePlay(): void {
    if (this.mode !== 'run') {
      this.setMode('run');
      return;
    }
    if (!this.sim || this.sim.finished) this.resetRun();
    this.playing = !this.playing;
    this.refreshUi();
  }

  private reportEnd(): void {
    if (!this.sim || this.reported) return;
    this.reported = true;
    if (this.sim.status === 'success') {
      this.ui.showBanner('GOAL!', 'success');
      const p = this.sim.position;
      this.view.burst(new THREE.Vector3(p.x, p.y + 0.2, p.z));
    } else if (this.sim.failReason) {
      this.ui.showBanner(FAIL_MESSAGES[this.sim.failReason], 'failed');
    }
  }

  private runStatus(): { text: string; kind: 'idle' | 'running' | 'success' | 'failed' } {
    const s = this.sim;
    if (!s) return { text: '', kind: 'idle' };
    const t = `${s.time.toFixed(2)} 秒`;
    switch (s.status) {
      case 'ready':
        return { text: '準備完了', kind: 'idle' };
      case 'rolling':
        return { text: `走行中 ${t}・速さ ${s.speed.toFixed(2)}`, kind: 'running' };
      case 'falling':
        return { text: `落下中… ${t}`, kind: 'failed' };
      case 'success':
        return { text: `ゴール！ ${t}`, kind: 'success' };
      case 'failed':
        return { text: `失敗：${FAIL_MESSAGES[s.failReason!]}（${t}）`, kind: 'failed' };
    }
  }

  private refreshUi(): void {
    const st = this.runStatus();
    this.ui.update({
      mode: this.mode,
      tool: this.tool,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      selected: this.selected,
      playing: this.playing,
      speed: this.speed,
      statusText: st.text,
      statusKind: st.kind,
    });
  }

  // ---- 入力 ----

  private pick(ev: PointerEvent): { cell: Axial | null; pieceId: number | null } {
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

  private bindInput(): void {
    const el = this.ctx.renderer.domElement;
    el.addEventListener('pointermove', (ev) => {
      if (this.mode !== 'edit') return;
      const { cell } = this.pick(ev);
      const changed = cell?.q !== this.hoverCell?.q || cell?.r !== this.hoverCell?.r;
      if (changed) {
        this.hoverCell = cell && this.view.cells.some((c) => c.q === cell.q && c.r === cell.r) ? cell : null;
        this.updateGhost();
      }
    });
    el.addEventListener('pointerleave', () => {
      this.hoverCell = null;
      this.updateGhost();
    });
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button === 0) this.downAt = { x: ev.clientX, y: ev.clientY };
    });
    el.addEventListener('pointerup', (ev) => {
      const d = this.downAt;
      this.downAt = null;
      if (ev.button !== 0 || !d || this.mode !== 'edit') return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5) return; // ドラッグはカメラ操作
      const { cell, pieceId } = this.pick(ev);
      if (this.tool) {
        if (cell) this.apply(placePiece(this.course, this.tool, cell.q, cell.r, this.ghostRot), false);
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
      if (ctrl && key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) this.redo();
        else this.undo();
      } else if (ctrl && key.toLowerCase() === 'y') {
        ev.preventDefault();
        this.redo();
      } else if (key === 'Tab') {
        ev.preventDefault();
        this.setMode(this.mode === 'edit' ? 'run' : 'edit');
      } else if (key === ' ') {
        ev.preventDefault();
        this.togglePlay();
      } else if (this.mode === 'run') {
        if (key === 'Backspace' || key.toLowerCase() === 'x') this.resetRun();
        else if (key === 'Escape') this.setMode('edit');
      } else if (key.toLowerCase() === 'r' && !ctrl) {
        this.rotateSelected(ev.shiftKey ? 1 : -1);
      } else if (key === 'Delete' || key === 'Backspace') {
        ev.preventDefault();
        this.deleteSelected();
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
      } else if (/^[1-9]$/.test(key) && !ctrl) {
        const t = PALETTE_ORDER[Number(key) - 1];
        if (t) this.setTool(this.tool === t ? null : t);
      }
    });
  }

  // ---- ループ ----

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.highlightsDirty) this.updateHighlights();

    if (this.mode === 'run' && this.sim) {
      if (this.playing && !this.sim.finished) {
        this.sim.advance(dt * this.speed);
        if (this.sim.finished || this.sim.status === 'success') this.reportEnd();
        if (this.sim.finished) this.playing = false;
        this.refreshUi();
      }
      this.view.setBall(this.sim.status === 'failed' && this.sim.failReason === 'no-start' ? null : this.sim.position);
      this.view.setSplitterStates(this.course, this.sim.toggles);
    } else {
      this.view.setSplitterStates(this.course, new Map());
    }

    this.view.tick(dt);
    this.ctx.controls.update();
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    requestAnimationFrame(this.frame);
  };
}

import { getPart, PALETTE_ORDER, type PartType } from '../core/parts';
import type { Piece } from '../core/course';
import { partIconSvg } from './icons';

export type Mode = 'edit' | 'run';

export interface UiHandlers {
  onMode(mode: Mode): void;
  onTool(tool: PartType | null): void;
  onUndo(): void;
  onRedo(): void;
  onRotate(delta: number): void;
  onRaise(): void;
  onLower(): void;
  onDelete(): void;
  onPlayPause(): void;
  onReset(): void;
  onSpeed(speed: number): void;
  onSave(): void;
  onLoad(): void;
  onExport(): void;
  onImport(file: File): void;
  onNew(): void;
  onSample(): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {}, ...children: (Node | string)[]) => {
  const el = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(el, rest);
  if (dataset) Object.assign(el.dataset, dataset);
  el.append(...children);
  return el;
};

const button = (label: string, title: string, onClick: () => void, cls = '') => {
  const b = h('button', { className: `btn ${cls}`, title, type: 'button' });
  b.innerHTML = label;
  b.addEventListener('click', onClick);
  return b;
};

export const SPEEDS = [0.25, 0.5, 1, 2, 4];

/** 素の DOM で組んだ UI。状態は持たず、App から update で反映する */
export class Ui {
  readonly viewport: HTMLElement;
  private readonly modeBtns: Record<Mode, HTMLButtonElement>;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly palette: HTMLElement;
  private readonly toolBtns = new Map<PartType | 'select', HTMLButtonElement>();
  private readonly inspector: HTMLElement;
  private readonly inspectorBody: HTMLElement;
  private readonly runPanel: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedSel: HTMLSelectElement;
  private readonly status: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly banner: HTMLElement;
  private toastTimer = 0;

  constructor(root: HTMLElement, private readonly handlers: UiHandlers) {
    const H = handlers;
    // ヘッダー
    this.modeBtns = {
      edit: button('✎ 編集', '編集モード (Tab)', () => H.onMode('edit'), 'tab'),
      run: button('▶ 実行', '実行モード (Tab)', () => H.onMode('run'), 'tab'),
    };
    this.undoBtn = button('↶', '元に戻す (Ctrl+Z)', H.onUndo, 'icon');
    this.redoBtn = button('↷', 'やり直す (Ctrl+Y)', H.onRedo, 'icon');
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) H.onImport(f);
      fileInput.value = '';
    });
    const header = h(
      'header',
      { className: 'topbar' },
      h('div', { className: 'logo', innerHTML: '<span class="logo-mark">⬡</span>Hex<b>Marble</b>' }),
      h('div', { className: 'group' }, this.modeBtns.edit, this.modeBtns.run),
      h('div', { className: 'group' }, this.undoBtn, this.redoBtn),
      h(
        'div',
        { className: 'group file' },
        button('保存', 'ブラウザ（localStorage）に保存', H.onSave),
        button('読込', 'ブラウザ（localStorage）から読み込む', H.onLoad),
        button('JSON書き出し', 'JSONファイルとしてエクスポート', H.onExport),
        button('JSON読み込み', 'JSONファイルをインポート', () => fileInput.click()),
        button('新規', '空のコースにする', H.onNew),
        button('サンプル', 'サンプルコースを読み込む', H.onSample),
        fileInput,
      ),
    );

    // パレット
    this.palette = h('aside', { className: 'panel palette' }, h('h2', {}, 'パーツ'));
    const selectBtn = this.toolButton('select', '<span class="glyph">⌖</span>', '選択', 'Esc', '置いたパーツを選択する');
    this.palette.append(selectBtn);
    PALETTE_ORDER.forEach((type, i) => {
      const def = getPart(type);
      this.palette.append(this.toolButton(type, partIconSvg(type, 34), def.name, String(i + 1), def.description));
    });
    this.palette.append(
      h('p', { className: 'hint', innerHTML: '<b>R</b> 回転 ・ <b>Shift+R</b> 逆回転<br><b>緑</b>のセルは既存のコースとつながる場所' }),
    );

    // インスペクタ
    this.inspectorBody = h('div', { className: 'body' });
    this.inspector = h(
      'aside',
      { className: 'panel inspector' },
      h('h2', {}, '選択中のパーツ'),
      this.inspectorBody,
      h(
        'div',
        { className: 'actions' },
        button('⟲', '左に60°回転 (Shift+R)', () => H.onRotate(1)),
        button('⟳', '右に60°回転 (R)', () => H.onRotate(-1)),
        button('▲ 上げる', '支柱を差し込んで1レベル上げる (PageUp / ])', H.onRaise),
        button('▼ 下げる', '真下の支柱を外して1レベル下げる (PageDown / [)', H.onLower),
        button('削除', '削除 (Delete)', H.onDelete, 'danger'),
      ),
    );

    // 実行パネル
    this.playBtn = button('▶ 転がす', '再生 / 一時停止 (Space)', H.onPlayPause, 'primary');
    this.speedSel = h('select', { className: 'speed', title: '再生速度' });
    for (const s of SPEEDS) this.speedSel.append(h('option', { value: String(s), textContent: `×${s}` }));
    this.speedSel.value = '1';
    this.speedSel.addEventListener('change', () => H.onSpeed(Number(this.speedSel.value)));
    this.status = h('div', { className: 'status' });
    this.runPanel = h(
      'div',
      { className: 'panel runbar' },
      this.playBtn,
      button('⟲ リセット', 'リセット (Backspace)', H.onReset),
      h('label', { className: 'speed-label' }, '速度 ', this.speedSel),
      this.status,
    );

    this.viewport = h('div', { className: 'viewport' });
    this.toastEl = h('div', { className: 'toast' });
    this.banner = h('div', { className: 'banner' });
    const help = h('div', {
      className: 'help',
      innerHTML: '左ドラッグ: 回転 ・ 右ドラッグ: パン ・ ホイール: ズーム ・ Tab: 編集/実行 ・ Ctrl+Z / Ctrl+Y: 元に戻す / やり直す',
    });
    root.append(header, h('main', { className: 'stage' }, this.viewport, this.palette, this.inspector, this.runPanel, this.banner, this.toastEl, help));
  }

  private toolButton(tool: PartType | 'select', icon: string, name: string, key: string, desc: string): HTMLButtonElement {
    const b = button(`${icon}<span class="name">${name}</span><kbd>${key}</kbd>`, desc, () =>
      this.handlers.onTool(tool === 'select' ? null : tool),
      'tool',
    );
    this.toolBtns.set(tool, b);
    return b;
  }

  update(state: {
    mode: Mode;
    tool: PartType | null;
    canUndo: boolean;
    canRedo: boolean;
    selected: Piece | null;
    playing: boolean;
    speed: number;
    statusText: string;
    statusKind: 'idle' | 'running' | 'success' | 'failed';
  }): void {
    for (const m of ['edit', 'run'] as const) this.modeBtns[m].classList.toggle('active', state.mode === m);
    this.undoBtn.disabled = !state.canUndo || state.mode !== 'edit';
    this.redoBtn.disabled = !state.canRedo || state.mode !== 'edit';
    this.palette.classList.toggle('hidden', state.mode !== 'edit');
    for (const [t, b] of this.toolBtns) b.classList.toggle('active', (t === 'select' ? null : t) === state.tool);
    const sel = state.mode === 'edit' ? state.selected : null;
    this.inspector.classList.toggle('hidden', !sel);
    if (sel) {
      const def = getPart(sel.type);
      this.inspectorBody.innerHTML = `<div class="sel-name">${partIconSvg(sel.type, 28)}<span>${def.name}</span></div>
        <dl><dt>位置</dt><dd>q=${sel.q}, r=${sel.r}</dd><dt>高さ</dt><dd>レベル ${sel.level}</dd><dt>向き</dt><dd>${sel.rot * 60}°</dd></dl>
        <p class="desc">${def.description}</p>`;
    }
    this.runPanel.classList.toggle('hidden', state.mode !== 'run');
    this.playBtn.innerHTML = state.playing ? '⏸ 一時停止' : '▶ 転がす';
    this.speedSel.value = String(state.speed);
    this.status.textContent = state.statusText;
    this.status.dataset.kind = state.statusKind;
  }

  toast(msg: string, kind: 'info' | 'error' = 'info'): void {
    this.toastEl.textContent = msg;
    this.toastEl.dataset.kind = kind;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  showBanner(text: string, kind: 'success' | 'failed'): void {
    this.banner.textContent = text;
    this.banner.dataset.kind = kind;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // アニメーションを再始動
    this.banner.classList.add('show');
  }

  hideBanner(): void {
    this.banner.classList.remove('show');
  }
}

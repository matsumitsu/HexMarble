/** スナップショット方式の Undo / Redo。状態はイミュータブルに扱うこと */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private current: T, private readonly limit = 200) {}

  get present(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 新しい状態を記録する（Redo 履歴は消える） */
  push(next: T): void {
    if (next === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
  }

  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  /** 履歴を捨てて状態を置き換える */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.current = state;
  }
}

/** 五音音階（ド・レ・ミ・ソ・ラ）の半音数。チャイムのレベル 0, 1, 2… に順に割り当てる */
const PENTATONIC = [0, 2, 4, 7, 9];
const BASE_FREQ = 523.25; // C5

/** レベルからチャイムの周波数を決める（高いところほど高い音） */
export function chimeFrequency(level: number): number {
  const octave = Math.floor(level / PENTATONIC.length);
  const semitone = PENTATONIC[level % PENTATONIC.length] + 12 * octave;
  return BASE_FREQ * Math.pow(2, semitone / 12);
}

/**
 * チャイムの音。外部の音声ファイルは使わず、WebAudio のサイン波を重ねて鐘の音を作る。
 * ブラウザの自動再生制限があるため、最初のクリックやキー入力で unlock() を呼ぶ
 */
export class ChimeSound {
  enabled = true;
  private ctx: AudioContext | null = null;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(level: number): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    const f = chimeFrequency(level);
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.18;
    out.connect(ctx.destination);
    // 鐘らしい倍音（整数倍からずらす）
    for (const [ratio, gain, decay] of [
      [1, 1, 1.6],
      [2.76, 0.35, 0.7],
      [5.4, 0.12, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + decay + 0.05);
    }
  }
}

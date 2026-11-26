let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(v: boolean): void {
  muted = v;
}

export function isMuted(): boolean {
  return muted;
}

function getCtx(): AudioContext | null {
  if (muted) return null;
  if (!ctx && typeof window !== 'undefined') {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, delay = 0): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

export function sfxPlace(): void {
  tone(520, 0.08, 'triangle', 0.08);
  tone(780, 0.06, 'sine', 0.05, 0.03);
}

export function sfxRotate(): void {
  tone(640, 0.05, 'sine', 0.06);
}

export function sfxRemove(): void {
  tone(340, 0.08, 'triangle', 0.07);
}

export function sfxCrystalLit(): void {
  tone(880, 0.14, 'sine', 0.07);
  tone(1320, 0.16, 'triangle', 0.05, 0.04);
}

export function sfxWin(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  notes.forEach((n, i) => tone(n, 0.24, 'triangle', 0.08, i * 0.075));
}

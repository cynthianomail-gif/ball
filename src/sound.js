// 用 WebAudio 即時合成的小音效（不需要音檔）
let ctx = null;

export function unlock() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, dur, { type = 'sine', vol = 0.15, slide = 0, delay = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const beep = (f, d) => tone(f, d, { type: 'square', vol: 0.08 });
export const boing = () => tone(220, 0.25, { type: 'sine', vol: 0.18, slide: 380 });
export const whoosh = () => tone(900, 0.3, { type: 'sawtooth', vol: 0.05, slide: -760 });
export const pop = () => { tone(300, 0.2, { type: 'triangle', vol: 0.15, slide: -220 }); tone(160, 0.3, { type: 'sine', vol: 0.12, slide: -100, delay: 0.05 }); };
export const chime = () => { tone(784, 0.25, { vol: 0.12 }); tone(1175, 0.35, { vol: 0.1, delay: 0.08 }); };
export const fanfare = () => [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.35, { type: 'triangle', vol: 0.12, delay: k * 0.12 }));

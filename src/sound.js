// 用 WebAudio 即時合成的小音效（不需要音檔）
let ctx = null, out = null, noise = null, roller = null;

export function unlock() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 總線上掛一個壓縮器，很多彈珠同時撞也不會爆音
    out = ctx.createDynamicsCompressor();
    out.threshold.value = -18; out.ratio.value = 6;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
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
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

// 一小段濾過的雜訊：撞擊的「喀」
function burst(freq, q, dur, vol) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.8); src.stop(t + dur + 0.02);
}

// 同時太多撞擊聲會糊成一團：每 0.1 秒最多 8 個
let budget = 8, budgetT = 0;
function allow() {
  if (ctx.currentTime - budgetT > 0.1) { budgetT = ctx.currentTime; budget = 8; }
  return budget-- > 0;
}

// 撞擊：strength 0～1（撞多大力），glass＝彈珠互撞（清脆的玻璃聲），否則是撞到木頭/積木
export function hit(strength, glass) {
  if (!ctx || strength < 0.02 || !allow()) return;
  const v = Math.min(1, strength);
  if (glass) {
    const f = 2600 + Math.random() * 1800;
    tone(f, 0.05 + v * 0.06, { vol: 0.05 + v * 0.22 });
    tone(f * 1.52, 0.04 + v * 0.04, { vol: 0.03 + v * 0.1 });
    burst(5200, 1.2, 0.025, 0.05 + v * 0.15);
  } else {
    burst(500 + Math.random() * 500, 2.5, 0.05 + v * 0.05, 0.08 + v * 0.35);
    tone(130 + Math.random() * 60, 0.06 + v * 0.06, { vol: 0.05 + v * 0.25, slide: -40 });
  }
}

// 蹺蹺板倒下去的「喀噠」
export const clack = vol => {
  if (!ctx || !allow()) return;
  burst(900, 3, 0.07, 0.3 * vol);
  tone(240, 0.09, { type: 'triangle', vol: 0.18 * vol, slide: -80 });
};

// 滾動聲：一直開著的低沉雜訊，跟著鏡頭跟隨的彈珠速度變大聲、變亮
export function roll(speed, contact) {
  if (!ctx) return;
  if (!roller) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true;
    f.type = 'lowpass'; f.Q.value = 0.8; g.gain.value = 0;
    src.connect(f).connect(g).connect(out); src.start();
    roller = { f, g };
  }
  const t = ctx.currentTime, s = Math.min(1, speed / 30);
  roller.g.gain.setTargetAtTime(contact ? 0.02 + s * 0.14 : 0, t, 0.06);
  roller.f.frequency.setTargetAtTime(180 + s * 900, t, 0.08);
}

export const beep = (f, d) => tone(f, d, { type: 'square', vol: 0.08 });
export const boing = () => tone(220, 0.25, { type: 'sine', vol: 0.18, slide: 380 });
export const whoosh = () => tone(900, 0.3, { type: 'sawtooth', vol: 0.05, slide: -760 });
export const pop = () => { tone(300, 0.2, { type: 'triangle', vol: 0.15, slide: -220 }); tone(160, 0.3, { type: 'sine', vol: 0.12, slide: -100, delay: 0.05 }); };
export const chime = () => { tone(784, 0.25, { vol: 0.12 }); tone(1175, 0.35, { vol: 0.1, delay: 0.08 }); };
export const fanfare = () => [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.35, { type: 'triangle', vol: 0.12, delay: k * 0.12 }));

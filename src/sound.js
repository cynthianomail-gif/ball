// 用 WebAudio 即時合成的小音效（不需要音檔）
// 撞擊聲做得很短很亮（玻璃「喀」），音量走平方曲線（輕碰很小聲、重撞才突出），再送進一點房間殘響
let ctx = null, sfx = null, verb = null, noise = null, roller = null;

export function unlock() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 總線上掛一個壓縮器，很多彈珠同時撞也不會爆音
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    // 音效總線先濾掉 40Hz 以下的悶響
    sfx = ctx.createBiquadFilter();
    sfx.type = 'highpass'; sfx.frequency.value = 40; sfx.Q.value = 0.7;
    sfx.connect(comp);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 房間殘響：送進去的聲音先濾掉 260Hz 以下（只加空氣感，不會變悶）
    verb = ctx.createBiquadFilter();
    verb.type = 'highpass'; verb.frequency.value = 260;
    const conv = ctx.createConvolver(), wet = ctx.createGain();
    conv.buffer = roomIR(1.3);
    wet.gain.value = 0.28;
    verb.connect(conv).connect(wet).connect(comp);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// 自己生的房間脈衝響應：衰減的雜訊，越後面越暗，開頭加幾個早期反射；右聲道晚 3ms
function roomIR(len) {
  const sr = ctx.sampleRate, n = Math.floor(sr * len), buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, c = 0.25 + 0.7 * Math.min(1, t / len);
      y = c * y + (1 - c) * (Math.random() * 2 - 1);
      d[i] = y * Math.exp(-t / 0.3) * Math.min(1, t / 0.006);
    }
    [[0.011, 0.5], [0.017, 0.35], [0.029, 0.3], [0.041, 0.2]].forEach(([t, a]) => { d[Math.floor((t + ch * 0.003) * sr)] += a; });
  }
  return buf;
}

// 每個聲音的出口：左右聲像 → 乾聲進音效總線，另外送一點進殘響
function voice(pan = 0, send = 0) {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
  p.connect(sfx);
  if (send) { const s = ctx.createGain(); s.gain.value = send; p.connect(s).connect(verb); }
  return p;
}

function tone(freq, dur, { type = 'sine', vol = 0.15, slide = 0, delay = 0, to = sfx } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(to);
  o.start(t); o.stop(t + dur + 0.02);
}

// 一小段濾過的雜訊：撞擊的「喀」、滾動的顆粒
function burst(freq, q, dur, vol, to = sfx, delay = 0) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(to);
  src.start(t, Math.random() * 0.8); src.stop(t + dur + 0.02);
}

// 同一瞬間疊太多撞擊聲會糊成一團：main.js 每幀只挑最響的 3 個來播
// 力道 0～1 → 音量：平方曲線
const loud = v => 0.1 + 0.7 * v * v + 0.1 * v;

// 彈珠互撞：球體的四個非諧波振動模態（1 : 2.405 : 3.87 : 5.41）＋ 6ms 的高頻雜訊瞬態
// 輕碰音高高一點、重撞低一點；撞越大力尾巴越長
export function clack(k, pan = 0) {
  if (!ctx || k < 0.02) return;
  const v = Math.min(1, k), g = loud(v);
  const rate = 0.88 + Math.random() * 0.3 + (1 - v) * 0.2, f0 = 3400 * rate;
  const out = voice(pan, 0.4);
  for (const [ratio, amp, dec] of [[1, 1, 0.075], [2.405, 0.55, 0.05], [3.87, 0.32, 0.034], [5.41, 0.18, 0.022]]) {
    tone(f0 * ratio, dec * (0.6 + 0.8 * v), { vol: 0.2 * g * amp + 0.002, to: out });
  }
  burst(6500, 0.8, 0.006, 0.28 * g, out);
}

// 落地：木頭的悶響＋往下滑的低音（重量感）＋幾個小亮點
export function land(k, pan = 0) {
  if (!ctx || k < 0.02) return;
  const v = Math.min(1, k), g = 0.35 + 0.65 * v, out = voice(pan, 0.4);
  burst(420 + Math.random() * 160, 1.6, 0.07, 0.3 * g, out);
  for (const f of [1400, 2800, 3600]) tone(f * (0.95 + Math.random() * 0.1), 0.02 + Math.random() * 0.02, { vol: 0.03 * g, to: out });
  tone(120, 0.13, { vol: 0.22 * v + 0.02, slide: -65, to: out });
}

// 撞牆：同一種木頭聲，但更高更短（「叩」）
export function knock(k, pan = 0) {
  if (!ctx || k < 0.02) return;
  const v = Math.min(1, k), g = 0.25 + 0.5 * v, out = voice(pan, 0.35), up = 1.25 + Math.random() * 0.35;
  burst(500 * up, 2.2, 0.045, 0.3 * g, out);
  tone(160 * up, 0.05 + v * 0.04, { vol: 0.12 * g, slide: -40, to: out });
}

// 滾動聲（鏡頭跟隨的彈珠）：低沉的底噪＋玻璃珠壓過木頭的細碎顆粒，越快越密越亮；一離地馬上斷
export function roll(speed, contact) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (!roller) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true;
    f.type = 'lowpass'; f.Q.value = 0.8; g.gain.value = 0;
    src.connect(f).connect(g).connect(sfx); src.start();
    roller = { f, g, grains: voice(0, 0.12), t };
  }
  const dt = Math.min(0.1, t - roller.t);
  roller.t = t;
  const level = contact ? Math.pow(Math.min(1, speed / 21), 1.1) : 0;
  roller.g.gain.setTargetAtTime(level * 0.12, t, contact ? 0.05 : 0.025);
  roller.f.frequency.setTargetAtTime(160 + level * 700, t, 0.08);
  if (level < 0.03) return;
  // 顆粒：每秒 20＋速度×4 顆，隨機散在這一幀裡
  let n = (20 + speed * 4) * dt;
  for (; n > 0; n--) {
    if (n < 1 && Math.random() > n) break;
    burst(3000 + Math.random() * 3000, 1.5, 0.002 + Math.random() * 0.004, (0.3 + Math.random() * 0.7) * level * 0.06, roller.grains, Math.random() * dt);
  }
}

export const beep = (f, d) => tone(f, d, { type: 'square', vol: 0.08 });
export const pop = () => { tone(300, 0.2, { type: 'triangle', vol: 0.15, slide: -220 }); tone(160, 0.3, { type: 'sine', vol: 0.12, slide: -100, delay: 0.05 }); };
export const chime = () => { tone(784, 0.25, { vol: 0.12 }); tone(1175, 0.35, { vol: 0.1, delay: 0.08 }); };
export const fanfare = () => [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.35, { type: 'triangle', vol: 0.12, delay: k * 0.12 }));

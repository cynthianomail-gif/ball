// 背景音樂：WebAudio 即時合成的 8 小節循環（C G Am F C G F G），一樣不需要音檔
// 下注時只有貝斯、和弦、輕輕的旋律；比賽開始加進鼓組、旋律放亮
const BPM = 128, STEP = 60 / BPM / 4;    // 16 分音符
const BARS = 8, STEPS = BARS * 16;
const LOOKAHEAD = 0.12;                  // 每次排程往後排多遠（秒）

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

// 每小節的根音（貝斯）和和弦（中音域）
const ROOT = [36, 43, 45, 41, 36, 43, 41, 43];
const CHORD = { 36: [60, 64, 67], 43: [59, 62, 67], 45: [57, 60, 64], 41: [57, 60, 65] };
// 旋律：每小節 [第幾格, 音, 長度(格)]
const MELODY = [
  [[0, 72, 2], [2, 76, 2], [4, 79, 3], [8, 76, 2], [10, 79, 2], [12, 84, 4]],
  [[0, 83, 2], [2, 79, 2], [4, 74, 3], [8, 79, 2], [10, 81, 2], [12, 83, 4]],
  [[0, 84, 3], [4, 81, 2], [6, 76, 2], [8, 72, 3], [12, 76, 2], [14, 81, 2]],
  [[0, 77, 3], [4, 81, 2], [6, 84, 2], [8, 81, 4], [12, 79, 4]],
  [[0, 76, 2], [2, 79, 2], [4, 84, 2], [6, 79, 2], [8, 88, 4], [12, 86, 2], [14, 84, 2]],
  [[0, 83, 3], [4, 79, 2], [6, 74, 2], [8, 79, 3], [12, 83, 2], [14, 86, 2]],
  [[0, 84, 2], [2, 81, 2], [4, 77, 2], [6, 81, 2], [8, 84, 2], [10, 86, 2], [12, 88, 4]],
  [[0, 86, 3], [4, 83, 2], [6, 79, 2], [8, 74, 4], [12, 79, 2], [14, 83, 2]],
];
// 貝斯節奏：[第幾格, 相對根音, 長度(格)]
const BASS = [[0, 0, 2], [3, 0, 1], [4, 12, 1], [6, 0, 2], [8, 0, 2], [11, 0, 1], [12, 12, 1], [14, 7, 2]];

export function createMusic(ctx, dest, noise) {
  const out = ctx.createGain();
  out.connect(dest);
  const layer = v => { const g = ctx.createGain(); g.gain.value = v; g.connect(out); return g; };
  const bassBus = layer(1), chordBus = layer(1), leadBus = layer(0.45), drumBus = layer(0);
  // 旋律先過低通，下注時悶一點、比賽時放亮
  const leadTone = ctx.createBiquadFilter();
  leadTone.type = 'lowpass'; leadTone.frequency.value = 1400; leadTone.Q.value = 0.5;
  leadTone.connect(leadBus);
  const bassTone = ctx.createBiquadFilter();
  bassTone.type = 'lowpass'; bassTone.frequency.value = 700;
  bassTone.connect(bassBus);

  function note(freq, t, dur, type, vol, to, attack = 0.005) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(to);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function hiss(t, dur, vol, type, freq, q = 0.7) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(drumBus);
    src.start(t, Math.random() * 0.8); src.stop(t + dur + 0.02);
  }
  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(drumBus);
    o.start(t); o.stop(t + 0.2);
  }

  function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, root = ROOT[bar];
    for (const [at, off, len] of BASS) if (at === i) {
      note(midi(root + off), t, len * STEP * 0.9, 'triangle', 0.32, bassTone);
      note(midi(root + off), t, len * STEP * 0.6, 'square', 0.05, bassTone);
    }
    // 和弦：反拍的短促「恰」
    if (i % 4 === 2) for (const n of CHORD[root]) note(midi(n), t, 0.14, 'triangle', 0.045, chordBus);
    for (const [at, n, len] of MELODY[bar]) if (at === i) {
      note(midi(n), t, len * STEP * 0.95, 'square', 0.05, leadTone, 0.01);
      note(midi(n), t, len * STEP * 0.95, 'triangle', 0.07, leadTone, 0.01);
    }
    // 鼓（只有比賽時聽得到）：四拍大鼓、二四拍小鼓、8 分音符的鈸
    if (i % 4 === 0) kick(t);
    if (i === 4 || i === 12) { hiss(t, 0.13, 0.28, 'bandpass', 1800); note(190, t, 0.08, 'triangle', 0.12, drumBus); }
    if (i % 2 === 0) hiss(t, i % 4 === 2 ? 0.06 : 0.03, i % 4 === 2 ? 0.1 : 0.06, 'highpass', 8000);
  }

  // 排程器：每 25ms 檢查一次，把接下來 LOOKAHEAD 秒內的音先排進 WebAudio 的時間軸
  let step = 0, next = ctx.currentTime + 0.1;
  setInterval(() => {
    if (ctx.state !== 'running') { next = ctx.currentTime + 0.1; return; }
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05;   // 分頁在背景被暫停過：別一次補一堆音
    while (next < ctx.currentTime + LOOKAHEAD) {
      playStep(step, next);
      step = (step + 1) % STEPS;
      next += STEP;
    }
  }, 25);

  return {
    out,
    setMode(race) {
      const t = ctx.currentTime;
      drumBus.gain.setTargetAtTime(race ? 1 : 0, t, 0.3);
      leadBus.gain.setTargetAtTime(race ? 1 : 0.45, t, 0.3);
      leadTone.frequency.setTargetAtTime(race ? 3200 : 1400, t, 0.3);
    },
  };
}

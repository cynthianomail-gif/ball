// 公平性檢查：跑很多場全 AI 比賽，看「起跑欄位」和「完賽名次」有沒有關係（賠率要是純運氣）
// 用法：node test/fairness.mjs [場數=40] [起始seed=1]
// 輸出：每個起跑欄的平均名次／拿冠軍次數，再加三個相關係數
//   - Spearman(欄位, 名次)：左右偏袒；|r| 要小於門檻
//   - Spearman(離中線多遠, 名次)：中間或邊邊偏袒
//   - Spearman(AI 實力, 名次)：對照組，實力本來就會影響名次（不是起跑位置）
// 判準：樣本數 n 時，|r| < 2 / sqrt(n)（約 95% 信賴）就視為「沒有明顯相關」
import { buildTrack, STEP } from '../src/track.js';
import { Race, initPhysics } from '../src/sim.js';

await initPhysics();
const track = buildTrack();
const games = Number(process.argv[2] || 40), seed0 = Number(process.argv[3] || 1);
const COLS = 10, LAT_GAP = 1.35;

const samples = [];
let unfinished = 0, respawns = 0;
for (let k = 0; k < games; k++) {
  const race = new Race(track, { count: 10, seed: seed0 + k, player: false });
  const col = race.marbles.map(m => Math.round(m.lat / LAT_GAP + (COLS - 1) / 2));
  while (race.time < 240 && race.finishOrder.length < race.count) { race.step(); race.events.length = 0; }
  unfinished += race.count - race.finishOrder.length;
  for (const m of race.marbles) {
    respawns += m.respawns;
    samples.push({ col: col[m.id], rank: m.finished ? m.place : m.rank, skill: m.ai.skill });
  }
}

// Spearman：先換成名次（同分取平均）再算皮爾森
const ranks = a => {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), out = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let t = i; t <= j; t++) out[idx[t][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
};
const pearson = (a, b) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
};
const spearman = (a, b) => pearson(ranks(a), ranks(b));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

const n = samples.length, limit = 2 / Math.sqrt(n);
console.log(`場數 ${games}（seed ${seed0}～${seed0 + games - 1}）  樣本 ${n}  沒跑完 ${unfinished}  重生 ${respawns} 次`);
console.log('欄位  樣本  平均名次  冠軍次數');
for (let c = 0; c < COLS; c++) {
  const s = samples.filter(x => x.col === c), wins = s.filter(x => x.rank === 1).length;
  console.log(`${String(c).padStart(3)}  ${String(s.length).padStart(4)}  ${mean(s.map(x => x.rank)).toFixed(2).padStart(7)}  ${String(wins).padStart(6)}`);
}
const half = (lo, hi) => mean(samples.filter(x => x.col >= lo && x.col <= hi).map(x => x.rank));
console.log(`左半(0-4) 平均名次 ${half(0, 4).toFixed(2)}  右半(5-9) ${half(5, 9).toFixed(2)}  中間4欄(3-6) ${half(3, 6).toFixed(2)}  外側4欄(0,1,8,9) ${mean(samples.filter(x => [0, 1, 8, 9].includes(x.col)).map(x => x.rank)).toFixed(2)}`);
const rCol = spearman(samples.map(x => x.col), samples.map(x => x.rank));
const rEdge = spearman(samples.map(x => Math.abs(x.col - (COLS - 1) / 2)), samples.map(x => x.rank));
const rSkill = spearman(samples.map(x => x.skill), samples.map(x => x.rank));
const verdict = r => Math.abs(r) < limit ? '無明顯相關' : '有相關！';
console.log(`Spearman(欄位, 名次) = ${rCol.toFixed(3)}  ${verdict(rCol)}   門檻 ±${limit.toFixed(3)}`);
console.log(`Spearman(離中線, 名次) = ${rEdge.toFixed(3)}  ${verdict(rEdge)}`);
console.log(`Spearman(AI 實力, 名次) = ${rSkill.toFixed(3)}  （對照組：實力高名次數字小，所以是負的）`);

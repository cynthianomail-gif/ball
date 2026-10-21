// 賠率：用彈珠實力估勝率，再扣掉莊家抽成
// 係數是用 test/calib.mjs 跑 400 場 10 顆彈珠、三個障礙區的全 AI 比賽擬合出來的（玩家長期約拿回 87%）
export const EDGE = 0.12;
const B_SKILL = 8.5;
const FLAT = 0.8;           // 第 2、3 名比第 1 名更看運氣，把勝率拉平一點

const toOdds = p => Math.max(1.1, Math.floor((1 - EDGE) / p * 10) / 10);

export function priceRace(race) {
  const ms = race.marbles;
  const w = ms.map(m => Math.exp(B_SKILL * m.ai.skill));
  const sum = w.reduce((a, b) => a + b, 0);
  const p = w.map(x => x / sum);
  const n = p.length;

  // 前三名機率（Harville 公式，第 2、3 名用拉平的勝率 q）
  const qw = p.map(x => x ** FLAT);
  const qs = qw.reduce((a, b) => a + b, 0);
  const q = qw.map(x => x / qs);
  const top3 = p.slice();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i === j) continue;
    top3[i] += p[j] * q[i] / (1 - q[j]);
    for (let k = 0; k < n; k++) {
      if (k === i || k === j) continue;
      top3[i] += p[j] * q[k] / (1 - q[j]) * q[i] / (1 - q[j] - q[k]);
    }
  }

  const skills = ms.map(m => m.ai.skill).sort((a, b) => a - b);
  ms.forEach((m, k) => {
    m.winP = p[k];
    m.odds = { win: toOdds(p[k]), top3: toOdds(Math.min(top3[k], 0.999)) };
    // 實力星等：依這場裡的排序分成五級
    m.stars = 1 + Math.min(4, Math.floor(skills.indexOf(m.ai.skill) / n * 5));
  });
}

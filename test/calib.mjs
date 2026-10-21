// 校準賠率：跑很多場全 AI 比賽，記錄每顆彈珠的實力和名次
// 用法：node test/calib.mjs <起始seed> <場數> <彈珠數>  → 每行輸出一顆彈珠的 JSON
import { buildTrack, STEP } from '../src/track.js';
import { Race, initPhysics } from '../src/sim.js';

await initPhysics();
const track = buildTrack();
const [seed0, n, count] = process.argv.slice(2).map(Number);
for (let k = 0; k < n; k++) {
  const race = new Race(track, { count, seed: seed0 + k, player: false });
  const row = race.marbles.map(m => Math.round((track.gateI * STEP - 2.5 - m.s) / 1.6));
  while (race.time < 240) {
    race.step(); race.events.length = 0;
    if (race.finishOrder.length >= 3) break;   // 下注只看前三名
  }
  for (const m of race.marbles) console.log(JSON.stringify({ seed: seed0 + k, count, skill: m.ai.skill, row: row[m.id], rank: m.rank }));
}

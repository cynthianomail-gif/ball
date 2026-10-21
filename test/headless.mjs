// 無頭模擬：10 顆 AI 彈珠跑一場，檢查賽道和障礙區能不能順利跑完
// 用法：node test/headless.mjs [seed]
import { buildTrack, STEP } from '../src/track.js';
import { Race, initPhysics } from '../src/sim.js';

await initPhysics();
const track = buildTrack();
const seed = Number(process.argv[2] || 1);
const race = new Race(track, { count: 10, seed, player: false });
// 每顆彈珠通過每個障礙區花幾秒
const zoneT = track.zones.map(() => []);
const enter = new Map();
const respawnAt = {};
const rescueStart = new Map(), rescueT = [];   // 救援開始到放下的秒數
const t0 = performance.now();
let steps = 0, lastLog = 0;
while (steps < 60 * 240) {
  race.step(); steps++;
  for (const e of race.events) {
    if (e.type === 'elim') console.log(`t=${race.time.toFixed(1)} cp${e.k + 1} closed, eliminated ${e.list.length}, alive ${race.aliveCount()}`);
    if (e.type === 'finish' && e.place <= 3) console.log(`t=${race.time.toFixed(1)} finish #${e.place} ${e.m.name} respawns=${e.m.respawns}`);
    if (e.type === 'rescue') rescueStart.set(e.m.id, race.time);
    if (e.type === 'respawn') {
      const b = Math.round(e.m.safeIdx * STEP / 10) * 10; respawnAt[b] = (respawnAt[b] || 0) + 1;
      rescueT.push(race.time - rescueStart.get(e.m.id));
    }
  }
  race.events.length = 0;
  for (const m of race.marbles) track.zones.forEach((z, k) => {
    const key = m.id * 10 + k;
    if (!enter.has(key) && m.maxS >= z.s0) enter.set(key, race.time);
    if (enter.has(key) && enter.get(key) >= 0 && m.maxS >= z.s1) { zoneT[k].push(race.time - enter.get(key)); enter.set(key, -1); }
  });
  if (race.time - lastLog > 15) {
    lastLog = race.time;
    const lead = race.ranking[0], last = race.ranking.filter(m => m.alive).at(-1);
    const v = lead.body.linvel();
    console.log(`  t=${race.time.toFixed(0)} lead s=${lead.maxS.toFixed(0)} spd=${Math.hypot(v.x, v.z).toFixed(1)} last s=${last.maxS.toFixed(0)}`);
  }
  if (race.finishOrder.length >= race.count) break;
}
const ms = (performance.now() - t0) / steps;
console.log(`done t=${race.time.toFixed(1)}s finished=${race.finishOrder.length} ${ms.toFixed(2)} ms/step`);
track.zones.forEach((z, k) => { const a = zoneT[k]; console.log(`zone ${z.type}: ${a.length} passed, avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}s, max ${Math.max(...a).toFixed(1)}s, length ${(z.s1 - z.s0)}`); });
console.log('respawns by track position (s):', JSON.stringify(respawnAt));
if (rescueT.length) console.log(`rescue start->release: n=${rescueT.length} min ${Math.min(...rescueT).toFixed(2)}s max ${Math.max(...rescueT).toFixed(2)}s`);

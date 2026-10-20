// 無頭模擬：全部彈珠由 AI 控制，檢查賽道能不能跑完
// 用法：node test/headless.mjs [seed]
import { buildTrack, STEP } from '../src/track.js';
import { Race, initPhysics } from '../src/sim.js';

await initPhysics();
const track = buildTrack();
const seed = Number(process.argv[2] || 1);
const race = new Race(track, { count: 50, seed, autopilot: true, difficulty: Number(process.argv[3] ?? 1) });
const respawnAt = {};
const t0 = performance.now();
let steps = 0, lastLog = 0;
while (steps < 60 * 240) {
  race.step(); steps++;
  for (const e of race.events) {
    if (e.type === 'elim') console.log(`t=${race.time.toFixed(1)} cp${e.k + 1} closed, eliminated ${e.list.length}, alive ${race.aliveCount()}`);
    if (e.type === 'finish' && e.place <= 3) console.log(`t=${race.time.toFixed(1)} finish #${e.place} ${e.m.name} respawns=${e.m.respawns}`);
    if (e.type === 'respawn') { const b = Math.round(e.m.safeIdx * STEP / 10) * 10; respawnAt[b] = (respawnAt[b] || 0) + 1; }
  }
  race.events.length = 0;
  if (race.time - lastLog > 15) {
    lastLog = race.time;
    const lead = race.ranking[0], last = race.ranking.filter(m => m.alive).at(-1);
    const v = lead.body.linvel();
    console.log(`  t=${race.time.toFixed(0)} lead s=${lead.maxS.toFixed(0)} spd=${Math.hypot(v.x, v.z).toFixed(1)} last s=${last.maxS.toFixed(0)}`);
  }
  if (race.finishOrder.length >= race.cps.at(-1).keep) break;
}
const ms = (performance.now() - t0) / steps;
console.log(`done t=${race.time.toFixed(1)}s finished=${race.finishOrder.length} ${ms.toFixed(2)} ms/step`);
const p = race.player; console.log(`player(autopilot): alive=${p.alive} finished=${p.finished} place=${p.place} rank=${p.rank} respawns=${p.respawns}`);
console.log('respawns by track position (s):', JSON.stringify(respawnAt));

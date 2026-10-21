// 出界救援測試：把彈珠丟出賽道，檢查手的時間軸、救援期間不碰撞／不出聲、放下後恢復物理並跑完；再測落點被擋會錯開
// 用法：node test/rescue.mjs
import { buildTrack, trackPoint } from '../src/track.js';
import { Race, RESCUE, RADIUS, DT, initPhysics } from '../src/sim.js';

await initPhysics();
const track = buildTrack();
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

// 讓比賽跑到彈珠 m 在一般賽道上（不在漏斗裡）
function runUntil(race, m, minS) {
  while (race.time < 60 && !(race.phase === 'race' && m.s > minS && !m.funnel && m.grounded)) { race.step(); race.events.length = 0; }
}
function throwOut(race, m) {
  const p = trackPoint(track, m.idx, track.half[m.idx] + 6, 2);
  m.body.setTranslation(p, true);
}

// ---------- 場景 1：基本時間軸 ----------
{
  const race = new Race(track, { count: 10, seed: 3, player: false });
  const m = race.marbles[0];
  runUntil(race, m, 40);
  const idx0 = m.idx;
  throwOut(race, m);
  let maxS0 = 0;

  let tStart = null, tRelease = null, tEnd = null, y0 = null, yLow = Infinity;
  let offStart = null, phases = [], badHit = 0, enabledWhileHeld = false, movedWhileHeld = false;
  let atRel = null, handDown = false;
  for (let k = 0; k < 60 * 6; k++) {
    race.step();
    for (const e of race.events) {
      if (e.type === 'rescue' && e.m === m) { tStart = race.time; maxS0 = m.maxS; }
      if (e.type === 'respawn' && e.m === m) { tRelease = race.time; atRel = { idx: m.idx, lat: m.lat, h: m.h, maxS: m.maxS, v: { ...m.body.linvel() } }; }
      if (e.type === 'hit' && (e.m === m || e.o === m) && m.rescue?.held) badHit++;
    }
    race.events.length = 0;
    if (tStart !== null && offStart === null) offStart = race.time;
    if (m.rescue?.held) {
      if (m.body.isEnabled()) enabledWhileHeld = true;
      const r = m.rescue;
      if (y0 === null) y0 = r.y;
      yLow = Math.min(yLow, r.y);
      if (r.y < y0 - 1) handDown = true;
      if (phases.at(-1) !== 'held') phases.push('held');
    } else if (m.rescue && phases.at(-1) !== 'rising') phases.push('rising');
    if (tRelease !== null && !m.rescue && tEnd === null) { tEnd = race.time; break; }
  }
  check(tStart !== null, `出界後進入救援（rescue 事件 t=${tStart?.toFixed(2)}）`);
  check(!enabledWhileHeld, '救援中彈珠物理停用（body.isEnabled()=false）');
  check(badHit === 0, '救援中沒有任何 hit（撞擊聲）事件涉及這顆彈珠');
  check(handDown, `手從高處降下（起 y=${y0?.toFixed(2)}，最低 y=${yLow.toFixed(2)}）`);
  const dtRel = tRelease - tStart, dtEnd = tEnd - tStart;
  check(Math.abs(dtRel - (RESCUE.wait + RESCUE.down + RESCUE.hold)) < 2 * DT, `開始到放手 ${dtRel.toFixed(2)}s（預期 ${(RESCUE.wait + RESCUE.down + RESCUE.hold).toFixed(2)}s）`);
  check(Math.abs(dtEnd - (dtRel + RESCUE.up)) < 2 * DT, `開始到手收完 ${dtEnd.toFixed(2)}s（預期 ${(dtRel + RESCUE.up).toFixed(2)}s）`);
  check(phases.join('>') === 'held>rising', `階段順序 ${phases.join('>')}`);
  check(m.body.isEnabled(), '放手後物理恢復');
  const hw = track.half[atRel.idx];
  check(Math.abs(atRel.lat) < hw && atRel.h > 0 && atRel.h < 1.5, `放手時在跑道上（lat=${atRel.lat.toFixed(2)} / 半寬 ${hw.toFixed(2)}，h=${atRel.h.toFixed(2)}）`);
  check(atRel.idx <= idx0 && m.respawns === 1, `放回出界點之前的位置（idx ${idx0} -> ${atRel.idx}），respawns=${m.respawns}`);
  check(Math.abs(atRel.maxS - maxS0) < 1, `救援期間名次基準 maxS 沒亂跳（${maxS0.toFixed(1)} -> ${atRel.maxS.toFixed(1)}）`);
  check(Math.hypot(atRel.v.x, atRel.v.z) > 3, `放手後有沿賽道的速度（${Math.hypot(atRel.v.x, atRel.v.z).toFixed(1)} m/s）`);
  while (race.time < 240 && race.finishOrder.length < race.count) { race.step(); race.events.length = 0; }
  check(race.finishOrder.length === race.count && m.finished, `全員完賽（${race.finishOrder.length}/${race.count}），被救的彈珠名次 ${m.place}`);
}

// ---------- 場景 2：落點被別顆彈珠擋住 ----------
{
  const race = new Race(track, { count: 10, seed: 3, player: false });
  const m = race.marbles[0], b = race.marbles[1];
  runUntil(race, m, 40);
  throwOut(race, m);
  let r = null, shifted = false, lat0 = null, dRel = Infinity, spot = null;
  for (let k = 0; k < 60 * 4 && !(r && !r.held); k++) {
    // 擋路的彈珠固定在目前的落點上
    if (m.rescue?.held) {
      r = m.rescue;
      if (lat0 === null) { lat0 = r.lat; spot = { x: r.bx, y: r.by, z: r.bz }; }
      b.body.setTranslation(spot, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (Math.abs(r.lat - lat0) > 0.5) shifted = true;
    }
    race.step(); race.events.length = 0;
    if (r && !r.held && dRel === Infinity) { const p = b.body.translation(); dRel = Math.hypot(p.x - r.bx, p.y - r.by, p.z - r.bz); }
  }
  check(shifted, `落點被擋時橫向錯開（lat ${lat0?.toFixed(2)} -> ${r?.lat.toFixed(2)}）`);
  check(dRel >= 2 * RADIUS, `放手時離擋路的彈珠 ${dRel.toFixed(2)} >= 直徑 ${2 * RADIUS}`);
  check(r && !r.held && m.body.isEnabled(), '錯開後照樣放下');
}

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);

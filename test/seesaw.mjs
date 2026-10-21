// V 字槽（蹺蹺板關）量測：10 顆 AI 彈珠跑一場，記錄每顆在 V 裡的表現
// 用法：node test/seesaw.mjs [seed] [-v]
//   -v：另外印出每顆彈珠每次折返時離中線多遠（看擺幅怎麼衰減）、和卡住的位置
//
// 定義（座標用 V 自己的：x＝右手邊、離中線多遠；y＝高度）
// - 進 V：彈珠中心越過前面玻璃那個面（dz > -TOWER.slot），而且在 V 的左右範圍內
// - 穿越中線：彈珠中心從中線一邊（x > 0.5）滾到另一邊（x < -0.5），或反過來，算一次。
//   中間留 ±0.5 的緩衝，在中線附近晃來晃去不會重複算；最後滑進洞裡的那一趟沒有滾到對面，不算
// - 折返：在 V 裡 x 方向速度變號（擺到最高點往回滾），只在 -v 時印出擺幅
// - 掉洞：中心低於 w.yV - 0.9（從 V 底中間的洞口掉下去）
// - 接上出口：掉洞之後 maxS 超過出口賽道起點再往後 4 單位
import { buildTrack, STEP } from '../src/track.js';
import { Race, initPhysics, TOWER } from '../src/sim.js';

await initPhysics();
const track = buildTrack();
const seed = Number(process.argv.find((a, k) => k > 1 && /^\d+$/.test(a)) || 1);
const verbose = process.argv.includes('-v');
const race = new Race(track, { count: 10, seed, player: false });
const w = track.towers[0];
const zone = track.zones.find(z => z.type === 'seesaw');
const exitS = (w.exitI * STEP) + 4;

const rec = race.marbles.map(m => ({ m, enter: null, leave: null, cross: 0, lastSide: 0, peaks: [], lastVx: 0, fell: false, linked: false, still: 0, stuckAt: [], respawns: 0 }));
const local = p => {
  const ox = p.x - w.c[0], oz = p.z - w.c[1];
  return { x: ox * w.r[0] + oz * w.r[1], z: ox * w.f[0] + oz * w.f[1], y: p.y };
};
let respawnNear = 0;
while (race.time < 240) {
  race.step();
  for (const e of race.events) if (e.type === 'respawn') {
    const r = rec[e.m.id];
    // 重生前最後的進度在蹺蹺板附近（入口前 25 到出口後 15）
    if (e.m.maxS > zone.s0 - 25 && e.m.maxS < exitS + 15) { respawnNear++; r.respawns++; }
  }
  race.events.length = 0;
  for (const r of rec) {
    const { m } = r;
    if (!m.alive || r.linked) continue;
    const p = local(m.body.translation()), v = m.body.linvel();
    const vx = v.x * w.r[0] + v.z * w.r[1];
    const inV = p.z > -TOWER.slot && Math.abs(p.x) < w.span + 0.5 && p.y < w.yTop + 3 && p.y > w.yV - 0.9;
    const side = p.x > 0.5 ? 1 : p.x < -0.5 ? -1 : 0;
    if (r.enter === null && inV) { r.enter = race.time; r.lastSide = side; }
    if (r.enter !== null && !r.fell) {
      if (p.y <= w.yV - 0.9 && Math.abs(p.x) < w.span) { r.fell = true; r.leave = race.time; }
      else {
        if (side && r.lastSide && side !== r.lastSide) r.cross++;
        if (side) r.lastSide = side;
        if (r.lastVx && Math.sign(vx) !== Math.sign(r.lastVx) && Math.abs(vx) > 1e-3) r.peaks.push(+p.x.toFixed(1));
        if (Math.abs(vx) > 1e-3) r.lastVx = vx;
        // 卡住：在 V 裡幾乎不動
        if (Math.hypot(v.x, v.y, v.z) < 0.3) {
          const before = r.still;
          r.still += 1 / 60;
          if (before < 0.5 && r.still >= 0.5) r.stuckAt.push(`t=${race.time.toFixed(1)} x=${p.x.toFixed(2)} y-yV=${(p.y - w.yV).toFixed(2)} z=${p.z.toFixed(2)}`);
        } else r.still = 0;
      }
    }
    if (r.fell && m.maxS >= exitS) r.linked = true;
  }
  if (rec.every(r => r.linked || !r.m.alive)) break;
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`seed=${seed}  V: span=${w.span} slope=${w.slope.toFixed(2)} 進場 x=${w.entryX.toFixed(1)}  模擬到 t=${race.time.toFixed(1)}s`);
console.log(pad('彈珠', 8) + pad('進V(s)', 9) + pad('穿越', 6) + pad('V裡(s)', 9) + pad('掉洞', 6) + pad('接出口', 8) + '重生');
for (const r of rec) {
  const dur = r.enter === null ? '-' : ((r.leave ?? race.time) - r.enter).toFixed(1);
  console.log(pad(r.m.name, 8) + pad(r.enter === null ? '-' : r.enter.toFixed(1), 9) + pad(r.cross, 6) + pad(dur, 9) + pad(r.fell ? '是' : '否', 6) + pad(r.linked ? '是' : '否', 8) + r.respawns
    + (verbose ? `  擺幅 ${r.peaks.join(' ')}` + (r.stuckAt.length ? `  卡住 ${r.stuckAt.join(' | ')}` : '') : ''));
}
const cs = rec.filter(r => r.enter !== null).map(r => r.cross);
const durs = rec.filter(r => r.enter !== null).map(r => (r.leave ?? race.time) - r.enter);
const inRange = cs.filter(c => c >= 2 && c <= 4).length;
const hist = {}; for (const c of cs) hist[c] = (hist[c] || 0) + 1;
console.log(`總結：穿越次數 最小 ${Math.min(...cs)} 最大 ${Math.max(...cs)} 平均 ${(cs.reduce((a, b) => a + b, 0) / cs.length).toFixed(1)}  分布 ${JSON.stringify(hist)}  落在 2～4：${inRange}/${cs.length}`);
console.log(`      V 裡時間 最大 ${Math.max(...durs).toFixed(1)}s  卡住 >10s：${durs.filter(d => d > 10).length} 顆  掉洞 ${rec.filter(r => r.fell).length}/10  接上出口 ${rec.filter(r => r.linked).length}/10  蹺蹺板附近重生 ${respawnNear} 次`);
console.log(`CSV ${seed},${cs.join(' ')},${inRange},${cs.length},${Math.max(...durs).toFixed(1)},${rec.filter(r => r.linked).length},${respawnNear}`);

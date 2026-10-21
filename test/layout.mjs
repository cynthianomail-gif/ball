// 賽道幾何檢查：長度、高度範圍、有沒有和自己交叉、漏斗下方的賽道有沒有撞到
// 用法：node test/layout.mjs
import { buildTrack, STEP, funnelDepth } from '../src/track.js';
const t = buildTrack();
let lo = 1e9, hi = -1e9;
for (const p of t.P) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
console.log(`長度 ${t.total.toFixed(0)}  高度 ${lo.toFixed(1)} ~ ${hi.toFixed(1)}  障礙區 ${t.zones.map(z => `${z.type}@${z.s0.toFixed(0)}`).join(' ')}`);
// 自我交叉：水平太近、高度差又不夠
let bad = null;
for (let i = 0; i < t.N; i += 2) for (let j = i + 80; j < t.N; j += 2) {
  const a = t.P[i], b = t.P[j];
  // 夾彎相鄰的兩條溝本來就靠很近（高度差也小），不算
  if (t.zones.some(z => z.type === 'zigzag' && i * STEP > z.s0 - 25 && j * STEP < z.s1 + 25)) continue;
  if (Math.hypot(a.x - b.x, a.z - b.z) < t.half[i] + t.half[j] + 2.5 && Math.abs(a.y - b.y) < 7 && (!bad || Math.abs(a.y - b.y) < bad.dy)) bad = { s1: i * STEP, s2: j * STEP, dy: Math.abs(a.y - b.y) };
}
console.log('自我交叉：', bad ? `s=${bad.s1} 和 s=${bad.s2} 只差 ${bad.dy.toFixed(1)}` : '沒有');
// 漏斗：其他賽道從下面或上面經過時要留夠空間
for (const f of t.funnels) {
  let worst = Infinity, at = null;
  for (let i = 0; i < t.N; i++) {
    if (i >= f.i0 - 60 && i <= f.i1 + Math.round((f.R + 6) / STEP)) continue;   // 自己洞口下方的出口本來就在下面
    const p = t.P[i], r = Math.hypot(p.x - f.c[0], p.z - f.c[1]);
    if (r > f.R + t.half[i] + 1) continue;
    const coneY = f.yRim - f.depth * funnelDepth(Math.max(1.2, Math.min(f.R, r)), f.R);
    const gap = p.y < coneY ? coneY - p.y - 4.2 : p.y - f.yRim - 4;
    if (gap < worst) { worst = gap; at = i * STEP; }
  }
  console.log(`漏斗 s=${f.i0 * STEP}：附近其他賽道最小間隔 ${worst === Infinity ? '（沒有）' : worst.toFixed(1) + ' at s=' + at}`);
}

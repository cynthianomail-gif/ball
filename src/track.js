// 賽道產生器：用「烏龜指令」畫出中心線，再沿線長出 U 型木製軌道
import * as THREE from 'three';

export const STEP = 0.5;          // 取樣間距
export const WALL_H = 3.0;        // 牆高（以軌道底為 0）
export const EDGE_RISE = 0.9;     // 地板兩側上翹高度
export const PISTON_RISE = 0.1;   // 跳跳積木那段地板兩側只翹一點點
export const WALL_T = 0.7;        // 牆厚
export const BEAM = 1.0;          // 軌道底下厚度
const FLOOR_SEGS = 16;

// 指令：S 直線(長度, 坡度)  T 轉彎(角度, 半徑, 坡度，正=左轉)
//       Z 障礙區(種類, 長度, 坡度)：直線上放一整區障礙
//       F 漏斗(半徑, 深度, 洞口下方落差)：從邊緣切進去，繞圈掉進中間的洞，落到下面的賽道
//       H 連發夾彎(彎數, 每段長, 彎道半徑, 坡度)：窄窄的木頭溝槽來回 180 度急轉
// 坡度為每單位長度下降量
// 小漏斗：入口是一條剛好一顆寬的窄槽，牆矮，入口前 5 單位收窄
const MINI = { lane: 0.8, margin: 0.5, wall: 1.3, taper: 5, group: 'minifunnel' };

const PROGRAM = [
  ['S', 38, 0.015],     // 起跑區（閘門在 30）
  ['S', 14, 0.1],       // 衝下坡、慢慢變窄
  ['F', 14, 5, 5],            // 障礙區 1：漏斗，把擠成一團的彈珠拉成一條線
  ['S', 20, 0.05],      // 離開漏斗底下，夾彎才不會被漏斗擋住
  ['H', 10, 7, 1.6, 0.2],     // 障礙區 2：十連發夾彎（比較陡，才滾得夠快）
  ['S', 8, 0.06],
  ['F', 3.6, 2.4, 2.4, MINI], // 障礙區 3：連續小漏斗（三個一組）
  ['S', 11, 0.12],            // 漏斗之間的小滑槽：拉開距離，從上面看下一個漏斗才不會被上一個擋住
  ['F', 3.6, 2.4, 2.4, MINI],
  ['S', 11, 0.12],
  ['F', 3.6, 2.4, 2.4, MINI],
  ['Z', 'fork', 38, 0.12],    // 障礙區 4：分岔匯流（中間一座水滴形的島，左右兩道再收進頸部）
  ['T', 90, 16, 0.07],
  ['Z', 'cross', 50, 0.08],   // 障礙區 5：旋轉十字
  ['T', -180, 16, 0.08],      // 急彎直接接下一關
  ['Z', 'piston', 44, 0.06],  // 障礙區 6：跳跳積木
  ['Z', 'pegs', 46, 0.2],     // 障礙區 7：彈珠台（比較陡），跳跳積木出來直接接上
  ['Z', 'water', 24, 0.12],   // 障礙區 8：水底隧道（水箱罩住賽道，彈珠變慢，拉近終點前的差距）
  ['S', 40, 0.0],       // 終點（最後 30 是收集區）
];

export const ZONE_INFO = {
  cross: { name: '旋轉十字', icon: '✚' },
  piston: { name: '跳跳積木', icon: '🧱' },
  pegs: { name: '彈珠台', icon: '📍' },
  funnel: { name: '漏斗', icon: '🌀' },
  zigzag: { name: '十連發夾彎', icon: '🔁' },
  minifunnel: { name: '連續小漏斗', icon: '🥣' },
  fork: { name: '分岔匯流', icon: '🔀' },
  water: { name: '水底隧道', icon: '🌊' },
};
export const FUNNEL_HOLE = 1.1;        // 洞口半徑：比兩顆並排（直徑 2）再大一點，才不會兩顆互卡堵住
export const ZIGZAG_LANE = 0.7;        // 夾彎溝槽的半寬：剛好放得下一顆彈珠（直徑 1），只能排成一列
const ZIGZAG_BANK = 0.5;              // 夾彎彎道的傾斜角（弧度）
const ZIGZAG_WALL = 1.1;              // 夾彎溝槽的牆高（從溝底算，彈珠直徑 1）
const ZIGZAG_TALL = 22;               // 夾彎開頭這麼長的一段牆還是高的
// 分岔匯流：賽道中間一座靜態的水滴形島（鼻 → 身 → 尾），把賽道分成左右對稱兩道，尾巴之後收進頸部再放寬
// lead 區頭到鼻尖多遠、nose／body／tail 島三段的長度、hw 島的半寬、hh 島高、tip 鼻尖和尾尖的半寬（不做成刀鋒）
// outer 島兩側的賽道半寬（每道淨寬 outer - hw）、neck 頸部半寬（全寬 3.2 ≥ 三顆並排）、neckLen 頸部長度、ease 收窄與放寬各用多長
export const FORK = { lead: 10, nose: 6, body: 12, tail: 6, hw: 1.0, hh: 2.0, tip: 0.15, outer: 3.4, neck: 1.6, neckLen: 3, ease: 6 };
// 島在離鼻尖 s 處的半寬：鼻是橢圓（圓圓的頭）、身一樣寬、尾巴直線收尖
export function forkHalf(s) {
  const F = FORK;
  if (s <= F.nose) return F.tip + (F.hw - F.tip) * Math.sqrt(1 - (1 - s / F.nose) ** 2);
  if (s <= F.nose + F.body) return F.hw;
  return THREE.MathUtils.lerp(F.hw, F.tip, Math.min(1, (s - F.nose - F.body) / F.tail));
}
export const FUNNEL_LANE = 3.5;        // 進漏斗前賽道縮到這個半寬

// 漏斗剖面：r 從洞口到邊緣，回傳往下的深度（0～1）。一半直線一半雙曲線，越靠中間越陡
export function funnelDepth(r, R) {
  const a = (R - r) / (R - FUNNEL_HOLE);
  const b = (R / r - 1) / (R / FUNNEL_HOLE - 1);
  return 0.4 * a + 0.6 * b;
}

const PEGS_WALL = 6.5;             // 彈珠台的牆高（一般是 WALL_H）
export const PISTON_COLS = 4;      // 跳跳積木一列幾塊
export const PISTON_ROW = 2.9;     // 跳跳積木每列間隔（積木前後長 2.8）

const START = new THREE.Vector3(-105, 100.1, 95);
const START_HEADING = 0; // 朝 +x

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(arr, radius, passes = 1) {
  let a = arr.slice();
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let sum = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = Math.min(a.length - 1, Math.max(0, i + k));
        sum += a[j]; n++;
      }
      out[i] = sum / n;
    }
    a = Array.from(out);
  }
  return a;
}

// 截面輪廓（局部座標 x=橫向, y=上），左牆外頂 → 地板 → 右牆外頂
export function colliderProfile(hw, wh = WALL_H, rise = EDGE_RISE) {
  const pts = [[-hw - WALL_T, wh], [-hw, wh]];
  for (let k = 0; k <= FLOOR_SEGS; k++) {
    const x = -hw + (2 * hw * k) / FLOOR_SEGS;
    pts.push([x, rise * Math.pow(Math.abs(x / hw), 3)]);
  }
  pts.push([hw, wh], [hw + WALL_T, wh]);
  return pts;
}

export function floorHeightAt(lat, hw, rise = EDGE_RISE) {
  const x = Math.min(1, Math.abs(lat / hw));
  return rise * Math.pow(x, 3);
}

export function buildTrack(seed = 7) {
  const rand = mulberry32(seed);

  // 1. 烏龜走出 2D 路徑 + 高度
  const xs = [], zs = [], ys = [], curv = [], noFloor = [];
  let x = START.x, z = START.z, y = START.y, h = START_HEADING;
  const push = (k, hole = 0) => { xs.push(x); zs.push(z); ys.push(y); curv.push(k); noFloor.push(hole); };
  push(0);
  const zoneRanges = [];
  const funnels = [];
  const breaks = new Set();   // i 和 i+1 之間不相連（漏斗洞口的垂直落差）
  for (const cmd of PROGRAM) {
    if (cmd[0] === 'F') {
      // 漏斗中心在賽道左手邊；賽道末端架在漏斗邊牆上方，彈珠順著切線方向掉進去
      // opt：lane 入口半寬、margin 入口離邊牆多遠、wall 邊牆高、taper 入口前收窄長度、group 連續的小漏斗算同一關
      const [, Rf, depth, drop, opt = {}] = cmd;
      const lane = opt.lane ?? FUNNEL_LANE, margin = opt.margin ?? 1.2, wall = opt.wall ?? WALL_H;
      const i0 = xs.length - 1;
      const yRim = y - (wall + BEAM + 0.6);
      const lx = -Math.sin(h), lz = -Math.cos(h);
      const off = Rf - lane - margin;
      const cx = x + lx * off, cz = z + lz * off;
      // 漏斗裡沒有賽道，用一條從入口到洞口的線當「進度」參考
      const x0 = x, z0 = z, y0 = y, n = Math.round(off / STEP);
      for (let i = 1; i <= n; i++) {
        x = x0 + (cx - x0) * i / n; z = z0 + (cz - z0) * i / n; y = y0 + (yRim - depth - y0) * i / n; push(0, 2);
      }
      const i1 = xs.length - 1;
      breaks.add(i1);
      // 出口賽道從洞口正下方、往後 2 單位開始，彈珠掉下來才接得住
      x = cx - Math.cos(h) * 2; z = cz + Math.sin(h) * 2; y = yRim - depth - drop;
      push(0);
      funnels.push({ i0, i1, exitI: i1 + 1, c: [cx, cz], R: Rf, depth, yRim, yHole: yRim - depth, lane, wallH: wall, taper: opt.taper ?? 14 });
      zoneRanges.push({ type: opt.group || 'funnel', i0, i1 });
    } else if (cmd[0] === 'H') {
      // 一段直、一個 180 度急彎，左彎右彎輪流，整串往左手邊前進
      const [, count, L, r, slope] = cmd;
      const i0 = xs.length - 1;
      const dir = [-Math.sin(h), -Math.cos(h)];               // 前進方向（起點的左手邊）
      const axis = [x + Math.cos(h) * L / 2, z - Math.sin(h) * L / 2];   // 每段中點連成的中線
      const straight = () => { for (let i = 0, n = Math.round(L / STEP); i < n; i++) { x += Math.cos(h) * STEP; z -= Math.sin(h) * STEP; y -= slope * STEP; push(0); } };
      for (let k = 0; k < count; k++) {
        straight();
        const sgn = k % 2 ? -1 : 1, n = Math.round(Math.PI * r / STEP), dh = sgn * Math.PI / n;
        for (let i = 0; i < n; i++) { h += dh; x += Math.cos(h) * STEP; z -= Math.sin(h) * STEP; y -= slope * STEP; push(sgn / r); }
      }
      straight();
      zoneRanges.push({ type: 'zigzag', i0, i1: xs.length - 1, dir, axis });
    } else if (cmd[0] === 'Z') {
      const i0 = xs.length - 1;
      const n = Math.round(cmd[2] / STEP);
      for (let i = 0; i < n; i++) {
        x += Math.cos(h) * STEP; z -= Math.sin(h) * STEP; y -= cmd[3] * STEP; push(0);
      }
      zoneRanges.push({ type: cmd[1], i0, i1: xs.length - 1 });
    } else if (cmd[0] === 'S') {
      const n = Math.round(cmd[1] / STEP);
      for (let i = 0; i < n; i++) {
        x += Math.cos(h) * STEP; z -= Math.sin(h) * STEP; y -= cmd[2] * STEP; push(0);
      }
    } else if (cmd[0] === 'T') {
      const ang = THREE.MathUtils.degToRad(cmd[1]);
      const len = Math.abs(ang) * cmd[2];
      const n = Math.round(len / STEP);
      const dh = ang / n;
      const k = Math.sign(ang) / cmd[2];
      for (let i = 0; i < n; i++) {
        h += dh;
        x += Math.cos(h) * STEP; z -= Math.sin(h) * STEP; y -= cmd[3] * STEP; push(k);
      }
    }
  }

  const N = xs.length;
  // 高度分段平滑：漏斗入口和洞口兩邊各自平滑，不要互相拉扯（不然會在入口前或出口後做出小台階）
  const cuts = [0, ...funnels.flatMap(f => [f.i0 + 1, f.i1 + 1]), N];
  const ySm = [];
  for (let k = 0; k + 1 < cuts.length; k++) ySm.push(...smooth(ys.slice(cuts[k], cuts[k + 1]), 4, 2));
  for (const f of funnels) for (let i = f.i0 + 1; i <= f.i1; i++) ySm[i] = ys[i];
  const bank = smooth(curv.map(k => THREE.MathUtils.clamp(k * 11, -0.4, 0.4)), 16, 3);
  // 夾彎每個彎各自傾斜（不然左彎右彎平滑後互相抵消，彈珠會直接撞牆停下來）
  for (const z of zoneRanges) if (z.type === 'zigzag') {
    const raw = curv.slice(z.i0, z.i1 + 1).map(k => THREE.MathUtils.clamp(k * 11, -ZIGZAG_BANK, ZIGZAG_BANK));
    smooth(raw, 3, 2).forEach((b, k) => { bank[z.i0 + k] = b; });
  }

  // 2. 寬度
  const total = (N - 1) * STEP;
  const half = new Float32Array(N);
  // 終點前的放寬從水底隧道出口才開始（水箱要一樣寬）
  const wideAt = Math.max(total - 46, ...zoneRanges.filter(z => z.type === 'water').map(z => z.i1 * STEP));
  for (let i = 0; i < N; i++) {
    const s = i * STEP;
    let w = 5.5;
    if (s < 34) w = 8.2;
    else if (s < 52) w = THREE.MathUtils.lerp(8.2, 5.5, (s - 34) / 18);
    if (s > wideAt) w = THREE.MathUtils.lerp(5.5, 8.5, Math.min(1, (s - wideAt) / 12));
    half[i] = w;
  }
  // 夾彎溝槽變窄（前後 10 單位慢慢收窄、放寬，彈珠才會乖乖排成一列進去），牆也變矮，像木板上挖出來的溝
  const wallH = new Float32Array(N).fill(WALL_H);
  for (const z of zoneRanges) if (z.type === 'zigzag') {
    const n = Math.round(10 / STEP);
    for (let i = z.i0 - n; i <= z.i1 + n; i++) {
      const k = i < z.i0 ? (z.i0 - i) / n : i > z.i1 ? (i - z.i1) / n : 0;
      half[i] = Math.min(half[i], THREE.MathUtils.lerp(ZIGZAG_LANE, half[i], k));
      // 入口和前兩個彎的牆維持高的（彈珠剛衝進來還很快，矮牆會被甩出去），之後才變成矮矮的溝
      const kin = Math.min(1, Math.max(0, (i - z.i0 - Math.round(ZIGZAG_TALL / STEP)) / Math.round(4 / STEP)));
      if (i >= z.i0) wallH[i] = Math.min(wallH[i], THREE.MathUtils.lerp(WALL_H, THREE.MathUtils.lerp(ZIGZAG_WALL, WALL_H, k), kin));
    }
  }
  // 彈珠台：跳跳積木彈出來的彈珠又高又快，撞到釘子會飛出去，所以牆加高（入口前 4 單位漸漸升高，出口前 6 單位漸漸降回來）
  for (const z of zoneRanges) if (z.type === 'pegs') {
    const n = Math.round(4 / STEP), m = Math.round(6 / STEP);
    for (let i = z.i0 - n; i <= z.i1; i++) {
      const k = Math.max((z.i0 - i) / n, (i - (z.i1 - m)) / m, 0);
      wallH[i] = Math.max(wallH[i], THREE.MathUtils.lerp(PEGS_WALL, WALL_H, k));
    }
  }
  for (const f of funnels) {
    const n = Math.round(f.taper / STEP);
    for (let k = 0; k <= n; k++) half[f.i0 - k] = Math.min(half[f.i0 - k], THREE.MathUtils.lerp(f.lane, 5.5, k / n));
    for (let i = f.i0 + 1; i <= f.i1; i++) half[i] = f.R;
  }
  // 分岔匯流：進島前收窄到 outer、尾巴之後收進頸部、再放寬回原本的寬度（左右對稱，每段至少 ease 單位長）
  for (const z of zoneRanges) if (z.type === 'fork') {
    const F = FORK, d1 = F.lead + F.nose + F.body, d2 = d1 + F.tail, d3 = d2 + F.neckLen;
    for (let i = z.i0 + Math.round((F.lead - F.ease) / STEP); i <= z.i0 + Math.round((d3 + F.ease) / STEP); i++) {
      const d = (i - z.i0) * STEP, base = half[i];
      const w = d < F.lead ? THREE.MathUtils.lerp(base, F.outer, (d - (F.lead - F.ease)) / F.ease)
        : d < d1 ? F.outer
        : d < d2 ? THREE.MathUtils.lerp(F.outer, F.neck, (d - d1) / F.tail)
        : d < d3 ? F.neck
        : THREE.MathUtils.lerp(F.neck, base, (d - d3) / F.ease);
      half[i] = Math.min(base, w);
    }
  }

  // 跳跳積木那段地板幾乎是平的，四塊積木才能鋪滿整個跑道寬
  const rise = new Float32Array(N).fill(EDGE_RISE);
  for (const z of zoneRanges) if (z.type === 'piston') {
    const n = Math.round(6 / STEP);
    for (let i = z.i0 - n; i <= z.i1 + n; i++) {
      const k = Math.min(1, Math.max(0, (z.i0 - i) / n, (i - z.i1) / n));
      rise[i] = THREE.MathUtils.lerp(PISTON_RISE, EDGE_RISE, k);
    }
  }

  // 3. 座標系
  const P = [], T = [], R = [], U = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) P.push(new THREE.Vector3(xs[i], ySm[i], zs[i]));
  for (let i = 0; i < N; i++) {
    // 斷開的地方只看同一側的鄰點
    const a = P[i > 0 && !breaks.has(i - 1) ? i - 1 : i], b = P[i < N - 1 && !breaks.has(i) ? i + 1 : i];
    const t = b.clone().sub(a).normalize();
    const r0 = t.clone().cross(up).normalize();
    const u0 = r0.clone().cross(t).normalize();
    const bk = bank[i];
    const r = r0.clone().multiplyScalar(Math.cos(bk)).addScaledVector(u0, Math.sin(bk));
    const u = u0.clone().multiplyScalar(Math.cos(bk)).addScaledVector(r0, -Math.sin(bk));
    T.push(t); R.push(r); U.push(u);
  }

  // 每一點所在的連續段起點（漏斗洞口把賽道切成上下兩段）
  const segStart = new Int32Array(N);
  for (let i = 1; i < N; i++) segStart[i] = breaks.has(i - 1) ? i : segStart[i - 1];

  const floor = new Uint8Array(N).fill(1);
  for (let i = 0; i < N; i++) if (noFloor[i]) floor[i] = 0;   // 漏斗那段沒有賽道
  const ranges = [];
  let rs = -1;
  for (let i = 0; i <= N; i++) {
    if (i < N && floor[i]) { if (rs < 0) rs = i; }
    else if (rs >= 0) { ranges.push([rs, i - 1]); rs = -1; }
  }

  const idxAt = s => Math.max(0, Math.min(N - 1, Math.round(s / STEP)));

  // 4. 起跑格位 & 閘門
  const gateI = idxAt(30);
  const finishI = idxAt(total - 30);

  // 5. 下注版不設淘汰檢查點
  const checkpoints = [];

  // 6. 三個障礙區
  // 連續的小漏斗合成同一關
  const merged = [];
  for (const z of zoneRanges) {
    const prev = merged.at(-1);
    if (z.type === 'minifunnel' && prev?.type === 'minifunnel') prev.i1 = z.i1;
    else merged.push({ ...z });
  }
  const zones = merged.map(z => {
    if (z.type === 'minifunnel') return { ...z, s0: z.i0 * STEP, s1: z.i1 * STEP, crosses: [], pistons: [], pegs: [], funnels: funnels.filter(f => f.i0 >= z.i0 && f.i1 <= z.i1) };
    if (z.type === 'zigzag') return { ...z, s0: z.i0 * STEP, s1: z.i1 * STEP, crosses: [], pistons: [], pegs: [] };
    if (z.type === 'funnel') return { ...z, s0: z.i0 * STEP, s1: z.i1 * STEP, crosses: [], pistons: [], pegs: [], funnels: funnels.filter(f => f.i0 === z.i0) };
    const len = (z.i1 - z.i0) * STEP;
    const at = d => z.i0 + Math.round(d / STEP);
    const zone = { ...z, s0: z.i0 * STEP, s1: z.i1 * STEP, crosses: [], pistons: [], pegs: [], islands: [] };
    if (z.type === 'fork') {
      // 一座島，鼻尖在 lead 處；sim 和畫面都從 FORK 的尺寸長出同一座島
      zone.islands.push({ i0: at(FORK.lead), len: FORK.nose + FORK.body + FORK.tail });
    } else if (z.type === 'cross') {
      // 三座十字旋轉門，轉向交錯
      for (let k = 0; k < 3; k++) zone.crosses.push({ i: at(10 + k * 15), speed: (k % 2 ? -1 : 1) * (1.6 + rand() * 0.3), angle: rand() * Math.PI });
    } else if (z.type === 'piston') {
      // 一列 4 塊大積木鋪滿整個跑道寬，像琴鍵一樣交錯升降
      const rows = Math.floor(len / PISTON_ROW), d0 = (len - (rows - 1) * PISTON_ROW) / 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < PISTON_COLS; c++) {
        const i = at(d0 + r * PISTON_ROW), cw = half[i] * 2 / PISTON_COLS;
        zone.pistons.push({ i, lat: (c - (PISTON_COLS - 1) / 2) * cw, hw: cw / 2 - 0.04, hd: PISTON_ROW / 2 - 0.05, row: r, col: c, color: Math.floor(rand() * 6) });
      }
    } else if (z.type === 'pegs') {
      // 交錯排列的釘子
      const rows = 9, gap = 3.8, d0 = (len - (rows - 1) * gap) / 2;
      for (let r = 0; r < rows; r++) {
        const lats = r % 2 ? [-2.6, 0, 2.6] : [-3.9, -1.3, 1.3, 3.9];
        for (const lat of lats) zone.pegs.push({ i: at(d0 + r * gap), lat: lat + (rand() - 0.5) * 0.3 });
      }
    }
    return zone;
  });

  // 6a. 漏斗幾何：錐面（中間開洞）＋邊緣的牆（入口那段不蓋）
  for (const f of funnels) {
    const [cx, cz] = f.c, RINGS = 22, SEG = 64;
    const pt = (r, a, dy = 0) => [cx + Math.cos(a) * r, f.yRim - f.depth * funnelDepth(r, f.R) + dy, cz + Math.sin(a) * r];
    const cone = [], cIdx = [];
    for (let k = 0; k <= RINGS; k++) {
      const r = FUNNEL_HOLE + (f.R - FUNNEL_HOLE) * Math.pow(k / RINGS, 1.6);   // 越靠中間切越細
      for (let j = 0; j <= SEG; j++) cone.push(...pt(r, j / SEG * Math.PI * 2));
    }
    for (let k = 0; k < RINGS; k++) for (let j = 0; j < SEG; j++) {
      const A = k * (SEG + 1) + j, B = A + 1, C = A + SEG + 1, D = C + 1;
      cIdx.push(A, B, C, B, D, C);          // 法線朝上（這種碰撞網格只有正面擋得住）
    }
    // 邊牆整圈都有（入口賽道從牆上方經過）
    const wall = [], wIdx = [];
    for (let j = 0; j < SEG; j++) {
      const a0 = j / SEG * Math.PI * 2, a1 = (j + 1) / SEG * Math.PI * 2, b = wall.length / 3;
      wall.push(...pt(f.R, a0, -0.2), ...pt(f.R, a1, -0.2), ...pt(f.R, a0, f.wallH), ...pt(f.R, a1, f.wallH));
      wIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);   // 法線朝漏斗內
    }
    f.cone = { vertices: new Float32Array(cone), indices: new Uint32Array(cIdx), rings: RINGS, seg: SEG };
    f.wallMesh = { vertices: new Float32Array(wall), indices: new Uint32Array(wIdx) };
  }

  // 7. 碰撞網格（每段連續地板一個 trimesh）
  const colliders = ranges.map(([a, b]) => {
    const prof0 = colliderProfile(1);
    const M = prof0.length;
    const verts = new Float32Array((b - a + 1) * M * 3);
    const idx = [];
    let v = 0;
    for (let i = a; i <= b; i++) {
      const prof = colliderProfile(half[i], wallH[i], rise[i]);
      for (const [px, py] of prof) {
        verts[v++] = P[i].x + R[i].x * px + U[i].x * py;
        verts[v++] = P[i].y + R[i].y * px + U[i].y * py;
        verts[v++] = P[i].z + R[i].z * px + U[i].z * py;
      }
    }
    for (let i = 0; i < b - a; i++) {
      for (let j = 0; j < M - 1; j++) {
        const A = i * M + j, B = A + 1, C = A + M, D = C + 1;
        idx.push(A, B, C, B, D, C);
      }
    }
    return { vertices: verts, indices: new Uint32Array(idx) };
  });

  return {
    N, P, T, R, U, half, wallH, rise, floor, ranges, total,
    gateI, finishI, checkpoints, zones, funnels, segStart, colliders: [...colliders, ...funnels.flatMap(f => [f.cone, f.wallMesh])],
    startI: 0, endI: N - 1,
  };
}

// 軌道上某點（局部 lat/高度）→ 世界座標
export function trackPoint(track, i, lat, height, out = new THREE.Vector3()) {
  return out.copy(track.P[i]).addScaledVector(track.R[i], lat).addScaledVector(track.U[i], height);
}

// 軌道座標系四元數（x=右, y=上, z=-前進方向）
export function trackQuat(track, i, out = new THREE.Quaternion()) {
  const m = new THREE.Matrix4().makeBasis(track.R[i], track.U[i], track.T[i].clone().negate());
  return out.setFromRotationMatrix(m);
}

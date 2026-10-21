// 賽道產生器：用「烏龜指令」畫出中心線，再沿線長出 U 型木製軌道
import * as THREE from 'three';

export const STEP = 0.5;          // 取樣間距
export const WALL_H = 3.0;        // 牆高（以軌道底為 0）
export const EDGE_RISE = 0.9;     // 地板兩側上翹高度
export const WALL_T = 0.7;        // 牆厚
export const BEAM = 1.0;          // 軌道底下厚度
const FLOOR_SEGS = 16;

// 指令：S 直線(長度, 坡度)  T 轉彎(角度, 半徑, 坡度，正=左轉)  J 跳台(缺口長度)
//       Z 障礙區(種類, 長度, 坡度)：直線上放一整區障礙
//       R 回程直線(長度, 坡度)：U 字迴轉後的直線，金色積木抄近路的落點
// 坡度為每單位長度下降量
const PROGRAM = [
  ['S', 52, 0.015],     // 起跑區
  ['S', 20, 0.12],
  ['T', 90, 32, 0.06],
  ['S', 24, 0.07],
  ['T', -100, 30, 0.06],
  ['S', 24, 0.05],      // 跳台前的助跑
  ['J', 7],
  ['S', 20, 0.05],
  ['T', 200, 26, 0.055],
  ['Z', 'cross', 50, 0.08],   // 障礙區 1：旋轉十字
  ['T', -90, 30, 0.06],
  ['S', 16, 0.05],
  ['T', -90, 30, 0.06],
  ['S', 8, 0.06],
  ['Z', 'piston', 44, 0.06],  // 障礙區 2：跳跳積木
  ['S', 8, 0.06],
  ['T', 180, 14, 0.07],       // U 字迴轉
  ['R', 64, 0.05],            // 回程直線：金色積木抄近路會落在這裡
  ['T', -90, 28, 0.06],
  ['S', 24, 0.05],      // 跳台前的助跑
  ['J', 8],
  ['S', 24, 0.05],
  ['T', -120, 25, 0.06],
  ['Z', 'pegs', 46, 0.2],     // 障礙區 3：彈珠台（比較陡）
  ['T', -60, 30, 0.05],
  ['S', 30, 0.05],
  ['S', 40, 0.0],       // 終點收集區
];

export const ZONE_INFO = {
  cross: { name: '旋轉十字', icon: '✚' },
  piston: { name: '跳跳積木', icon: '🧱' },
  pegs: { name: '彈珠台', icon: '📍' },
};

const GOLD_ROWS = [3, 7, 11, 15];  // 哪幾列的左邊兩排積木是金色的
const SHORTCUT_AHEAD = -8;        // 落點在回程直線上、積木正對面再往前多遠（負的＝往回一點）

const START = new THREE.Vector3(-105, 70, 95);
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
export function colliderProfile(hw) {
  const pts = [[-hw - WALL_T, WALL_H], [-hw, WALL_H]];
  for (let k = 0; k <= FLOOR_SEGS; k++) {
    const x = -hw + (2 * hw * k) / FLOOR_SEGS;
    pts.push([x, EDGE_RISE * Math.pow(Math.abs(x / hw), 3)]);
  }
  pts.push([hw, WALL_H], [hw + WALL_T, WALL_H]);
  return pts;
}

export function floorHeightAt(lat, hw) {
  const x = Math.min(1, Math.abs(lat / hw));
  return EDGE_RISE * x * x * x;
}

export function buildTrack(seed = 7) {
  const rand = mulberry32(seed);

  // 1. 烏龜走出 2D 路徑 + 高度
  const xs = [], zs = [], ys = [], curv = [], gapFlag = [];
  let x = START.x, z = START.z, y = START.y, h = START_HEADING;
  const push = (k, gap = 0) => { xs.push(x); zs.push(z); ys.push(y); curv.push(k); gapFlag.push(gap); };
  push(0);
  const gaps = [];
  const zoneRanges = [];
  let returnRange = null;
  for (const cmd of PROGRAM) {
    if (cmd[0] === 'R') {
      const i0 = xs.length - 1;
      const n = Math.round(cmd[1] / STEP);
      for (let i = 0; i < n; i++) {
        x += Math.cos(h) * STEP; z -= Math.sin(h) * STEP; y -= cmd[2] * STEP; push(0);
      }
      returnRange = [i0, xs.length - 1];
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
    } else if (cmd[0] === 'J') {
      // 小跳台：先上揚 5 單位，再接缺口
      for (let i = 0; i < 10; i++) { x += Math.cos(h) * STEP; z -= Math.sin(h) * STEP; y += 0.16 * STEP; push(0); }
      const n = Math.round(cmd[1] / STEP);
      const g0 = xs.length;
      for (let i = 0; i < n; i++) { x += Math.cos(h) * STEP; z -= Math.sin(h) * STEP; y -= 0.32 * STEP; push(0, 1); }
      gaps.push([g0, xs.length - 1]);
    }
  }

  const N = xs.length;
  const ySm = smooth(ys, 4, 2);
  // 缺口區維持原高度（避免平滑把落差抹掉）
  for (const [a, b] of gaps) for (let i = a - 2; i <= b + 2; i++) ySm[i] = ys[i];
  const bank = smooth(curv.map(k => THREE.MathUtils.clamp(k * 11, -0.4, 0.4)), 16, 3);

  // 2. 寬度
  const total = (N - 1) * STEP;
  const half = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = i * STEP;
    let w = 5.5;
    if (s < 34) w = 8.2;
    else if (s < 52) w = THREE.MathUtils.lerp(8.2, 5.5, (s - 34) / 18);
    if (s > total - 46) w = THREE.MathUtils.lerp(5.5, 8.5, Math.min(1, (s - (total - 46)) / 12));
    half[i] = w;
  }

  // 3. 座標系
  const P = [], T = [], R = [], U = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) P.push(new THREE.Vector3(xs[i], ySm[i], zs[i]));
  for (let i = 0; i < N; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    const r0 = t.clone().cross(up).normalize();
    const u0 = r0.clone().cross(t).normalize();
    const bk = bank[i];
    const r = r0.clone().multiplyScalar(Math.cos(bk)).addScaledVector(u0, Math.sin(bk));
    const u = u0.clone().multiplyScalar(Math.cos(bk)).addScaledVector(r0, -Math.sin(bk));
    T.push(t); R.push(r); U.push(u);
  }

  const floor = new Uint8Array(N).fill(1);
  for (let i = 0; i < N; i++) if (gapFlag[i]) floor[i] = 0;
  const ranges = [];
  let rs = -1;
  for (let i = 0; i <= N; i++) {
    if (i < N && floor[i]) { if (rs < 0) rs = i; }
    else if (rs >= 0) { ranges.push([rs, i - 1]); rs = -1; }
  }

  const idxAt = s => Math.max(0, Math.min(N - 1, Math.round(s / STEP)));
  const inGapNear = (i, margin) => gaps.some(([a, b]) => i > a - margin && i < b + margin);

  // 4. 起跑格位 & 閘門
  const gateI = idxAt(30);
  const finishI = idxAt(total - 30);

  // 5. 下注版不設淘汰檢查點
  const checkpoints = [];

  // 6. 三個障礙區
  const zones = zoneRanges.map(z => {
    const len = (z.i1 - z.i0) * STEP;
    const at = d => z.i0 + Math.round(d / STEP);
    const zone = { ...z, s0: z.i0 * STEP, s1: z.i1 * STEP, crosses: [], pistons: [], pegs: [] };
    if (z.type === 'cross') {
      // 三座十字旋轉門，轉向交錯
      for (let k = 0; k < 3; k++) zone.crosses.push({ i: at(10 + k * 15), speed: (k % 2 ? -1 : 1) * (1.6 + rand() * 0.3), angle: rand() * Math.PI });
    } else if (z.type === 'piston') {
      // 4 排 × 18 列的積木鋪滿整區，像琴鍵一樣交錯升降
      const rows = 18, gap = 2.1, d0 = (len - (rows - 1) * gap) / 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < 4; c++) {
        // 靠 U 字內側（左邊）兩排有幾塊金色積木
        const gold = c <= 1 && GOLD_ROWS.includes(r);
        zone.pistons.push({ i: at(d0 + r * gap), lat: (c - 1.5) * 2, row: r, col: c, gold, color: Math.floor(rand() * 6), letter: Math.floor(rand() * 26) });
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

  // 6b. 金色積木抄近路：從積木飛到回程直線上、往前一點的地方
  const shortcuts = [];
  if (returnRange) {
    const [r0, r1] = returnRange;
    for (const z of zones) z.pistons.forEach((pc, k) => {
      if (!pc.gold) return;
      const from = P[pc.i].clone().addScaledVector(R[pc.i], pc.lat);
      let near = r0, bd = Infinity;
      for (let i = r0; i <= r1; i++) { const d = Math.hypot(P[i].x - from.x, P[i].z - from.z); if (d < bd) { bd = d; near = i; } }
      const land = Math.min(r1, near + Math.round(SHORTCUT_AHEAD / STEP));
      pc.land = land;
      shortcuts.push({ piston: k, land, from: [from.x, from.z], to: [P[land].x, P[land].z] });
    });
  }

  // 7. 碰撞網格（每段連續地板一個 trimesh）
  const colliders = ranges.map(([a, b]) => {
    const prof0 = colliderProfile(1);
    const M = prof0.length;
    const verts = new Float32Array((b - a + 1) * M * 3);
    const idx = [];
    let v = 0;
    for (let i = a; i <= b; i++) {
      const prof = colliderProfile(half[i]);
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
    N, P, T, R, U, half, floor, ranges, gaps, total,
    gateI, finishI, checkpoints, zones, shortcuts, colliders,
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

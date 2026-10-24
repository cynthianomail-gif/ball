// 物理世界 + 比賽規則 + AI（不含畫面，可在 Node 裡跑無頭模擬）
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { STEP, trackPoint, trackQuat, mulberry32, floorHeightAt, WALL_H, BEAM, FUNNEL_HOLE, FORK, forkHalf, WATER_DIV, dividerHalf, dividerLat, funnelDepth } from './track.js';

export const RADIUS = 0.5;
export const GRAVITY = 30;
export const DT = 1 / 60;

// 跳跳積木（閘門）：lift 升起高度（比彈珠高很多，升起來就是擋路的牆）、omega 升降角速度（週期 2π/omega ≈ 4.5 秒）
// 積木是一根從軌道底板一路頂到 top 的實心柱，降下來時整根藏在底板裡
export const PISTON = { lift: 1.6, omega: 1.4 };
export const PEG_R = 0.28;
// 相鄰積木的相位差：每一列錯開 ROW，同一列四塊差 1/4 圈（任何時刻每一列至少有一塊是低的）
const PISTON_PHASE_ROW = 0.7;
const PISTON_PHASE_COL = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
// 水底隧道：兩道隔板（track.js 的 WATER_DIV）把水區隔成三道，隔板外側的兩側水道才有水，中間乾道不受影響
// 在水裡阻尼加大到 damp、浮力把重力減掉 buoy 倍；入口 ease 單位內漸變，離開恢復原阻尼 BASE_DAMP
export const WATER = { damp: 0.33, buoy: 0.45, ease: 3 };
const BASE_DAMP = 0.12;
// 漏斗：裡面的阻尼比平地大（每個漏斗自己的 damp），彈珠才會一圈圈慢慢繞進洞，不是一衝就掉下去
// check 秒內幾乎沒動、速度又很小＝卡住，輕推一下；洞口 mouth 範圍內擠了 2 顆以上、jam 秒沒有彈珠掉出去＝塞住，
// 敲一下（往上 tapUp、往旁邊 tapSide 的速度）；push 是入口滑槽上調速的最大加速度
// 繞圈助力（漏斗有 laps 的才有）：spinAcc 最大加速度、spinPull 離該在的半徑多遠就加減多少速度、spinDamp 抵銷離開螺旋的徑向速度
export const FUNNEL = { check: 1.0, mouth: 1.8, jam: 0.5, tapUp: 3.5, tapSide: 2.5, tapGrow: 0.5, tapMax: 3, push: 12, spinAcc: 10, spinPull: 1, spinDamp: 2 };
// 出界救援（像雲上釣魚人）：等一下 → 手抓著彈珠從高處降下 → 在跑道上停一下 → 放手 → 手收回
// 單位是秒；height＝手降下前的高度；drop＝放手時彈珠離地的空隙；speed＝放手後沿賽道的初速；holdMax＝落點被擋時最多多等幾秒
export const RESCUE = { wait: 0.35, down: 0.75, hold: 0.2, up: 0.7, height: 10, drop: 0.3, speed: 7, holdMax: 0.6 };
const smooth = u => u * u * (3 - 2 * u);
const popIn = u => { const c = 1.7, v = u - 1; return 1 + (c + 1) * v * v * v + c * v * v; };   // 先衝過頭再回彈
// 追趕：落後領先者越多，極速越高（每落後 1 單位多 per 倍，最多 max 倍），推力也跟著加 thrust 倍的比例。
// 拉開很遠的領先者不會穩贏，逆轉才多；只看落後多少，每顆都一樣，不影響公平
export const CATCHUP = { per: 0.02, max: 0.35, thrust: 2 };
// 彈珠互撞的彈性（撞了會彈開，玻璃珠的手感）；彈珠自己的彈性只用在互撞
export const MARBLE_REST = 0.75;
// 其他東西一律用 Min 規則：填的數字就是彈珠撞到它時實際的彈性（不會被彈珠的 0.75 拉高）
const rest = (desc, e) => desc.setRestitution(e).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);

export async function initPhysics() { await RAPIER.init(); }

export const UPGRADES = [
  { id: 'engine', icon: '🚀', name: '渦輪引擎', desc: '推進力 +25%', apply: s => { s.thrust *= 1.25; } },
  { id: 'speed', icon: '💨', name: '流線外殼', desc: '極速 +12%', apply: s => { s.maxSpeed *= 1.12; } },
  { id: 'dash', icon: '⚡', name: '閃電衝刺', desc: '衝刺次數 +2', apply: s => { s.dashes += 2; } },
  { id: 'heavy', icon: '🪨', name: '鉛芯彈珠', desc: '重量 +60%，撞人更痛', apply: s => { s.mass *= 1.6; } },
  { id: 'air', icon: '🪂', name: '空中操控', desc: '空中轉向 +80%', apply: s => { s.air = Math.min(1, s.air * 1.8); } },
  { id: 'grip', icon: '🧤', name: '防滑表面', desc: '轉向反應 +40%', apply: s => { s.grip *= 1.4; } },
];

export const MARBLE_NAMES = [
  '小藍', '火球', '薄荷', '月光', '可樂', '櫻桃', '海鹽', '芒果', '墨墨', '雪球',
  '閃電', '布丁', '奇異果', '黑糖', '波波', '彩虹', '小橘', '星塵', '蜂蜜', '綠豆',
  '咖啡', '阿土', '珍珠', '旋風', '葡萄', '琉璃', '紅豆', '冰沙', '銀河', '檸檬',
  '花生', '豆腐', '金桔', '烏龍', '辣椒', '麻糬', '水母', '蘇打', '石頭', '果凍',
  '泡芙', '藍莓', '鐵蛋', '湯圓', '番茄', '海苔', '龍眼', '奶茶', '仙草', '甜甜',
];

const PALETTE = [
  0xe63946, 0x1d7af3, 0x2ec27e, 0xf4a300, 0x9b5de5, 0xff6fb5, 0x00b4d8, 0xff7b00,
  0x6a994e, 0xc1121f, 0x3a0ca3, 0x06d6a0, 0xffd60a, 0x8d5524, 0x4cc9f0, 0xf15bb5,
];

function baseStats() {
  return { thrust: 13, maxSpeed: 21, dashes: 1, mass: 1, air: 0.35, grip: 1 };
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

export class Race {
  // player: false 時沒有玩家彈珠，全部交給 AI（下注模式）
  // elimRate：每過一個檢查點累計淘汰的比例；palette：指定每顆彈珠的顏色
  constructor(track, { count = 50, seed = 1, playerColor = null, autopilot = false, difficulty = 1, player = true, elimRate = 0.2, palette = null } = {}) {
    this.track = track;
    this.count = count;
    this.rand = mulberry32(seed);
    this.autopilot = autopilot;
    this.time = 0;
    this.phase = 'countdown';
    this.countdown = 3.5;
    this.events = [];
    this.finishOrder = [];
    this.elimOrder = [];
    this.fPass = track.funnels.map(() => 0);   // 各漏斗最近一次有彈珠掉出洞口的時間
    this.fTaps = track.funnels.map(() => 0);   // 各漏斗從那次起連續敲了幾下
    this.touching = new Set();   // 正碰在一起的彈珠對（互撞只在剛碰上時響一聲）

    const world = this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    world.timestep = DT;

    // 軌道
    for (const c of track.colliders) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      world.createCollider(
        rest(RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.7), 0.25), body);
    }
    // 起點與終點的擋板
    this._wall(track.startI + 1, 0.5);
    this._wall(track.endI - 1, 0.5);
    this.gate = this._wall(track.gateI, 0.3);
    // 漏斗洞口下方的出口賽道後面加一道擋板，接住掉下來的彈珠（頂端要比洞口低，不然會頂進漏斗的錐面，彈珠就停在上面）
    for (const f of track.funnels) this._wall(f.exitI, 0.4, Math.min(WALL_H, (f.yHole - track.P[f.exitI].y - 0.6) / 1.5));

    // 障礙區
    this.crosses = [];
    this.pistons = [];
    for (const z of track.zones) {
      // 旋轉十字：中間柱子 + 兩根交叉橫桿
      for (const c of z.crosses) {
        const pos = trackPoint(track, c.i, 0, 0);
        const base = trackQuat(track, c.i);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z).setRotation(base));
        const hl = track.half[c.i] - 0.5;
        world.createCollider(rest(RAPIER.ColliderDesc.cylinder(1.6, 0.45).setTranslation(0, 1.6, 0), 0.15), body);
        world.createCollider(rest(RAPIER.ColliderDesc.cuboid(hl, 0.25, 0.25).setTranslation(0, 0.95, 0), 0.55), body);
        world.createCollider(rest(RAPIER.ColliderDesc.cuboid(0.25, 0.25, hl).setTranslation(0, 0.95, 0), 0.55), body);
        this.crosses.push({ ...c, body, base: base.clone(), halfLen: hl });
      }
      // 跳跳積木（閘門）：平時藏在地板下，輪流慢慢升起擋路，再降下來放行
      for (const pc of z.pistons) {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setRotation(trackQuat(track, pc.i)));
        // 柱子的高度固定（升起來底部剛好還在底板裡），降下來時多出來的部分垂在底板下面，沒有彈珠會去那裡
        const base = floorHeightAt(Math.max(0, Math.abs(pc.lat) - pc.hw), track.half[pc.i], track.rise[pc.i]) - 0.04, bot = -BEAM + 0.05;
        const hh = (base + PISTON.lift - bot) / 2;
        world.createCollider(rest(RAPIER.ColliderDesc.cuboid(pc.hw, hh, pc.hd).setFriction(0.6), 0.2), body);
        const pt = { ...pc, s: pc.i * STEP, body, base, bot, hh, phase: PISTON_PHASE_ROW * pc.row + PISTON_PHASE_COL[pc.col], top: base };
        this._movePiston(pt, 0);
        body.setTranslation(trackPoint(track, pt.i, pt.lat, pt.top - pt.hh), true);
        this.pistons.push(pt);
      }
      // 分岔匯流的島：靜態的水滴形凸殼（鼻圓、身直、尾收尖），底部埋進地板
      for (const isl of z.islands ?? []) {
        const pts = [];
        for (let k = 0; k * STEP <= isl.len; k++) {
          const hw = forkHalf(k * STEP);
          for (const lat of [-hw, hw]) for (const h of [-0.3, FORK.hh]) { const p = trackPoint(track, isl.i0 + k, lat, h); pts.push(p.x, p.y, p.z); }
        }
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        world.createCollider(rest(RAPIER.ColliderDesc.convexHull(new Float32Array(pts)).setFriction(0.2), 0.3), body);
      }
      // 水底隧道的隔板：兩端圓頭的長條凸殼，底部埋進地板
      for (const dv of z.dividers ?? []) {
        const pts = [];
        for (let k = 0; k * STEP <= dv.len; k++) {
          const hw = dividerHalf(k * STEP, dv.len);
          const c = dv.side * dividerLat(k * STEP, dv.len);
          for (const lat of [c - hw, c + hw]) for (const h of [-0.3, WATER_DIV.h]) { const p = trackPoint(track, dv.i0 + k, lat, h); pts.push(p.x, p.y, p.z); }
        }
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        world.createCollider(rest(RAPIER.ColliderDesc.convexHull(new Float32Array(pts)).setFriction(0.2), 0.3), body);
      }
      // 彈珠台：一根根固定的釘子
      for (const pg of z.pegs) {
        const pos = trackPoint(track, pg.i, pg.lat, floorHeightAt(pg.lat, track.half[pg.i]) + 1.1);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(trackQuat(track, pg.i)));
        world.createCollider(rest(RAPIER.ColliderDesc.cylinder(1.3, PEG_R).setFriction(0.2), 0.375), body);
      }
    }
    this.waterZone = track.zones.find(z => z.type === 'water');
    // 彈珠台、夾彎、分岔、水底隧道裡沒有 AI，只靠重力（夾彎裡 AI 會一直往彎道牆上撞；水裡 AI 的推力會把實力差放大成速度差）
    this.freeZones = track.zones.filter(z => ['pegs', 'zigzag', 'fork', 'water'].includes(z.type));

    // 檢查點：每過一個淘汰 elimRate（預設 20%）
    this.cps = track.checkpoints.map((i, k) => ({
      i, s: i * STEP, keep: count - Math.round(count * elimRate * (k + 1)), passed: [], closed: false,
    }));
    this.finishS = track.finishI * STEP;

    // 彈珠
    this.marbles = [];
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const cols = 10;
    const rows = Math.ceil(count / cols);
    const slots = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push([r, c]);
    // 玩家放中間那排
    const pr = Math.floor(rows / 2), pc = 2 + Math.floor(this.rand() * 6);
    const playerSlot = player ? slots.findIndex(([r, c]) => r === pr && c === pc) : -1;
    const others = slots.filter((_, k) => k !== playerSlot);
    for (let k = others.length - 1; k > 0; k--) { const j = Math.floor(this.rand() * (k + 1)); [others[k], others[j]] = [others[j], others[k]]; }
    const order = player ? [slots[playerSlot], ...others] : others;

    const names = MARBLE_NAMES.slice();
    for (let k = names.length - 1; k > 0; k--) { const j = Math.floor(this.rand() * (k + 1)); [names[k], names[j]] = [names[j], names[k]]; }

    for (let n = 0; n < count; n++) {
      const [r, c] = order[n];
      const s = track.gateI * STEP - 2.5 - r * 1.6;
      const i = Math.round(s / STEP);
      const lat = (c - (cols - 1) / 2) * 1.35;
      const fh = floorHeightAt(lat, track.half[i], track.rise[i]);
      const p = trackPoint(track, i, lat, fh + RADIUS + 0.05);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z)
        .setCcdEnabled(true).setLinearDamping(BASE_DAMP).setAngularDamping(0.4));
      const collider = world.createCollider(RAPIER.ColliderDesc.ball(RADIUS).setDensity(1).setFriction(0.8).setRestitution(MARBLE_REST), body);
      const isPlayer = player && n === 0;
      const m = {
        id: n, isPlayer, name: isPlayer ? '你' : names[n % names.length],
        color: isPlayer && playerColor != null ? playerColor : palette ? palette[n % palette.length] : PALETTE[(n * 7) % PALETTE.length],
        pattern: n % 6,
        body, collider, alive: true, finished: false, place: 0,
        row: r, idx: i, s, lat, h: 0, maxS: s, cp: 0, safeIdx: i, offTimer: 0, respawns: 0, rescue: null,
        grounded: false, dashCd: 0, hitCd: 0, pv: { x: 0, y: 0, z: 0 }, stillTimer: 0, tapN: 0, funnel: null, funnelT: 0, fRef: null, damp: BASE_DAMP,
        stats: baseStats(), upgrades: [], elimT: 0, rank: n + 1,
        input: { x: 0, z: 0, dash: false },
        ai: (isPlayer && !autopilot) ? null : this._makeAI(),
      };
      if (m.ai && !isPlayer) {
        m.stats.thrust *= m.ai.skill;
        m.stats.maxSpeed *= 0.86 + 0.12 * m.ai.skill;
      } else {
        // 玩家比 AI 稍強一點，靠操作就有機會從後面追上來
        const edge = [[17, 24.5], [15.5, 23], [13.5, 21.5]][difficulty];
        m.stats.thrust = edge[0]; m.stats.maxSpeed = edge[1];
      }
      this.marbles.push(m);
    }
    this.player = player ? this.marbles[0] : null;
    this._rank();
  }

  _makeAI() {
    const r = this.rand;
    return {
      skill: 0.8 + r() * 0.2, lane: (r() * 2 - 1) * 0.4, laneTarget: (r() * 2 - 1) * 0.4,
      look: 5 + r() * 4, nextLane: 2 + r() * 5, bravery: r(),
    };
  }

  _wall(i, thick, hh = WALL_H) {
    const t = this.track;
    const pos = trackPoint(t, i, 0, hh / 2);
    const q = trackQuat(t, i);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(q));
    return this.world.createCollider(rest(RAPIER.ColliderDesc.cuboid(t.half[i] + 1, hh, thick), 0.15), body);
  }

  start() {
    this.phase = 'race';
    if (this.gate) { this.world.removeCollider(this.gate, true); this.gate = null; }
    for (const m of this.marbles) m.body.wakeUp();
  }

  // ---- 每個物理步 ----
  step() {
    const dt = DT;
    this.time += dt;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.start(); this.events.push({ type: 'go' }); }
    }

    for (const c of this.crosses) {
      c.angle += c.speed * dt;
      _q.copy(c.base).multiply(_q2.setFromAxisAngle(_yAxis, c.angle));
      c.body.setNextKinematicRotation(_q);
    }
    for (const pt of this.pistons) {
      this._movePiston(pt, this.time);
      pt.body.setNextKinematicTranslation(trackPoint(this.track, pt.i, pt.lat, pt.top - pt.hh, _v));
    }

    this._catchup();
    for (const m of this.marbles) {
      if (!m.alive) continue;
      if (m.rescue) {
        this._rescue(m, dt);
        if (m.rescue?.held) continue;   // 被手抓著：不碰撞、不受控
      }
      this._sense(m);
      if (this.phase === 'race' && !m.finished && !this._inBowl(m)) {
        const ap = this._approach(m);
        if (ap) this._approachPush(m, ap, dt);
        else {
          // 彈珠台、夾彎裡完全交給重力（AI 的防側滑會把自己頂在釘子或牆上）
          const free = this.freeZones.some(z => m.s > z.s0 - 1 && m.s < z.s1);
          if (m.ai && !free) this._think(m, dt);
          if (!free) this._control(m, dt);
          else this._unstick(m, dt);
        }
      }
      this._water(m);
      this._funnelDamp(m);
      this._funnelSpin(m, dt);
    }

    this.world.step();

    this._clacks();
    this._funnelJam();
    for (const m of this.marbles) {
      if (!m.alive || m.rescue?.held) continue;
      this._impact(m);
      this._trackPos(m, dt);
    }
    if (this.phase === 'race') this._rules();
    this._rank();
  }

  // 撞擊事件（給畫面播音效用）：k＝力道 0～1，kind＝glass 彈珠互撞／land 落地／wall 撞牆，x y z＝撞擊點
  // 彈珠互撞：兩顆剛碰上的那一步才響一聲，力道看碰之前沿連心線的接近速度（疊著不動的不會一直響）
  _clacks() {
    const ms = this.marbles;
    for (let a = 0; a < ms.length; a++) {
      const A = ms[a];
      if (!A.alive || A.rescue?.held) continue;
      const p = A.body.translation();
      for (let b = a + 1; b < ms.length; b++) {
        const B = ms[b];
        if (!B.alive || B.rescue?.held) continue;
        const q = B.body.translation();
        const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, d = Math.hypot(dx, dy, dz), key = a * 1024 + b;
        if (d > 2 * RADIUS + 0.15) { this.touching.delete(key); continue; }
        if (d > 2 * RADIUS + 0.05 || this.touching.has(key)) continue;
        this.touching.add(key);
        const closing = ((A.pv.x - B.pv.x) * dx + (A.pv.y - B.pv.y) * dy + (A.pv.z - B.pv.z) * dz) / (d || 1);
        if (closing < 1.2) continue;
        A.hitCd = B.hitCd = 0.06;                   // 同一下不要再算成撞牆
        this.events.push({ type: 'hit', kind: 'glass', m: A, o: B, k: Math.min(1, Math.max(0.15, closing / 12)), x: p.x + dx / 2, y: p.y + dy / 2, z: p.z + dz / 2 });
      }
    }
  }

  // 撞牆、落地：這一步速度突然變很多（扣掉重力）；速度主要是往上變的＝落地，不然就是撞牆
  _impact(m) {
    const v = m.body.linvel(), pv = m.pv;
    const dx = v.x - pv.x, dy = v.y - pv.y + GRAVITY * DT, dz = v.z - pv.z, dv = Math.hypot(dx, dy, dz);
    pv.x = v.x; pv.y = v.y; pv.z = v.z;
    m.hitCd -= DT;
    // 衝刺是程式直接改速度，不算撞擊
    if (dv < 2.5 || m.hitCd > 0 || m.dashCd > 0.7) return;
    m.hitCd = 0.06;
    // 地板彈性 0.25：速度變化 ≈ 1.25 × 撞下去的速度；落地要撞得夠快才響
    const landing = dy > 0.6 * dv, k = landing ? (dv / 1.25 - 4) / 20 : (dv - 2) / 14;
    if (k < 0.05) return;
    const p = m.body.translation();
    this.events.push({ type: 'hit', kind: landing ? 'land' : 'wall', m, k: Math.min(1, k), x: p.x, y: p.y, z: p.z });
  }

  _sense(m) {
    const p = m.body.translation();
    this.ray.origin.x = p.x; this.ray.origin.y = p.y; this.ray.origin.z = p.z;
    const hit = this.world.castRay(this.ray, RADIUS + 0.22, true, undefined, undefined, m.collider);
    m.grounded = !!hit;
    m.dashCd -= DT;
  }

  _control(m, dt) {
    const b = m.body, st = m.stats, inp = m.input;
    const v = b.linvel();
    const mass = b.mass();
    let ix = inp.x, iz = inp.z;
    const mag = Math.min(1, Math.hypot(ix, iz));
    if (mag > 0.02) {
      const il = Math.hypot(ix, iz); ix /= il; iz /= il;
      const ctrl = m.grounded ? 1 : st.air;
      const along = v.x * ix + v.z * iz;
      let ax = 0, az = 0;
      const c = m.boost || 0;
      if (along < st.maxSpeed * (1 + c)) { ax += ix * st.thrust * (1 + CATCHUP.thrust * c) * mag; az += iz * st.thrust * (1 + CATCHUP.thrust * c) * mag; }
      // 抵銷側滑，讓轉向更聽話
      const px = v.x - along * ix, pz = v.z - along * iz;
      const pm = Math.hypot(px, pz);
      if (pm > 0.01 && mag > 0.3) {
        const c = Math.min(pm * 3, 7 * st.grip);
        ax -= px / pm * c; az -= pz / pm * c;
      }
      b.applyImpulse({ x: ax * ctrl * mass * dt, y: 0, z: az * ctrl * mass * dt }, true);
    }
    if (inp.dash) {
      inp.dash = false;
      if (st.dashes > 0 && m.dashCd <= 0) {
        let dx = ix, dz = iz;
        if (mag < 0.2) {
          const t = this.track.T[m.idx];
          dx = t.x; dz = t.z;
          const l = Math.hypot(dx, dz); dx /= l; dz /= l;
        }
        b.setLinvel({ x: v.x + dx * 13, y: v.y, z: v.z + dz * 13 }, true);
        st.dashes--; m.dashCd = 0.8;
        this.events.push({ type: 'dash', m });
      }
    }
  }

  // 每顆彈珠的追趕加成：看落後還在跑的最前面那顆多遠
  _catchup() {
    let lead = 0;
    for (const m of this.marbles) if (m.alive && !m.finished && m.maxS > lead) lead = m.maxS;
    for (const m of this.marbles) m.boost = Math.min(CATCHUP.max, (lead - m.maxS) * CATCHUP.per);
  }

  // 在漏斗的碗裡（比邊牆頂低）：不靠 AI，只靠重力和繞圈。還在上方入口滑槽上的不算
  _inBowl(m) {
    const f = m.funnel;
    return !!f && m.body.translation().y < f.yRim + f.wallH + 0.5;
  }

  // 正在漏斗入口前的滑槽上（含伸到漏斗上方那段）就回傳那個漏斗
  _approach(m) {
    if (m.funnel) return m.funnel;
    for (const f of this.track.funnels) if (f.coast && m.s > f.i0 * STEP - f.coast && m.s < f.i0 * STEP + 1) return f;
    return null;
  }

  // 入口滑槽上不用 AI，沿滑槽把速度調到 coastV：太快會飛出漏斗的牆外，
  // 太慢會卡在滑槽收窄的地方、擋住後面的（加速、減速最多 FUNNEL.push）。
  // 幾顆擠在收窄的地方互相頂住（拱）一動也不動：先放掉推力讓它鬆開，再彈起來換個位置，彈了還卡就彈重一點
  _approachPush(m, f, dt) {
    if (!f.coastV) return;
    const v = m.body.linvel(), t = this.track.T[f.i0], k = m.body.mass();
    if (Math.hypot(v.x, v.y, v.z) > 0.5) { m.stillTimer = 0; m.tapN = 0; }
    else m.stillTimer += dt;
    if (m.stillTimer < FUNNEL.check * 0.3) {
      const a = Math.max(-FUNNEL.push, Math.min(FUNNEL.push, (f.coastV - (v.x * t.x + v.z * t.z)) * 4));
      m.body.applyImpulse({ x: t.x * a * k * dt, y: 0, z: t.z * a * k * dt }, true);
    }
    if (m.stillTimer < FUNNEL.check) return;
    m.stillTimer = 0;
    const power = Math.min(FUNNEL.tapMax, 1 + FUNNEL.tapGrow * m.tapN++), ang = this.rand() * Math.PI * 2;
    m.body.applyImpulse({ x: Math.cos(ang) * FUNNEL.tapSide * power * k, y: FUNNEL.tapUp * power * k, z: Math.sin(ang) * FUNNEL.tapSide * power * k }, true);
  }

  // 彈珠台裡沒有 AI：停在釘子正後方不動時，往旁邊隨機推一下
  _unstick(m, dt) {
    const v = m.body.linvel();
    if (Math.hypot(v.x, v.y, v.z) > 0.5) { m.stillTimer = 0; return; }
    m.stillTimer += dt;
    if (m.stillTimer < 0.8) return;
    m.stillTimer = 0;
    const t = this.track, tv = t.T[m.idx], rv = t.R[m.idx], k = m.body.mass();
    const side = (this.rand() < 0.5 ? -1 : 1) * 3 * k;
    m.body.applyImpulse({ x: rv.x * side + tv.x * k, y: 0, z: rv.z * side + tv.z * k }, true);
  }

  // 水底隧道：兩側水道裡阻尼加大、浮力減輕重力（入口漸變）；中間乾道不受影響；漏斗裡的略過
  // m.wet＝泡在水裡（畫面冒氣泡用）
  _water(m) {
    const z = this.waterZone;
    if (!z || m.funnel) return;
    const inZone = m.s > z.s0 && m.s < z.s1 ? Math.min(1, (m.s - z.s0) / WATER.ease) : 0;
    const dv = z.dividers[0], ds = m.s - dv.i0 * STEP;
    const k = Math.abs(m.lat) > dividerLat(ds, dv.len) ? inZone : 0;
    if (!k && !m.wetK) return;
    m.wetK = k;
    m.wet = k > 0.5;
    m.body.setLinearDamping(BASE_DAMP + (WATER.damp - BASE_DAMP) * k);
    if (k) m.body.applyImpulse({ x: 0, y: m.body.mass() * GRAVITY * WATER.buoy * k * DT, z: 0 }, true);
  }

  // 洞口塞住（兩顆跨在洞口互相頂住的拱）：洞口附近擠了 2 顆以上，而且一陣子沒有彈珠掉出去，
  // 就像敲一下漏斗——洞口附近的彈珠各自被往上、往旁邊彈一下，拱就散了
  _funnelJam() {
    const t = this.track;
    for (let k = 0; k < t.funnels.length; k++) {
      const f = t.funnels[k], near = [];
      for (const m of this.marbles) {
        if (m.funnel !== f || m.rescue) continue;
        const p = m.body.translation();
        // 已經掉到洞口平面以下的不敲（敲了會被甩到錐面底下飛出去）
        if (Math.hypot(p.x - f.c[0], p.z - f.c[1]) < FUNNEL.mouth && p.y > f.yHole + 0.2 && p.y < f.yHole + 2) near.push(m);
      }
      if (near.length < 2) { this.fPass[k] = this.time; this.fTaps[k] = 0; continue; }
      if (this.time - this.fPass[k] < FUNNEL.jam) continue;
      this.fPass[k] = this.time - FUNNEL.jam + 0.6;
      const power = Math.min(FUNNEL.tapMax, 1 + FUNNEL.tapGrow * this.fTaps[k]++);   // 敲了還塞著就敲重一點
      for (const m of near) {
        const a = this.rand() * Math.PI * 2, s = FUNNEL.tapSide * power, w = m.body.mass();
        m.body.applyImpulse({ x: Math.cos(a) * s * w, y: FUNNEL.tapUp * power * w, z: Math.sin(a) * s * w }, true);
      }
    }
  }

  // 漏斗裡的阻尼：進了碗裡就換成漏斗的（離洞口 0.35 倍半徑內再加 dampIn，越靠近洞口越多），出來恢復。
  // 還在上方入口滑槽上的不算，不然在滑槽末端會慢到停住，擋住後面的
  _funnelDamp(m) {
    let d = BASE_DAMP;
    if (this._inBowl(m)) {
      const f = m.funnel, p = m.body.translation();
      d = f.damp + f.dampIn * (1 - Math.min(1, Math.hypot(p.x - f.c[0], p.z - f.c[1]) / (f.R * 0.35)));
    }
    if (d === m.damp) return;
    m.damp = d;
    m.body.setLinearDamping(d);
  }

  // 繞圈助力：前 f.laps 圈沿著從入口半徑收到 f.inner 的螺旋走——切線速度補到「該在的半徑」的繞圈速度
  // （太外面就給慢一點讓它往內掉，太裡面就快一點甩出去），再抵銷徑向的晃動；繞滿了放手，自己掉進洞。
  // 離開碗面（被撞飛、跳起來）時不推，所以被撞亂的那幾下就少繞了
  _funnelSpin(m, dt) {
    const f = m.funnel;
    if (!f?.laps || !this._inBowl(m)) return;
    const p = m.body.translation(), dx = p.x - f.c[0], dz = p.z - f.c[1], r = Math.hypot(dx, dz) || 1e-3;
    const a = Math.atan2(dz, dx);
    if (m.fAng == null) { m.fAng = a; m.fR0 = r; return; }
    let d = a - m.fAng;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    m.fAng = a;
    const v = m.body.linvel(), ux = dx / r, uz = dz / r;
    let tx = -uz, tz = ux, vt = v.x * tx + v.z * tz;
    // 繞的方向看剛進來時往哪邊滾
    if (!m.fDir) { if (Math.abs(vt) < 1) return; m.fDir = Math.sign(vt); }
    tx *= m.fDir; tz *= m.fDir; vt *= m.fDir;
    m.fLaps += Math.max(0, d * m.fDir) / (2 * Math.PI);
    if (m.fLaps >= f.laps || !m.grounded) return;
    // 前面收得快、後面慢：大部分圈數在靠近洞口的小圈繞（小圈一圈很快）
    const u = 1 - m.fLaps / f.laps, want = f.inner + (m.fR0 - f.inner) * u * u * u;
    // 半徑 r 的繞圈速度：v²/r ＝ 重力 × 坡度
    const rr = Math.min(f.R - 0.1, Math.max(FUNNEL_HOLE + 0.1, r));
    const slope = f.depth * (funnelDepth(rr - 0.05, f.R, f.soft, f.lin) - funnelDepth(rr + 0.05, f.R, f.soft, f.lin)) / 0.1;
    const target = Math.sqrt(GRAVITY * r * Math.max(0.02, slope)) * Math.min(1.2, Math.max(0.35, 1 + FUNNEL.spinPull * (want - r) / r));
    const lim = FUNNEL.spinAcc * dt, vr = v.x * ux + v.z * uz;
    const dt_ = Math.max(-lim, Math.min(lim, (target - vt) * 3 * dt));
    // 只擋「離開螺旋」的徑向速度，往螺旋靠的讓它自己滑
    const dr = vr * (r - want) > 0 ? Math.max(-lim, Math.min(lim, -vr * FUNNEL.spinDamp * dt)) : 0;
    const k = m.body.mass();
    m.body.applyImpulse({ x: (tx * dt_ + ux * dr) * k, y: 0, z: (tz * dt_ + uz * dr) * k }, true);
  }

  // 積木頂面 = base + 0～lift，用 1-cos 讓升降平滑
  _movePiston(pt, t) {
    const a = PISTON.omega * t - pt.phase;
    pt.top = pt.base + PISTON.lift * (0.5 - 0.5 * Math.cos(a));
  }

  _think(m, dt) {
    const ai = m.ai, t = this.track, inp = m.input;
    const p = m.body.translation(), v = m.body.linvel();
    const speed = Math.hypot(v.x, v.z);

    ai.nextLane -= dt;
    if (ai.nextLane <= 0) { ai.laneTarget = (this.rand() * 2 - 1) * 0.45; ai.nextLane = 2 + this.rand() * 5; }

    ai.lane += (ai.laneTarget - ai.lane) * Math.min(1, dt * 2.5);

    const li = Math.min(t.N - 1, m.idx + Math.round((ai.look + speed * 0.3) / STEP));
    trackPoint(t, li, ai.lane * t.half[li], 0, _v);
    let dx = _v.x - p.x, dz = _v.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    inp.x = dx / l; inp.z = dz / l;

    // 卡住超過 1.5 秒：沿賽道輕推一下（不會跳）
    if (speed < 2) {
      m.stillTimer += dt;
      if (m.stillTimer > 1.5) {
        m.stillTimer = 0;
        // 換一條車道（不然 AI 會一直把自己頂在釘子上），再往前、往旁邊推一下
        ai.laneTarget = (this.rand() * 2 - 1) * 0.45; ai.nextLane = 2;
        const tv = t.T[m.idx], rv = t.R[m.idx], k = 6 * m.body.mass(), side = (this.rand() < 0.5 ? -1 : 1) * 3 * m.body.mass();
        m.body.applyImpulse({ x: tv.x * k + rv.x * side, y: 0, z: tv.z * k + rv.z * side }, true);
      }
    } else m.stillTimer = 0;

    if (m.stats.dashes > 0 && m.dashCd <= 0 && m.grounded && this.rand() < 0.0015 * (0.5 + ai.bravery)) inp.dash = true;
  }

  _trackPos(m, dt) {
    const t = this.track;
    const p = m.body.translation();
    if (this._inFunnel(m, p)) return;
    let best = m.idx, bd = Infinity;
    // 不要往回找到斷開的另一段（漏斗洞口上下）
    const lo = Math.max(0, m.idx - 20, t.segStart[m.idx]), hi = Math.min(t.N - 1, m.idx + 40);
    for (let i = lo; i <= hi; i++) {
      const q = t.P[i];
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    m.idx = best;
    const q = t.P[best];
    _v.set(p.x - q.x, p.y - q.y, p.z - q.z);
    m.s = best * STEP + _v.dot(t.T[best]);
    m.lat = _v.dot(t.R[best]);
    m.h = _v.dot(t.U[best]);
    if (m.s > m.maxS) m.maxS = m.s;

    const hw = t.half[best];
    const off = Math.abs(m.lat) > hw + 2.5 || m.h < -3.5 || m.h > 30;
    if (off) m.offTimer += dt;
    else {
      m.offTimer = 0;
      if (m.grounded && t.floor[best] && Math.abs(m.lat) < hw && m.h < t.wallH[best]) m.safeIdx = best;
    }
    if (m.offTimer > 0.6 || m.h < -15) this._startRescue(m);
  }

  // 在漏斗裡：不靠 AI，只靠重力和邊緣繞圈；進度用「離洞口多近」來算（入口滑槽伸到漏斗上方的那段也算在裡面）
  _inFunnel(m, p) {
    const t = this.track;
    for (let k = 0; k < t.funnels.length; k++) {
      const f = t.funnels[k];
      // 已經滑到這個漏斗的入口末端才算（連續小漏斗時，上一個漏斗的出口就在下一個的正上方）
      if (m.funnel !== f && (m.idx < f.i0 - 2 || m.idx > f.i1)) continue;
      const r = Math.hypot(p.x - f.c[0], p.z - f.c[1]);
      if (r < f.R + 0.5 && p.y > f.yHole - 1.2 && p.y < f.yRim + f.wallH + 3) {
        if (m.funnel !== f) { m.funnel = f; m.funnelT = 0; m.fRef = null; m.fLaps = 0; m.fAng = null; m.fDir = 0; }
        m.funnelT += DT;
        const frac = Math.min(1, Math.max(0, (f.R - r) / (f.R - FUNNEL_HOLE)));
        m.idx = Math.max(m.idx, f.i0 + Math.round(frac * (f.i1 - f.i0)));
        m.s = m.idx * STEP; m.lat = 0; m.h = 0;
        if (m.s > m.maxS) m.maxS = m.s;
        m.offTimer = 0;
        if (this._inBowl(m)) this._funnelUnstick(m, f, p, r);
        return true;
      }
      if (m.funnel === f && p.y <= f.yHole - 1.2) {
        // 從洞口掉下去了：接到出口賽道
        m.funnel = null;
        this.fPass[k] = this.time; this.fTaps[k] = 0;
        m.idx = f.exitI + Math.round(2 / STEP);
        return false;
      }
    }
    m.funnel = null;
    return false;
  }

  // 漏斗裡卡住：每 FUNNEL.check 秒看一次，這段時間幾乎沒移動、速度又很小（速度忽快忽慢重不了這個判斷），
  // 就往洞口的方向推一下：往內加順著繞圈的切線方向，再往下一點，不會把彈珠推出漏斗；推了還不動就推重一點
  _funnelUnstick(m, f, p, r) {
    const ref = m.fRef;
    if (!ref) { m.fRef = { x: p.x, y: p.y, z: p.z, t: m.funnelT, n: 0 }; return; }
    if (m.funnelT - ref.t < FUNNEL.check) return;
    const v = m.body.linvel(), moved = Math.hypot(p.x - ref.x, p.y - ref.y, p.z - ref.z);
    ref.x = p.x; ref.y = p.y; ref.z = p.z; ref.t = m.funnelT;
    if (moved > 0.5 || Math.hypot(v.x, v.y, v.z) > 1.5) { ref.n = 0; return; }
    const k = m.body.mass() * Math.min(FUNNEL.tapMax, 1 + FUNNEL.tapGrow * ref.n++), ix = (f.c[0] - p.x) / (r || 1), iz = (f.c[1] - p.z) / (r || 1);
    const spin = (-iz * v.x + ix * v.z) >= 0 ? 1 : -1;   // 沿著原本繞的方向
    m.body.applyImpulse({ x: (ix * 2 - iz * spin * 1.5) * k, y: -k, z: (iz * 2 + ix * spin * 1.5) * k }, true);
  }

  // 出界：選好放回的位置，彈珠停用物理交給手（m.rescue）。x y z＝手與彈珠此刻的位置，sway＝晃動幅度 0～1，
  // open＝手指張開 0～1，vis＝手的大小 0～1，held＝彈珠還在手上（false＝已放手、手正在收回）
  _startRescue(m) {
    const t = this.track;
    let i = Math.max(1, m.safeIdx - 8);
    while (i > 1 && !t.floor[i]) i--;
    const tv = t.T[i];
    const r = m.rescue = { t: 0, held: true, relT: 0, i, tx: tv.x, tz: tv.z, bx: 0, by: 0, bz: 0, x: 0, y: 0, z: 0, sway: 1, open: 0, vis: 0 };
    this._rescuePlace(r, (this.rand() * 2 - 1) * 0.3 * t.half[i]);
    r.x = r.bx; r.y = r.by + RESCUE.height; r.z = r.bz;
    m.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    m.body.setEnabled(false);
    m.body.setTranslation({ x: r.x, y: r.y, z: r.z }, true);
    m.idx = i; m.safeIdx = i; m.offTimer = 0; m.funnel = null; m.stillTimer = 0;
    m.s = i * STEP; m.lat = r.lat; m.h = 0;
    this.events.push({ type: 'rescue', m });
  }

  // 放下的位置：跑道橫向 lat 處、彈珠剛好離地 RESCUE.drop
  _rescuePlace(r, lat) {
    const t = this.track, i = r.i;
    const p = trackPoint(t, i, lat, floorHeightAt(lat, t.half[i], t.rise[i]) + RADIUS + RESCUE.drop, _v);
    r.lat = lat; r.bx = p.x; r.by = p.y; r.bz = p.z;
  }

  // 落點附近有沒有別的彈珠（或另一隻手也要放在這）
  _spotFree(r, m) {
    for (const o of this.marbles) {
      if (o === m || !o.alive) continue;
      if (o.rescue?.held) {
        if (o.id < m.id && Math.hypot(o.rescue.bx - r.bx, o.rescue.bz - r.bz) < 2 * RADIUS + 0.4) return false;
        continue;
      }
      const p = o.body.translation();
      if (Math.hypot(p.x - r.bx, p.y - r.by, p.z - r.bz) < 2 * RADIUS + 0.3) return false;
    }
    return true;
  }

  // 被擋住就左右錯開一點
  _shiftSpot(r, m) {
    const lim = 0.8 * this.track.half[r.i], lat0 = r.lat;
    for (const d of [0.9, -0.9, 1.8, -1.8]) {
      const lat = lat0 + d;
      if (Math.abs(lat) > lim) continue;
      this._rescuePlace(r, lat);
      if (this._spotFree(r, m)) return;
    }
    this._rescuePlace(r, lat0);
  }

  _rescue(m, dt) {
    const r = m.rescue, K = RESCUE, tDrop = K.wait + K.down + K.hold;
    r.t += dt;
    if (!r.held) {
      // 放手後：手張開、慢慢往上收，最後縮小消失
      const u = Math.min(1, (r.t - r.relT) / K.up);
      r.open = Math.min(1, (r.t - r.relT) / 0.15);
      r.y = r.by + K.height * u * u;
      r.sway = u;
      r.vis = u < 0.75 ? 1 : 1 - smooth((u - 0.75) / 0.25);
      if (u >= 1) m.rescue = null;
      return;
    }
    if (r.t >= K.wait && !this._spotFree(r, m)) this._shiftSpot(r, m);
    // 等 → 降下（手離地面的高度 h 由 height 緩降到 0）→ 停住
    const h = r.t < K.wait ? K.height : K.height * (1 - smooth(Math.min(1, (r.t - K.wait) / K.down)));
    r.vis = r.t < K.wait ? popIn(r.t / K.wait) : 1;
    r.sway = h / K.height;
    const sw = r.sway * 0.25;
    const k = Math.min(1, dt * 10);
    r.x += (r.bx + Math.sin(r.t * 5) * sw - r.x) * k;
    r.z += (r.bz + Math.cos(r.t * 4) * sw - r.z) * k;
    r.y = r.by + h;
    m.body.setTranslation({ x: r.x, y: r.y, z: r.z }, true);
    if (r.t < tDrop) return;
    if (r.t < tDrop + K.holdMax && (Math.hypot(r.x - r.bx, r.z - r.bz) > 0.08 || !this._spotFree(r, m))) return;
    this._release(m, r);
  }

  // 放手：彈珠恢復物理，給沿賽道的小速度；手留在原地準備收回
  _release(m, r) {
    const tv = this.track.T[r.i], sp = RESCUE.speed;
    r.held = false; r.relT = r.t;
    r.x = r.bx; r.y = r.by; r.z = r.bz;
    m.body.setEnabled(true);
    m.body.setTranslation({ x: r.bx, y: r.by, z: r.bz }, true);
    m.body.setLinvel({ x: tv.x * sp, y: tv.y * sp, z: tv.z * sp }, true);
    m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    m.pv.x = tv.x * sp; m.pv.y = tv.y * sp; m.pv.z = tv.z * sp;
    m.hitCd = 0.1;                 // 直接設的速度不算撞擊
    m.respawns++;
    this.events.push({ type: 'respawn', m });
  }

  _rules() {
    for (const m of this.marbles) {
      if (!m.alive || m.finished || m.rescue?.held) continue;
      while (m.cp < this.cps.length && m.maxS >= this.cps[m.cp].s) {
        const cp = this.cps[m.cp];
        if (cp.closed) break;
        cp.passed.push(m);
        this.events.push({ type: 'cp', m, k: m.cp, place: cp.passed.length, keep: cp.keep });
        if (m.ai) this.applyUpgrade(m, UPGRADES[Math.floor(this.rand() * UPGRADES.length)].id);
        m.cp++;
        if (cp.passed.length >= cp.keep) this._closeCp(this.cps.indexOf(cp));
      }
      if (m.cp === this.cps.length && m.maxS >= this.finishS) {
        m.finished = true;
        this.finishOrder.push(m);
        m.place = this.finishOrder.length;
        m.finishTime = this.time;
        this.events.push({ type: 'finish', m, place: m.place });
      }
    }
  }

  // 名額滿了：還沒通過這個檢查點的彈珠全部淘汰
  _closeCp(k) {
    const cp = this.cps[k];
    if (cp.closed) return;
    cp.closed = true;
    const out = this.marbles.filter(m => m.alive && m.cp <= k);
    for (const m of out) this.eliminate(m);
    this.events.push({ type: 'elim', k, list: out });
  }

  eliminate(m) {
    m.alive = false;
    m.rescue = null;
    m.elimT = this.time;
    m.elimPos = { ...m.body.translation() };
    m.body.setEnabled(false);
    this.elimOrder.push(m);
  }

  applyUpgrade(m, id) {
    const u = UPGRADES.find(x => x.id === id);
    if (!u) return;
    u.apply(m.stats);
    m.upgrades.push(u);
    if (id === 'heavy') m.collider.setDensity(m.stats.mass);
  }

  drawCards(n = 3) {
    const pool = UPGRADES.slice();
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    return out;
  }

  _rank() {
    const alive = this.marbles.filter(m => m.alive && !m.finished).sort((a, b) => b.maxS - a.maxS);
    const list = [...this.finishOrder, ...alive, ...this.elimOrder.slice().reverse()];
    list.forEach((m, k) => { m.rank = k + 1; });
    this.ranking = list;
  }

  aliveCount() { return this.marbles.reduce((n, m) => n + (m.alive ? 1 : 0), 0); }
  currentCp() { return this.cps.findIndex(c => !c.closed); }
}

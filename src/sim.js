// 物理世界 + 比賽規則 + AI（不含畫面，可在 Node 裡跑無頭模擬）
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { STEP, trackPoint, trackQuat, mulberry32, floorHeightAt, WALL_H, FUNNEL_HOLE, FUNNEL_LANE } from './track.js';

export const RADIUS = 0.5;
export const GRAVITY = 30;
export const DT = 1 / 60;

// 跳跳積木：lift 升起高度、omega 升降速度、hop 往上彈、kick 往前推、maxSpeed 超過就不再推
// 升起高度要比彈珠半徑低，彈珠才滾得過去，不會像撞牆
export const PISTON = { size: 0.95, lift: 0.32, omega: 5, hop: 4, kick: 14, maxSpeed: 34 };
export const PEG_R = 0.28;
// 金色積木：亮著的時候被它彈到，就飛過 U 字內側直接落到回程直線
// period 閃爍週期、litFrac 一個週期裡亮多久、time 飛行秒數、land 落地後的最低速度
export const GOLD = { period: 1.6, litFrac: 0.6, time: 1.8, land: 18 };
export function goldLit(pt, t) { return ((t / GOLD.period + pt.row * 0.37) % 1) < GOLD.litFrac; }

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

    const world = this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    world.timestep = DT;

    // 軌道
    for (const c of track.colliders) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      world.createCollider(
        RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
          .setFriction(0.7).setRestitution(0.2), body);
    }
    // 起點與終點的擋板
    this._wall(track.startI + 1, 0.5);
    this._wall(track.endI - 1, 0.5);
    this.gate = this._wall(track.gateI, 0.3);
    // 漏斗洞口下方的出口賽道後面加一道擋板，接住掉下來的彈珠
    for (const f of track.funnels) this._wall(f.exitI, 0.4);

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
        world.createCollider(RAPIER.ColliderDesc.cylinder(1.6, 0.45).setTranslation(0, 1.6, 0), body);
        world.createCollider(RAPIER.ColliderDesc.cuboid(hl, 0.25, 0.25).setTranslation(0, 0.95, 0).setRestitution(0.8), body);
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.25, hl).setTranslation(0, 0.95, 0).setRestitution(0.8), body);
        this.crosses.push({ ...c, body, base: base.clone(), halfLen: hl });
      }
      // 跳跳積木：藏在地板下，輪流升起把彈珠往上往前彈
      for (const pc of z.pistons) {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setRotation(trackQuat(track, pc.i)));
        world.createCollider(RAPIER.ColliderDesc.roundCuboid(PISTON.size - 0.2, PISTON.size - 0.2, PISTON.size - 0.2, 0.2).setFriction(0.6).setRestitution(0.4), body);
        const base = floorHeightAt(Math.max(0, Math.abs(pc.lat) - PISTON.size), track.half[pc.i]) - 0.06;
        const pt = { ...pc, s: pc.i * STEP, body, base, phase: pc.row * 0.9 + (pc.col % 2) * Math.PI, top: base, vel: 0 };
        this._movePiston(pt, 0);
        body.setTranslation(trackPoint(track, pt.i, pt.lat, pt.top - PISTON.size), true);
        this.pistons.push(pt);
      }
      // 彈珠台：一根根固定的釘子
      for (const pg of z.pegs) {
        const pos = trackPoint(track, pg.i, pg.lat, floorHeightAt(pg.lat, track.half[pg.i]) + 1.1);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(trackQuat(track, pg.i)));
        world.createCollider(RAPIER.ColliderDesc.cylinder(1.3, PEG_R).setFriction(0.2).setRestitution(0.45), body);
      }
    }
    this.pistonZone = track.zones.find(z => z.type === 'piston');
    // 彈珠台、夾彎裡沒有 AI，只靠重力（夾彎裡 AI 會一直往彎道牆上撞）
    this.freeZones = track.zones.filter(z => z.type === 'pegs' || z.type === 'zigzag');

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
      const fh = floorHeightAt(lat, track.half[i]);
      const p = trackPoint(track, i, lat, fh + RADIUS + 0.05);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z)
        .setCcdEnabled(true).setLinearDamping(0.12).setAngularDamping(0.4));
      const collider = world.createCollider(RAPIER.ColliderDesc.ball(RADIUS).setDensity(1).setFriction(0.8).setRestitution(0.3), body);
      const isPlayer = player && n === 0;
      const m = {
        id: n, isPlayer, name: isPlayer ? '你' : names[n % names.length],
        color: isPlayer && playerColor != null ? playerColor : palette ? palette[n % palette.length] : PALETTE[(n * 7) % PALETTE.length],
        pattern: n % 6,
        body, collider, alive: true, finished: false, place: 0,
        row: r, idx: i, s, lat, h: 0, maxS: s, cp: 0, safeIdx: i, offTimer: 0, respawns: 0,
        grounded: false, dashCd: 0, hopCd: 0, stillTimer: 0, flight: null, funnel: null, shortcuts: 0,
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

  _wall(i, thick) {
    const t = this.track;
    const pos = trackPoint(t, i, 0, WALL_H / 2);
    const q = trackQuat(t, i);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(q));
    return this.world.createCollider(RAPIER.ColliderDesc.cuboid(t.half[i] + 1, WALL_H, thick), body);
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
      pt.body.setNextKinematicTranslation(trackPoint(this.track, pt.i, pt.lat, pt.top - PISTON.size, _v));
    }

    for (const m of this.marbles) {
      if (!m.alive) continue;
      this._sense(m);
      if (this.phase === 'race' && !m.finished && !m.flight && !m.funnel) {
        // 彈珠台、夾彎裡完全交給重力（AI 的防側滑會把自己頂在釘子或牆上）
        const free = this.freeZones.some(z => m.s > z.s0 - 1 && m.s < z.s1);
        if (m.ai && !free) this._think(m, dt);
        if (!free) this._control(m, dt);
        else this._unstick(m, dt);
        this._pistonBoost(m);
      }
    }

    this.world.step();

    for (const m of this.marbles) {
      if (!m.alive) continue;
      this._trackPos(m, dt);
    }
    if (this.phase === 'race') this._rules();
    this._rank();
  }

  _sense(m) {
    const p = m.body.translation();
    this.ray.origin.x = p.x; this.ray.origin.y = p.y; this.ray.origin.z = p.z;
    const hit = this.world.castRay(this.ray, RADIUS + 0.22, true, undefined, undefined, m.collider);
    m.grounded = !!hit;
    m.dashCd -= DT; m.hopCd -= DT;
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
      if (along < st.maxSpeed) { ax += ix * st.thrust * mag; az += iz * st.thrust * mag; }
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

  // 積木頂面 = base + 0～lift，用 1-cos 讓升降平滑
  _movePiston(pt, t) {
    const a = PISTON.omega * t - pt.phase;
    pt.top = pt.base + PISTON.lift * (0.5 - 0.5 * Math.cos(a));
    pt.vel = PISTON.lift * 0.5 * PISTON.omega * Math.sin(a);
  }

  // 碰到正在升起的積木：彈起來並往前推一把
  _pistonBoost(m) {
    const z = this.pistonZone;
    if (!z || m.s < z.s0 || m.s > z.s1) return;
    let best = null, bd = Infinity;
    for (const pt of this.pistons) {
      const d = Math.abs(pt.s - m.s) + Math.abs(pt.lat - m.lat);
      if (d < bd) { bd = d; best = pt; }
    }
    if (!best || Math.abs(best.s - m.s) > PISTON.size || Math.abs(best.lat - m.lat) > PISTON.size) return;
    if (best.vel <= 0 || m.h - RADIUS > best.top + 0.4 || m.hopCd > 0) return;
    if (best.gold && goldLit(best, this.time)) { this._launch(m, best); return; }
    m.hopCd = 0.15;
    const v = m.body.linvel(), tv = this.track.T[m.idx], uv = this.track.U[m.idx];
    const kick = v.x * tv.x + v.y * tv.y + v.z * tv.z < PISTON.maxSpeed ? PISTON.kick : 0;
    m.body.setLinvel({
      x: v.x + tv.x * kick + uv.x * PISTON.hop,
      y: v.y + tv.y * kick + uv.y * PISTON.hop,
      z: v.z + tv.z * kick + uv.z * PISTON.hop,
    }, true);
    this.events.push({ type: 'hop', m });
  }

  // 抄近路：算好拋物線，GOLD.time 秒後剛好落在回程直線上
  _launch(m, pt) {
    const T = GOLD.time, from = m.body.translation();
    const to = trackPoint(this.track, pt.land, 0, RADIUS + 0.1, _v);
    m.body.setLinearDamping(0);              // 沒有空氣阻力，拋物線才準
    m.body.setLinvel({
      x: (to.x - from.x) / T,
      y: (to.y - from.y) / T + 0.5 * GRAVITY * T,
      z: (to.z - from.z) / T,
    }, true);
    m.flight = { landT: this.time + T, land: pt.land };
    m.shortcuts++;
    this.events.push({ type: 'shortcut', m });
  }

  // 落地：接回賽道位置，順著賽道方向繼續滾
  _land(m) {
    const t = this.track, i = m.flight.land;
    m.flight = null;
    m.idx = i; m.safeIdx = i; m.offTimer = 0;
    m.body.setLinearDamping(0.12);
    const v = m.body.linvel(), tv = t.T[i];
    const sp = Math.max(GOLD.land, Math.hypot(v.x, v.z) * 0.7);
    m.body.setLinvel({ x: tv.x * sp, y: tv.y * sp, z: tv.z * sp }, true);
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
    if (m.flight) {
      if (this.time < m.flight.landT) return;   // 飛行中不判定出界
      this._land(m);
    }
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
      if (m.grounded && t.floor[best] && Math.abs(m.lat) < hw && m.h < WALL_H) m.safeIdx = best;
    }
    if (m.offTimer > 0.6 || m.h < -15) this.respawn(m);
  }

  // 在漏斗裡：不靠 AI，只靠重力和邊緣繞圈；進度用「離洞口多近」來算
  _inFunnel(m, p) {
    const t = this.track;
    for (const f of t.funnels) {
      if (m.idx < f.i0 - 10 || m.idx > f.i1) continue;
      const r = Math.hypot(p.x - f.c[0], p.z - f.c[1]);
      if (r < f.R + 0.5 && p.y > f.yHole - 1.2 && p.y < f.yRim + 6) {
        if (!m.funnel && r > f.R - FUNNEL_LANE * 2 - 0.5 && m.idx < f.i0) return false;   // 還在入口賽道上
        m.funnel = f;
        const frac = Math.min(1, Math.max(0, (f.R - r) / (f.R - FUNNEL_HOLE)));
        m.idx = Math.max(m.idx, f.i0 + Math.round(frac * (f.i1 - f.i0)));
        m.s = m.idx * STEP; m.lat = 0; m.h = 0;
        if (m.s > m.maxS) m.maxS = m.s;
        m.offTimer = 0;
        // 卡在洞口附近不動（被別顆壓住）：往中間、往下輕輕推一下
        const v = m.body.linvel();
        if (Math.hypot(v.x, v.y, v.z) < 0.4) {
          m.stillTimer += DT;
          if (m.stillTimer > 0.8) {
            m.stillTimer = 0;
            const k = m.body.mass() * 1.5, dx = (f.c[0] - p.x) / (r || 1), dz = (f.c[1] - p.z) / (r || 1);
            m.body.applyImpulse({ x: dx * k + (this.rand() - 0.5) * k, y: -k, z: dz * k + (this.rand() - 0.5) * k }, true);
          }
        } else m.stillTimer = 0;
        return true;
      }
      if (m.funnel === f && p.y <= f.yHole - 1.2) {
        // 從洞口掉下去了：接到出口賽道
        m.funnel = null;
        m.idx = f.exitI + Math.round(2 / STEP);
        return false;
      }
    }
    m.funnel = null;
    return false;
  }

  respawn(m) {
    const t = this.track;
    let i = Math.max(1, m.safeIdx - 8);
    while (i > 1 && !t.floor[i]) i--;
    const lat = (this.rand() * 2 - 1) * 0.3 * t.half[i];
    const p = trackPoint(t, i, lat, floorHeightAt(lat, t.half[i]) + RADIUS + 1.0);
    m.body.setTranslation(p, true);
    const tv = t.T[i];
    m.body.setLinvel({ x: tv.x * 7, y: tv.y * 7, z: tv.z * 7 }, true);
    m.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    m.idx = i; m.safeIdx = i; m.offTimer = 0; m.respawns++;
    this.events.push({ type: 'respawn', m });
  }

  _rules() {
    for (const m of this.marbles) {
      if (!m.alive || m.finished) continue;
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

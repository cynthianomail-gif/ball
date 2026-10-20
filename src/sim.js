// 物理世界 + 比賽規則 + AI（不含畫面，可在 Node 裡跑無頭模擬）
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { STEP, trackPoint, trackQuat, mulberry32, floorHeightAt, WALL_H } from './track.js';

export const RADIUS = 0.5;
export const GRAVITY = 30;
export const DT = 1 / 60;

export async function initPhysics() { await RAPIER.init(); }

export const UPGRADES = [
  { id: 'engine', icon: '🚀', name: '渦輪引擎', desc: '推進力 +25%', apply: s => { s.thrust *= 1.25; } },
  { id: 'speed', icon: '💨', name: '流線外殼', desc: '極速 +12%', apply: s => { s.maxSpeed *= 1.12; } },
  { id: 'spring', icon: '🦘', name: '彈簧底座', desc: '跳躍力 +25%', apply: s => { s.jump *= 1.25; } },
  { id: 'dash', icon: '⚡', name: '閃電衝刺', desc: '衝刺次數 +2', apply: s => { s.dashes += 2; } },
  { id: 'heavy', icon: '🪨', name: '鉛芯彈珠', desc: '重量 +60%，撞人更痛', apply: s => { s.mass *= 1.6; } },
  { id: 'air', icon: '🪂', name: '空中操控', desc: '空中轉向 +80%', apply: s => { s.air = Math.min(1, s.air * 1.8); } },
  { id: 'double', icon: '🌀', name: '二段跳', desc: '空中可以再跳一次', apply: s => { s.airJumps += 1; } },
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
  return { thrust: 13, maxSpeed: 21, jump: 11, dashes: 1, mass: 1, air: 0.35, airJumps: 0, grip: 1 };
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

export class Race {
  constructor(track, { count = 50, seed = 1, playerColor = null, autopilot = false, difficulty = 1 } = {}) {
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

    // 積木障礙
    for (const o of track.obstacles) {
      const fh = floorHeightAt(o.lat, track.half[o.i]);
      const pos = trackPoint(track, o.i, o.lat, fh + o.size / 2 - 0.15);
      const q = trackQuat(track, o.i).multiply(_q2.setFromAxisAngle(_yAxis, o.rot));
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(q));
      world.createCollider(RAPIER.ColliderDesc.cuboid(o.size / 2, o.size / 2, o.size / 2).setFriction(0.4).setRestitution(0.5), body);
      o.pos = pos; o.quat = q.clone();
    }
    // 旋轉橫桿
    this.sweepers = track.sweepers.map(sw => {
      const pos = trackPoint(track, sw.i, 0, 0);
      const base = trackQuat(track, sw.i);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z).setRotation(base));
      const hl = track.half[sw.i] - 1.0;
      world.createCollider(RAPIER.ColliderDesc.cylinder(1.6, 0.45).setTranslation(0, 1.6, 0), body);
      world.createCollider(RAPIER.ColliderDesc.cuboid(hl, 0.25, 0.25).setTranslation(0, 0.95, 0).setRestitution(0.8), body);
      return { ...sw, body, base: base.clone(), angle: this.rand() * Math.PI, halfLen: hl, pos };
    });

    // 檢查點：每過一個淘汰 20%
    this.cps = track.checkpoints.map((i, k) => ({
      i, s: i * STEP, keep: count - Math.round(count * 0.2 * (k + 1)), passed: [], closed: false,
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
    const playerSlot = slots.findIndex(([r, c]) => r === pr && c === pc);
    const others = slots.filter((_, k) => k !== playerSlot);
    for (let k = others.length - 1; k > 0; k--) { const j = Math.floor(this.rand() * (k + 1)); [others[k], others[j]] = [others[j], others[k]]; }
    const order = [slots[playerSlot], ...others];

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
      const isPlayer = n === 0;
      const m = {
        id: n, isPlayer, name: isPlayer ? '你' : names[n % names.length],
        color: isPlayer && playerColor != null ? playerColor : PALETTE[(n * 7) % PALETTE.length],
        pattern: n % 6,
        body, collider, alive: true, finished: false, place: 0,
        idx: i, s, lat, h: 0, maxS: s, cp: 0, safeIdx: i, offTimer: 0, respawns: 0,
        grounded: false, jumpCd: 0, dashCd: 0, airJumpsLeft: 0, stillTimer: 0,
        stats: baseStats(), upgrades: [], elimT: 0, rank: n + 1,
        input: { x: 0, z: 0, jump: false, dash: false },
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
    this.player = this.marbles[0];
  }

  _makeAI() {
    const r = this.rand;
    return {
      skill: 0.8 + r() * 0.2, lane: (r() * 2 - 1) * 0.4, laneTarget: (r() * 2 - 1) * 0.4,
      look: 5 + r() * 4, nextLane: 2 + r() * 5, nextJump: 3 + r() * 8, bravery: r(),
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

    for (const sw of this.sweepers) {
      sw.angle += sw.speed * dt;
      _q.copy(sw.base).multiply(_q2.setFromAxisAngle(_yAxis, sw.angle));
      sw.body.setNextKinematicRotation(_q);
    }

    for (const m of this.marbles) {
      if (!m.alive) continue;
      this._sense(m);
      if (this.phase === 'race' && !m.finished) {
        if (m.ai) this._think(m, dt);
        this._control(m, dt);
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
    if (m.grounded) m.airJumpsLeft = m.stats.airJumps;
    m.jumpCd -= DT; m.dashCd -= DT;
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
    if (inp.jump) {
      inp.jump = false;
      if (m.jumpCd <= 0 && (m.grounded || m.airJumpsLeft > 0)) {
        if (!m.grounded) m.airJumpsLeft--;
        b.setLinvel({ x: v.x, y: Math.max(v.y, 0) + st.jump, z: v.z }, true);
        m.jumpCd = 0.3;
        this.events.push({ type: 'jump', m });
      }
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
        b.setLinvel({ x: v.x + dx * 13, y: Math.max(v.y, 0) + 2, z: v.z + dz * 13 }, true);
        st.dashes--; m.dashCd = 0.8;
        this.events.push({ type: 'dash', m });
      }
    }
  }

  _think(m, dt) {
    const ai = m.ai, t = this.track, inp = m.input;
    const p = m.body.translation(), v = m.body.linvel();
    const speed = Math.hypot(v.x, v.z);

    ai.nextLane -= dt;
    if (ai.nextLane <= 0) { ai.laneTarget = (this.rand() * 2 - 1) * 0.45; ai.nextLane = 2 + this.rand() * 5; }

    // 前方積木：換車道或跳
    let wantJump = false;
    const ahead = m.idx + Math.round(26 / STEP);
    for (const o of t.obstacles) {
      if (o.i < m.idx - 2 || o.i > ahead) continue;
      const hw = t.half[o.i];
      const myLat = ai.laneTarget * hw;
      const clear = o.size / 2 + 1.3;
      if (Math.abs(myLat - o.lat) < clear) {
        // 往另一側閃
        const left = o.lat - clear - 0.3, right = o.lat + clear + 0.3;
        const lOk = left > -hw + 1, rOk = right < hw - 1;
        if (lOk && (!rOk || Math.abs(left - m.lat) < Math.abs(right - m.lat))) ai.laneTarget = left / hw;
        else if (rOk) ai.laneTarget = right / hw;
      }
      const dist = (o.i - m.idx) * STEP;
      if (dist > 0 && dist < 2.2 + speed * 0.12 && Math.abs(m.lat - o.lat) < o.size / 2 + 0.6) wantJump = true;
    }
    for (const sw of this.sweepers) {
      const dist = (sw.i - m.idx) * STEP;
      if (dist > 0 && dist < 3 + speed * 0.1 && this.rand() < 0.08 * ai.skill) wantJump = true;
    }
    ai.lane += (ai.laneTarget - ai.lane) * Math.min(1, dt * 2.5);

    const li = Math.min(t.N - 1, m.idx + Math.round((ai.look + speed * 0.3) / STEP));
    trackPoint(t, li, ai.lane * t.half[li], 0, _v);
    let dx = _v.x - p.x, dz = _v.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    inp.x = dx / l; inp.z = dz / l;

    ai.nextJump -= dt;
    if (ai.nextJump <= 0) { wantJump = true; ai.nextJump = 4 + this.rand() * 10; }
    if (speed < 2) { m.stillTimer += dt; if (m.stillTimer > 1.5) { wantJump = true; m.stillTimer = 0; } }
    else m.stillTimer = 0;
    if (wantJump && m.grounded) inp.jump = true;

    if (m.stats.dashes > 0 && m.dashCd <= 0 && m.grounded && this.rand() < 0.0015 * (0.5 + ai.bravery)) inp.dash = true;
  }

  _trackPos(m, dt) {
    const t = this.track;
    const p = m.body.translation();
    let best = m.idx, bd = Infinity;
    const lo = Math.max(0, m.idx - 20), hi = Math.min(t.N - 1, m.idx + 40);
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

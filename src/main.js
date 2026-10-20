import * as THREE from 'three';
import { buildTrack, STEP } from './track.js';
import { Race, initPhysics, DT, UPGRADES } from './sim.js';
import { View } from './render.js';
import * as sfx from './sound.js';

const $ = id => document.getElementById(id);
const COLORS = [0xffd400, 0xe63946, 0x1d7af3, 0x2ec27e, 0x9b5de5, 0xff6fb5, 0x00b4d8, 0xff7b00, 0x222222, 0xffffff];
let playerColor = COLORS[0];

await initPhysics();
const track = buildTrack();
const view = new View($('game'), track);
$('loading').remove();

let race = null;
let acc = 0, last = performance.now();
let timeScale = 1;
let cardState = null;     // { cards, until }
let over = false;
let msgTimer = 0;
let respawnCd = 0;
let hudTimer = 0;
let lastCount = 0;

// ---------- 選單 ----------
for (const c of COLORS) {
  const d = document.createElement('div');
  d.className = 'cl' + (c === playerColor ? ' sel' : '');
  d.style.background = '#' + c.toString(16).padStart(6, '0');
  d.onclick = () => { playerColor = c; document.querySelectorAll('.cl').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); };
  $('colors').appendChild(d);
}
if (view.mobile) $('count').value = '30';
$('startBtn').onclick = () => { sfx.unlock(); newRace(); };
$('againBtn').onclick = () => newRace();
$('watchBtn').onclick = () => $('result').classList.add('hidden');

function newRace() {
  if (race) race.world.free();
  race = new Race(track, { count: Number($('count').value), seed: (Math.random() * 1e9) | 0, playerColor, difficulty: Number($('diff').value) });
  view.setRace(race);
  over = false; cardState = null; timeScale = 1; acc = 0;
  $('menu').classList.add('hidden');
  $('result').classList.add('hidden');
  $('cards').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (view.mobile) $('touch').classList.remove('hidden');
  buildProgress();
  lastCount = 4;
}

// ---------- 鍵盤 ----------
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!race) return;
  if (e.repeat) return;
  const inp = race.player.input;
  if (e.code === 'Space') { inp.jump = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') inp.dash = true;
  if (e.code === 'KeyC') view.camMode = (view.camMode + 1) % 3;
  if (e.code === 'KeyR') manualRespawn();
  if (cardState && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) pickCard(Number(e.code.at(-1)) - 1);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// 滑鼠拖曳轉視角
let dragX = null;
$('game').addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') { dragX = e.clientX; view.dragging = true; } });
addEventListener('pointermove', e => { if (dragX !== null) { view.yawOffset -= (e.clientX - dragX) * 0.006; dragX = e.clientX; } });
addEventListener('pointerup', () => { dragX = null; view.dragging = false; });

// ---------- 觸控 ----------
const stick = { id: null, x: 0, y: 0, cx: 0, cy: 0 };
const zone = $('stickZone'), base = $('stickBase'), knob = $('stickKnob');
zone.addEventListener('pointerdown', e => {
  stick.id = e.pointerId; zone.setPointerCapture(e.pointerId);
  const r = zone.getBoundingClientRect();
  stick.cx = e.clientX; stick.cy = e.clientY;
  base.style.left = (e.clientX - r.left - 65) + 'px';
  base.style.top = (e.clientY - r.top - 65) + 'px'; base.style.bottom = 'auto';
});
zone.addEventListener('pointermove', e => {
  if (e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.cx, dy = e.clientY - stick.cy;
  const l = Math.hypot(dx, dy), max = 55;
  if (l > max) { dx *= max / l; dy *= max / l; }
  stick.x = dx / max; stick.y = dy / max;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
});
const endStick = e => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);
const tap = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
tap('btnJump', () => race && (race.player.input.jump = true));
tap('btnDash', () => race && (race.player.input.dash = true));
tap('btnCam', () => { view.camMode = (view.camMode + 1) % 3; });
tap('btnRespawn', () => manualRespawn());

function manualRespawn() {
  if (!race || !race.player.alive || race.player.finished || respawnCd > 0 || race.phase !== 'race') return;
  respawnCd = 3;
  race.respawn(race.player);
}

function playerInput() {
  const p = race.player;
  let f = 0, s = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyD || keys.ArrowRight) s += 1;
  if (keys.KeyA || keys.ArrowLeft) s -= 1;
  if (stick.id !== null) { f -= stick.y; s += stick.x; }
  const fwd = view.viewFwd || new THREE.Vector3(1, 0, 0);
  const rx = -fwd.z, rz = fwd.x; // 右手方向
  let x = fwd.x * f + rx * s, z = fwd.z * f + rz * s;
  const l = Math.hypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  p.input.x = x; p.input.z = z;
}

// ---------- 升級卡 ----------
function openCards() {
  const cards = race.drawCards(3);
  cardState = { cards, until: performance.now() + 7000 };
  timeScale = 0.3;
  const list = $('cardList');
  list.innerHTML = '';
  cards.forEach((c, k) => {
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `<div class="ic">${c.icon}</div><div class="nm">${c.name}</div><div class="ds">${c.desc}</div><div class="key">按 ${k + 1}</div>`;
    d.addEventListener('pointerdown', e => { e.stopPropagation(); pickCard(k); });
    list.appendChild(d);
  });
  $('cards').classList.remove('hidden');
}
function pickCard(k) {
  if (!cardState) return;
  const c = cardState.cards[k];
  race.applyUpgrade(race.player, c.id);
  closeCards();
  showMsg(c.icon, c.name, 1.2);
  sfx.chime();
}
function closeCards() {
  cardState = null; timeScale = 1;
  $('cards').classList.add('hidden');
}

// ---------- 訊息 ----------
function showMsg(big, small = '', dur = 1.4) {
  $('msg').textContent = big; $('sub').textContent = small;
  $('msg').classList.add('show'); $('sub').classList.toggle('show', !!small);
  msgTimer = dur;
}

function endGame(win) {
  over = true;
  closeCards();
  const p = race.player;
  setTimeout(() => {
    $('result').classList.remove('hidden');
    $('watchBtn').classList.toggle('hidden', p.finished);
    if (p.finished) {
      $('resTitle').textContent = p.place === 1 ? '🏆 冠軍！' : `第 ${p.place} 名完賽！`;
      $('resText').textContent = `${race.count} 顆彈珠中，你撐到最後並在 ${p.finishTime.toFixed(1)} 秒衝過終點。重生 ${p.respawns} 次。`;
    } else {
      const k = race.cps.findIndex(c => c.closed && !c.passed.includes(p));
      $('resTitle').textContent = '💥 被淘汰了';
      $('resText').textContent = `你在檢查點 ${k + 1} 被淘汰，最終排名第 ${p.rank} 名。再試一次吧！`;
    }
  }, win ? 1200 : 1600);
}

function handleEvents() {
  for (const e of race.events) {
    switch (e.type) {
      case 'go': showMsg('GO!', '', 0.9); sfx.beep(880, 0.35); break;
      case 'cp':
        if (e.m.isPlayer) {
          showMsg('晉級！', `第 ${e.place} 個通過檢查點 ${e.k + 1}`, 1.3);
          sfx.chime();
          if (!over) openCards();
        }
        break;
      case 'elim': {
        const me = e.list.includes(race.player);
        if (!over || !me) showMsg(`淘汰 ${e.list.length} 顆！`, `檢查點 ${e.k + 1} 關閉，剩 ${race.aliveCount()} 顆`, 1.6);
        sfx.pop();
        if (me && !over) endGame(false);
        break;
      }
      case 'finish':
        if (e.m.isPlayer) { showMsg(e.place === 1 ? '🏆 第 1 名！' : `第 ${e.place} 名！`, '', 2); sfx.fanfare(); endGame(true); }
        else if (e.place === 1 && !race.player.finished) showMsg('', `${e.m.name} 拿下第一名！`, 1.5);
        break;
      case 'jump': if (e.m.isPlayer) sfx.boing(); break;
      case 'dash': if (e.m.isPlayer) sfx.whoosh(); break;
      case 'respawn': if (e.m.isPlayer) showMsg('', '回到賽道', 0.8); break;
    }
  }
  race.events.length = 0;
}

// ---------- 進度條 & 排行 ----------
const dotEls = [];
function buildProgress() {
  const bar = $('progress'), dots = $('dots');
  bar.querySelectorAll('.tick').forEach(t => t.remove());
  dots.innerHTML = ''; dotEls.length = 0;
  const L = race.finishS;
  race.cps.forEach(cp => { const t = document.createElement('div'); t.className = 'tick'; t.style.left = (cp.s / L * 100) + '%'; bar.appendChild(t); cp.tickEl = t; });
  const f = document.createElement('div'); f.className = 'tick finish'; f.style.left = '100%'; bar.appendChild(f);
  for (const m of race.marbles) {
    const d = document.createElement('div');
    d.className = 'dot' + (m.isPlayer ? ' me' : '');
    d.style.background = '#' + m.color.toString(16).padStart(6, '0');
    dots.appendChild(d); dotEls.push(d);
  }
}

function updateHud() {
  const p = race.player, L = race.finishS;
  race.marbles.forEach((m, k) => {
    const d = dotEls[k];
    d.style.display = m.alive ? '' : 'none';
    d.style.left = Math.min(100, Math.max(0, m.maxS / L * 100)) + '%';
  });
  hudTimer -= 1;
  if (hudTimer > 0) return;
  hudTimer = 6;
  $('rank').textContent = `第 ${p.rank} 名`;
  $('alive').textContent = `存活 ${race.aliveCount()} / ${race.count}`;
  const ci = race.currentCp();
  const info = $('cpInfo');
  info.classList.remove('danger');
  if (race.phase === 'countdown') info.textContent = '準備起跑…';
  else if (ci >= 0) {
    const cp = race.cps[ci];
    const left = cp.keep - cp.passed.length;
    let txt = `檢查點 ${ci + 1}：剩 ${left} 個晉級名額`;
    if (p.alive && p.cp <= ci) {
      const behind = race.marbles.filter(m => m.alive && m.cp <= ci).sort((a, b) => b.maxS - a.maxS);
      const pos = behind.indexOf(p) + 1;
      if (pos > left) { txt = `⚠ 危險！檢查點 ${ci + 1} 只剩 ${left} 個名額`; info.classList.add('danger'); }
    }
    info.textContent = txt;
  } else info.textContent = '最後衝刺！搶第一名！';
  race.cps.forEach(cp => cp.tickEl.classList.toggle('done', cp.closed));

  const board = $('board');
  const top = race.ranking.slice(0, 5);
  if (!top.includes(p)) top.push(p);
  board.innerHTML = top.map(m => `<li class="${m.isPlayer ? 'me' : ''}"><span class="n">${m.rank}</span><span class="sw" style="background:#${m.color.toString(16).padStart(6, '0')}"></span>${m.name}${m.finished ? ' 🏁' : !m.alive ? ' ✖' : ''}</li>`).join('');

  const st = p.stats;
  const ab = [`⚡ 衝刺 ×${st.dashes}`];
  for (const u of p.upgrades) ab.push(`${u.icon} ${u.name}`);
  $('abilities').innerHTML = ab.map(a => `<div class="ab">${a}</div>`).join('');
}

// ---------- 主迴圈 ----------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (!race) { renderIdle(dt); return; }

  if (cardState && now > cardState.until) pickCard(Math.floor(Math.random() * 3));
  if (cardState) $('cardTimer').textContent = Math.ceil((cardState.until - now) / 1000) + 's';
  respawnCd -= dt;

  // 倒數音效
  if (race.phase === 'countdown') {
    const c = Math.ceil(race.countdown);
    if (c !== lastCount && c <= 3 && c >= 1) { lastCount = c; showMsg(String(c), '', 0.8); sfx.beep(440, 0.15); }
  }

  acc += dt * timeScale;
  let n = 0;
  while (acc >= DT && n < 5) {
    view.snapshot();
    if (race.player.alive && !race.player.finished) playerInput();
    race.step();
    handleEvents();
    acc -= DT; n++;
  }
  if (n === 5) acc = 0;
  view.render(acc / DT, dt);
  updateHud();

  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) { $('msg').classList.remove('show'); $('sub').classList.remove('show'); } }
}

// 選單背景：鏡頭沿著賽道慢慢飛
let idleS = 0;
function renderIdle(dt) {
  idleS = (idleS + dt * 18) % track.total;
  const i = Math.floor(idleS / STEP);
  const p = track.P[i], t = track.T[Math.min(track.N - 1, i + 20)];
  view.camera.position.set(p.x - t.x * 10 + 6, p.y + 7, p.z - t.z * 10 + 6);
  view.camera.lookAt(track.P[Math.min(track.N - 1, i + 30)]);
  view.sun.position.copy(p).add(view.sunOffset); view.sun.target.position.copy(p);
  view.renderer.render(view.scene, view.camera);
}

requestAnimationFrame(frame);

// 方便除錯
window.game = { get race() { return race; }, view, track, UPGRADES };

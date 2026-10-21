import { buildTrack, STEP } from './track.js';
import { Race, initPhysics, DT } from './sim.js';
import { View, CAM_MODES } from './render.js';
import { priceRace } from './odds.js';
import * as sfx from './sound.js';

const $ = id => document.getElementById(id);
const hex = c => '#' + c.toString(16).padStart(6, '0');
const CHIPS = [10, 50, 100, 500];
const START_COINS = 1000;
const SPEEDS = [1, 2, 3];
const TYPE_NAME = { win: '獨贏', top3: '前三' };

// 錢包存在瀏覽器裡（無痕模式存不了也照樣能玩）
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 忽略 */ } },
};
let coins = store.get('marbleDerby.coins', START_COINS);
let raceNo = store.get('marbleDerby.raceNo', 0);
const saveWallet = () => { store.set('marbleDerby.coins', coins); store.set('marbleDerby.raceNo', raceNo); };

await initPhysics();
const track = buildTrack();
const view = new View($('game'), track);
$('loading').remove();

let race = null;
let phase = 'betting';      // betting → racing → done
let bets = [];              // { id, type, amount, odds }
let chip = 50;
let speedK = 0;
let acc = 0, last = performance.now();
let msgTimer = 0, hudTimer = 0, lastCount = 0;
let settled = false;

// ---------- 下注 ----------
for (const c of CHIPS) {
  const b = document.createElement('button');
  b.className = 'chip' + (c === chip ? ' sel' : '');
  b.textContent = c;
  b.onclick = () => { chip = c; document.querySelectorAll('.chip').forEach(x => x.classList.toggle('sel', x === b)); };
  $('chips').appendChild(b);
}
$('count').onchange = () => setupRace();
$('clearBtn').onclick = () => { bets = []; refreshBets(); };
$('goBtn').onclick = () => { sfx.unlock(); startRace(); };
$('nextBtn').onclick = () => openBetting();
$('btnNext').onclick = () => openBetting();
$('watchBtn').onclick = () => { $('result').classList.add('hidden'); $('btnNext').classList.remove('hidden'); };

const staked = () => bets.reduce((n, b) => n + b.amount, 0);

function openBetting() {
  if (coins < CHIPS[0]) {
    coins = START_COINS;
    saveWallet();
    $('bankrupt').classList.remove('hidden');
  } else $('bankrupt').classList.add('hidden');
  raceNo++;
  saveWallet();
  setupRace();
}

function setupRace() {
  if (race) race.world.free();
  race = new Race(track, { count: Number($('count').value), seed: (Math.random() * 1e9) | 0, player: false });
  priceRace(race);
  view.setRace(race);
  view.setMarked([]);
  view.focusId = -1;
  view.camMode = 1;   // 下注時用俯瞰全景
  phase = 'betting'; bets = []; settled = false; acc = 0; lastCount = 4;
  $('tags').innerHTML = '';
  $('hud').classList.add('hidden');
  $('result').classList.add('hidden');
  $('btnNext').classList.add('hidden');
  $('bet').classList.remove('hidden');
  $('raceNo').textContent = `第 ${raceNo} 場`;
  buildField();
  refreshBets();
}

function buildField() {
  const field = $('field');
  field.innerHTML = '';
  const list = race.marbles.slice().sort((a, b) => b.winP - a.winP);
  for (const m of list) {
    const row = document.createElement('div');
    row.className = 'horse';
    row.innerHTML = `
      <span class="no">${m.id + 1}</span>
      <span class="ball" style="--c:${hex(m.color)}"></span>
      <div class="info"><div class="nm">${m.name}</div><div class="st">${'★'.repeat(m.stars)}${'☆'.repeat(5 - m.stars)} · 第 ${m.row + 1} 排</div></div>`;
    for (const type of ['win', 'top3']) {
      const b = document.createElement('button');
      b.className = 'ob';
      b.dataset.id = m.id; b.dataset.type = type;
      b.innerHTML = `${TYPE_NAME[type]}<b>×${m.odds[type].toFixed(1)}</b><i></i>`;
      b.onclick = () => addBet(m, type);
      row.appendChild(b);
    }
    field.appendChild(row);
  }
}

function addBet(m, type) {
  sfx.unlock();
  if (staked() + chip > coins) { flash($('coins').parentElement); return; }
  const b = bets.find(x => x.id === m.id && x.type === type);
  if (b) b.amount += chip;
  else bets.push({ id: m.id, type, amount: chip, odds: m.odds[type] });
  sfx.beep(660, 0.06);
  refreshBets();
}

function refreshBets() {
  $('coins').textContent = coins - staked();
  $('staked').textContent = staked();
  $('goBtn').textContent = bets.length ? '開賽！' : '不下注，直接看';
  for (const el of document.querySelectorAll('.ob')) {
    const b = bets.find(x => x.id === Number(el.dataset.id) && x.type === el.dataset.type);
    el.classList.toggle('on', !!b);
    el.querySelector('i').textContent = b ? b.amount : '';
  }
}

function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

function startRace() {
  coins -= staked();
  saveWallet();
  phase = 'racing';
  const ids = [...new Set(bets.map(b => b.id))];
  view.setMarked(ids);
  view.focusId = ids.length ? ids[0] : -1;
  view.camMode = 0;
  $('btnCam').textContent = '📷 ' + CAM_MODES[0].name;
  $('bet').classList.add('hidden');
  $('hud').classList.remove('hidden');
  buildTags(ids);
  buildProgress(ids);
  updateFocusBtn();
}

// ---------- 比賽中的操作 ----------
function cycleFocus() {
  const ids = [...new Set(bets.map(b => b.id)), -1];
  view.focusId = ids[(ids.indexOf(view.focusId) + 1) % ids.length];
  updateFocusBtn();
}
function updateFocusBtn() {
  $('btnFocus').textContent = '👁 ' + (view.focusId < 0 ? '領先者' : race.marbles[view.focusId].name);
}
function cycleSpeed() {
  speedK = (speedK + 1) % SPEEDS.length;
  $('btnSpeed').textContent = `⏩ ${SPEEDS[speedK]}x`;
}
$('btnFocus').onclick = cycleFocus;
function cycleCam() {
  view.camMode = (view.camMode + 1) % CAM_MODES.length;
  $('btnCam').textContent = '📷 ' + CAM_MODES[view.camMode].name;
}
$('btnCam').onclick = cycleCam;
$('btnSpeed').onclick = cycleSpeed;
addEventListener('keydown', e => {
  if (!race || phase === 'betting' || e.repeat) return;
  if (e.code === 'KeyC') cycleCam();
  if (e.code === 'KeyF') cycleFocus();
  if (e.code === 'Space') { cycleSpeed(); e.preventDefault(); }
});

// 滑鼠拖曳轉視角
let dragX = null;
$('game').addEventListener('pointerdown', e => { dragX = e.clientX; view.dragging = true; });
addEventListener('pointermove', e => { if (dragX !== null) { view.yawOffset -= (e.clientX - dragX) * 0.006; dragX = e.clientX; } });
addEventListener('pointerup', () => { dragX = null; view.dragging = false; });

// ---------- 訊息 ----------
function showMsg(big, small = '', dur = 1.4) {
  $('msg').textContent = big; $('sub').textContent = small;
  $('msg').classList.add('show'); $('sub').classList.toggle('show', !!small);
  msgTimer = dur;
}

const isMine = m => bets.some(b => b.id === m.id);

function handleEvents() {
  for (const e of race.events) {
    switch (e.type) {
      case 'go': showMsg('GO!', '', 0.9); sfx.beep(880, 0.35); break;
      case 'elim': {
        const mine = e.list.filter(isMine);
        if (mine.length) { showMsg('💥 出局', `你押的 ${mine.map(m => m.name).join('、')} 被淘汰了`, 1.8); sfx.pop(); }
        else showMsg(`淘汰 ${e.list.length} 顆！`, `檢查點 ${e.k + 1} 關閉，剩 ${race.aliveCount()} 顆`, 1.6);
        break;
      }
      case 'finish':
        if (e.place <= 3) {
          showMsg(e.place === 1 ? `🏆 ${e.m.name} 奪冠！` : `第 ${e.place} 名 ${e.m.name}`, '', 1.6);
          if (isMine(e.m)) sfx.chime();
        }
        break;
    }
  }
  race.events.length = 0;
}

// 比賽結束：該晉級的都過終點了，或拖太久
function checkSettle() {
  if (settled || race.phase !== 'race') return;
  const keep = race.cps.at(-1).keep;
  const stuck = race.time > 240 || !race.marbles.some(m => m.alive && !m.finished);
  if (race.finishOrder.length < keep && !stuck) return;
  settled = true;
  phase = 'done';

  let won = 0;
  const lines = bets.map(b => {
    const m = race.marbles[b.id];
    const hit = b.type === 'win' ? m.rank === 1 : m.rank <= 3;
    const pay = hit ? Math.floor(b.amount * b.odds) : 0;
    won += pay;
    return `<div class="${hit ? 'hit' : 'miss'}"><span class="sw" style="background:${hex(m.color)}"></span>${m.name}・${TYPE_NAME[b.type]} ${b.amount} ×${b.odds.toFixed(1)}<b>${hit ? '+' + pay : '✖'}</b></div>`;
  });
  coins += won;
  saveWallet();
  const net = won - staked();

  setTimeout(() => {
    $('resTitle').textContent = !bets.length ? '比賽結束' : net > 0 ? `🎉 贏了 ${net}！` : net === 0 ? '打平' : '😢 沒押中';
    $('podium').innerHTML = race.ranking.slice(0, 3).map(m =>
      `<li><span class="sw" style="background:${hex(m.color)}"></span>${m.id + 1} 號 ${m.name}<span class="dim">　獨贏 ×${m.odds.win.toFixed(1)}</span></li>`).join('');
    $('payout').innerHTML = lines.join('') + `<div class="wallet">💰 現在有 <b>${coins}</b></div>`;
    $('result').classList.remove('hidden');
    if (net > 0) sfx.fanfare(); else if (bets.length) sfx.pop();
  }, 1500);
}

// ---------- 名牌 & 進度條 & 排行 ----------
const tagEls = [];
function buildTags(ids) {
  const box = $('tags');
  box.innerHTML = ''; tagEls.length = 0;
  for (const id of ids) {
    const m = race.marbles[id];
    const d = document.createElement('div');
    d.className = 'tag';
    d.style.borderColor = hex(m.color);
    d.textContent = m.name;
    box.appendChild(d);
    tagEls.push({ m, d });
  }
}
function updateTags() {
  for (const { m, d } of tagEls) {
    const p = view.project(view.meshes[m.id].position.clone().setY(view.meshes[m.id].position.y + 2.4));
    const show = m.alive && p.visible;
    d.style.display = show ? '' : 'none';
    if (show) d.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
  }
}

const dotEls = [];
function buildProgress(ids) {
  const bar = $('progress'), dots = $('dots');
  bar.querySelectorAll('.tick').forEach(t => t.remove());
  dots.innerHTML = ''; dotEls.length = 0;
  const L = race.finishS;
  race.cps.forEach(cp => { const t = document.createElement('div'); t.className = 'tick'; t.style.left = (cp.s / L * 100) + '%'; bar.appendChild(t); cp.tickEl = t; });
  const f = document.createElement('div'); f.className = 'tick finish'; f.style.left = '100%'; bar.appendChild(f);
  for (const m of race.marbles) {
    const d = document.createElement('div');
    d.className = 'dot' + (ids.includes(m.id) ? ' me' : '');
    d.style.background = hex(m.color);
    dots.appendChild(d); dotEls.push(d);
  }
}

function updateHud() {
  const L = race.finishS;
  race.marbles.forEach((m, k) => {
    const d = dotEls[k];
    d.style.display = m.alive ? '' : 'none';
    d.style.left = Math.min(100, Math.max(0, m.maxS / L * 100)) + '%';
  });
  hudTimer -= 1;
  if (hudTimer > 0) return;
  hudTimer = 6;

  // 跟隨的彈珠被淘汰了就改跟領先者
  if (view.focusId >= 0 && !race.marbles[view.focusId].alive) { view.focusId = -1; updateFocusBtn(); }

  const ci = race.currentCp();
  if (race.phase === 'countdown') $('cpInfo').textContent = '準備起跑…';
  else if (ci >= 0) $('cpInfo').textContent = `檢查點 ${ci + 1}：剩 ${race.cps[ci].keep - race.cps[ci].passed.length} 個晉級名額`;
  else $('cpInfo').textContent = '最後衝刺！';
  race.cps.forEach(cp => cp.tickEl.classList.toggle('done', cp.closed));

  const status = m => m.finished ? `🏁 第 ${m.place} 名` : !m.alive ? '✖ 淘汰' : `第 ${m.rank} 名`;
  $('myBets').innerHTML = bets.length
    ? bets.map(b => { const m = race.marbles[b.id]; return `<div class="${!m.alive ? 'out' : ''}"><span class="sw" style="background:${hex(m.color)}"></span><b>${m.name}</b> ${TYPE_NAME[b.type]} ${b.amount}<span class="pos">${status(m)}</span></div>`; }).join('')
    : '<div class="dim">觀戰中（沒有下注）</div>';

  const top = race.ranking.slice(0, 5);
  for (const b of bets) { const m = race.marbles[b.id]; if (!top.includes(m)) top.push(m); }
  $('board').innerHTML = top.map(m => `<li class="${isMine(m) ? 'me' : ''}"><span class="n">${m.rank}</span><span class="sw" style="background:${hex(m.color)}"></span>${m.name}${m.finished ? ' 🏁' : !m.alive ? ' ✖' : ''}</li>`).join('');
}

// ---------- 主迴圈 ----------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;

  if (phase !== 'betting') {
    if (race.phase === 'countdown') {
      const c = Math.ceil(race.countdown);
      if (c !== lastCount && c <= 3 && c >= 1) { lastCount = c; showMsg(String(c), '', 0.8); sfx.beep(440, 0.15); }
    }
    acc += dt * SPEEDS[speedK];
    let n = 0;
    while (acc >= DT && n < 8) {
      view.snapshot();
      race.step();
      handleEvents();
      acc -= DT; n++;
    }
    if (n === 8) acc = 0;
    checkSettle();
  } else {
    // 下注時鏡頭在起跑線上方慢慢繞
    view.yawOffset = Math.sin(now / 4000) * 0.6;
  }
  view.render(phase === 'betting' ? 0 : acc / DT, dt);
  if (phase !== 'betting') { updateHud(); updateTags(); }

  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) { $('msg').classList.remove('show'); $('sub').classList.remove('show'); } }
}

openBetting();
requestAnimationFrame(frame);

// 方便除錯
window.game = { get race() { return race; }, view, track, STEP };

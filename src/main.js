import { buildTrack, STEP, ZONE_INFO } from './track.js';
import { Race, initPhysics, DT } from './sim.js';
import { View, CAM_MODES } from './render.js';
import { priceRace } from './odds.js';
import * as sfx from './sound.js';

const $ = id => document.getElementById(id);
const hex = c => '#' + c.toString(16).padStart(6, '0');
const CHIPS = [10, 50, 100, 500];
const START_COINS = 1000;
const SPEEDS = [1, 2, 3, 5];
const BASE_SPEED = 2;         // 「1x」實際是物理時間的 2 倍，比賽節奏才夠快
const MAX_STEPS = 24;         // 一幀最多跑幾步物理（5x＝10 倍物理時間，在 30fps 的手機上要 20 步）
const FIELD = 10;            // 每場 10 顆彈珠
// 10 種一眼分得出來的顏色：紅 橙 黃 綠 青 藍 紫 粉 棕 黑
const FIELD_COLORS = [0xe63946, 0xff7b00, 0xffd60a, 0x2ec27e, 0x00b4d8, 0x1d4ed8, 0x8b3fd9, 0xff6fb5, 0x8d5524, 0x2b2b2b];
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
  race = new Race(track, { count: FIELD, seed: (Math.random() * 1e9) | 0, player: false, palette: FIELD_COLORS });
  priceRace(race);
  view.setRace(race);
  view.setMarked([]);
  view.focusId = -1;
  view.camMode = 0;   // 預設俯瞰全景（下注畫面背景也是）
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
      <div class="info"><div class="nm">${m.name}</div></div>`;
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
  $('goBtn').textContent = bets.length ? '開賽！' : '直接看';
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
// 切換跟隨：先輪你押的彈珠，再來領先者，最後其他彈珠（依目前名次）
function cycleFocus() {
  const mine = [...new Set(bets.map(b => b.id))];
  const ids = [...mine, -1, ...race.ranking.map(m => m.id).filter(id => !mine.includes(id))];
  setFocus(ids[(ids.indexOf(view.focusId) + 1) % ids.length]);
}
function setFocus(id) {
  view.focusId = id;
  updateFocusBtn();
  hudTimer = 0;
}
function updateFocusBtn() {
  $('btnFocus').textContent = '👁 ' + (view.focusId < 0 ? '領先者' : race.marbles[view.focusId].name);
}
function cycleSpeed() {
  speedK = (speedK + 1) % SPEEDS.length;
  $('btnSpeed').textContent = `⏩ ${SPEEDS[speedK]}x`;
}
$('btnFocus').onclick = cycleFocus;
// 點排行榜上的名字就跟隨那顆彈珠，再點一次回到領先者
$('board').addEventListener('pointerdown', e => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const id = Number(li.dataset.id);
  setFocus(view.focusId === id ? -1 : id);
});
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
      case 'hop': if (e.m.id === view.focusMarble().id) sfx.boing(); break;
      case 'hit': hits.push(e); break;
      case 'shortcut':
        showMsg('⚡ 抄近路！', `${e.m.name} 被金色積木彈飛了`, 1.8);
        if (isMine(e.m) || e.m.id === view.focusId) sfx.fanfare(); else sfx.whoosh();
        break;
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

// 撞擊聲：離鏡頭跟隨的彈珠越遠越小聲，畫面外又離得遠的不播；每幀只挑最響的 3 個（同時太多會糊成一團）
// 左右聲像看撞擊點在鏡頭的左邊還右邊。碰撞不晃鏡頭，只有跟隨的彈珠重重落地時輕晃一下
const hits = [];
function playHits() {
  if (!hits.length) return;
  const fm = view.focusMarble(), f = fm.body.translation(), cam = view.camera.position, rx = view.camera.matrixWorld.elements;
  const list = [];
  for (const e of hits) {
    const mine = e.m === fm || e.o === fm;
    const d = Math.hypot(e.x - f.x, e.y - f.y, e.z - f.z);
    if (!mine && d > 22) continue;
    if (!mine && d > 3.5) {
      const s = view.project(e);
      if (!s.visible || s.x < -0.03 * innerWidth || s.x > 1.03 * innerWidth || s.y < -0.03 * innerHeight || s.y > 1.03 * innerHeight) continue;
    }
    const dc = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z);
    list.push({
      e, mine,
      v: mine ? Math.min(1, e.k * 1.25) : e.k * Math.pow(1 - d / 22, 1.6),
      pan: ((e.x - cam.x) * rx[0] + (e.y - cam.y) * rx[1] + (e.z - cam.z) * rx[2]) / Math.max(4, dc),
    });
  }
  hits.length = 0;
  list.sort((a, b) => b.v - a.v);
  for (const h of list.slice(0, 3)) {
    if (h.e.kind === 'glass') sfx.clack(h.v, h.pan);
    else if (h.e.kind === 'wall') sfx.knock(h.v, h.pan);
    else {
      sfx.land(h.v, h.pan);
      if (h.mine && h.v > 0.6) view.shakeAmt = Math.max(view.shakeAmt, 0.15);
    }
  }
}

// 前三名都過終點就結算（拖太久就照目前名次算）
function checkSettle() {
  if (settled || race.phase !== 'race') return;
  if (race.finishOrder.length < 3 && race.time < 240) return;
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
    $('resTitle').textContent = !bets.length ? '比賽結束' : net > 0 ? `🎉 贏了 ${net}！` : net === 0 ? '打平' : won > 0 ? `有中，但輸 ${-net}` : '😢 沒押中';
    $('podium').innerHTML = race.ranking.slice(0, 3).map(m =>
      `<li><span class="sw" style="background:${hex(m.color)}"></span>${m.id + 1} 號 ${m.name}<span class="dim">　獨贏 ×${m.odds.win.toFixed(1)}</span></li>`).join('');
    $('payout').innerHTML = lines.join('') + `<div class="wallet">💰 現在有 <b>${coins}</b></div>`;
    $('result').classList.remove('hidden');
    if (net > 0) sfx.fanfare(); else if (bets.length) sfx.pop();
  }, 1500);
}

// ---------- 名牌 & 進度條 & 排行 ----------
const tagEls = [];
let focusTag = null;        // 跟隨中、但沒下注的彈珠也給一個名牌
function buildTags(ids) {
  const box = $('tags');
  box.innerHTML = ''; tagEls.length = 0;
  focusTag = { m: null, d: document.createElement('div') };
  focusTag.d.className = 'tag watch';
  box.appendChild(focusTag.d);
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
  const fm = view.focusId >= 0 && !isMine(race.marbles[view.focusId]) ? race.marbles[view.focusId] : null;
  if (focusTag.m !== fm) {
    focusTag.m = fm;
    if (fm) { focusTag.d.textContent = '👁 ' + fm.name; focusTag.d.style.borderColor = hex(fm.color); }
  }
  for (const { m, d } of [...tagEls, focusTag]) {
    if (!m) { d.style.display = 'none'; continue; }
    const p = view.project(view.meshes[m.id].position, 2.4);
    d.style.display = p.visible ? '' : 'none';
    if (p.visible) d.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
  }
}

const dotEls = [];
let barW = 0;
addEventListener('resize', () => { barW = 0; });
function buildProgress(ids) {
  const bar = $('progress'), dots = $('dots');
  bar.querySelectorAll('.tick').forEach(t => t.remove());
  dots.innerHTML = ''; dotEls.length = 0;
  const L = race.finishS;
  for (const z of track.zones) {
    const t = document.createElement('div');
    t.className = 'tick zone ' + z.type;
    t.style.left = (z.s0 / L * 100) + '%'; t.style.width = ((z.s1 - z.s0) / L * 100) + '%';
    t.textContent = ZONE_INFO[z.type].icon;
    bar.appendChild(t);
  }
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
  if (!barW) barW = $('progress').clientWidth;
  race.marbles.forEach((m, k) => {
    dotEls[k].style.transform = `translateX(${(Math.min(1, Math.max(0, m.maxS / L)) * barW).toFixed(1)}px)`;
  });
  hudTimer -= 1;
  if (hudTimer > 0) return;
  hudTimer = 6;

  // 鏡頭跟的彈珠在哪一關
  const fm = view.focusMarble();
  const zi = fm.funnel ? track.zones.findIndex(z => z.funnels?.includes(fm.funnel)) : fm.tower ? track.zones.findIndex(z => z.tower === fm.tower) : track.zones.findIndex(z => fm.maxS < z.s1);
  const z = track.zones[zi];
  setHtml('cpInfo', race.phase === 'countdown' ? '準備起跑…'
    : fm.finished ? `${fm.name} 已抵達終點`
    : !z ? '最後衝刺！'
    : `${fm.maxS >= z.s0 ? '正在通過' : '下一關'}：${ZONE_INFO[z.type].icon} ${ZONE_INFO[z.type].name}`);

  const status = m => m.finished ? `🏁 第 ${m.place} 名` : `第 ${m.rank} 名`;
  setHtml('myBets', bets.length
    ? bets.map(b => { const m = race.marbles[b.id]; return `<div><span class="sw" style="background:${hex(m.color)}"></span><b>${m.name}</b> ${TYPE_NAME[b.type]} ${b.amount}<span class="pos">${status(m)}</span></div>`; }).join('')
    : '<div class="dim">觀戰中（沒有下注）<br>點右邊的名字可以跟隨</div>');

  // 沒下注時列出全部彈珠，方便點名字切換視角
  const top = race.ranking.slice(0, bets.length ? 5 : race.count);
  const extra = [...bets.map(b => b.id), view.focusId].filter(id => id >= 0).map(id => race.marbles[id]);
  for (const m of extra) if (!top.includes(m)) top.push(m);
  setHtml('board', top.map(m => {
    const cls = [isMine(m) && 'me', m.id === view.focusId && 'focus'].filter(Boolean).join(' ');
    return `<li data-id="${m.id}" class="${cls}"><span class="n">${m.rank}</span><span class="sw" style="background:${hex(m.color)}"></span>${m.name}${m.finished ? ' 🏁' : ''}${m.id === view.focusId ? ' 👁' : ''}</li>`;
  }).join(''));
}

// 內容沒變就不要重設 innerHTML，省掉手機上的重新排版
const htmlCache = {};
function setHtml(id, html) {
  if (htmlCache[id] === html) return;
  htmlCache[id] = html;
  $(id).innerHTML = html;
}

// 網址加上 ?fps 會在左下角顯示每秒幾格，方便看手機順不順
const showFps = new URLSearchParams(location.search).has('fps');
let fpsTimer = 0;
if (showFps) $('fps').classList.remove('hidden');

// ---------- 主迴圈 ----------
function frame(now) {
  requestAnimationFrame(frame);
  view.adaptQuality((now - last) / 1000);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;

  if (phase !== 'betting') {
    if (race.phase === 'countdown') {
      const c = Math.ceil(race.countdown);
      if (c !== lastCount && c <= 3 && c >= 1) { lastCount = c; showMsg(String(c), '', 0.8); sfx.beep(440, 0.15); }
    }
    // 倒數照正常速度，開跑後才加速
    const mult = race.phase === 'countdown' ? 1 : BASE_SPEED * SPEEDS[speedK];
    acc += dt * mult;
    let n = 0;
    while (acc >= DT && n < MAX_STEPS) {
      view.snapshot();
      race.step();
      handleEvents();
      acc -= DT; n++;
    }
    if (n === MAX_STEPS) acc = 0;
    playHits();
    checkSettle();
  } else {
    // 下注時鏡頭在起跑線上方慢慢繞
    view.yawOffset = Math.sin(now / 4000) * 0.6;
  }
  // 鏡頭平滑也照比賽時間走，快轉時鏡頭才跟得上
  view.render(phase === 'betting' ? 0 : acc / DT, phase === 'betting' || race.phase === 'countdown' ? dt : dt * BASE_SPEED * SPEEDS[speedK]);
  if (phase !== 'betting') { updateHud(); updateTags(); }
  // 滾動聲跟著鏡頭跟隨的彈珠
  const fm = phase === 'betting' ? null : view.focusMarble();
  if (fm) { const v = fm.body.linvel(); sfx.roll(Math.hypot(v.x, v.y, v.z), fm.grounded && !fm.flight && race.phase === 'race'); }
  else sfx.roll(0, false);

  if (showFps && (fpsTimer -= dt) < 0) {
    fpsTimer = 0.5;
    const q = view.quality;
    $('fps').textContent = `${q.fps.toFixed(0)} fps · ${q.pr.toFixed(2)}x${view.renderer.shadowMap.enabled ? '' : ' · 無陰影'}`;
  }
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) { $('msg').classList.remove('show'); $('sub').classList.remove('show'); } }
}

openBetting();
requestAnimationFrame(frame);

// 方便除錯
window.game = { get race() { return race; }, view, track, STEP };

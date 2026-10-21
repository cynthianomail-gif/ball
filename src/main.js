import { buildTrack, STEP } from './track.js';
import { Race, initPhysics, DT, MARBLE_REST } from './sim.js';
import { View, CAM_MODES } from './render.js';
import { priceRace } from './odds.js';
import * as sfx from './sound.js';

const $ = id => document.getElementById(id);
const hex = c => '#' + c.toString(16).padStart(6, '0');
const CHIPS = [10, 50, 100, 500];
const START_COINS = 1000;
const SPEEDS = [1, 2, 3, 5, 10];
const MAX_STEPS = 40;         // 一幀最多跑幾步物理：10x × 面板最高 4 倍＝40 倍，60fps 剛好跑得滿；手機跑不到就自然變慢，不追趕
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

// ---------- 調整面板 ----------
// base＝「1x」實際是物理時間的幾倍（預設 2，比賽節奏才夠快）；rest＝彈珠互撞的彈性
const TUNE_DEF = { base: 2, rest: MARBLE_REST };
const TUNE_LIM = { base: [0.5, 4], rest: [0.1, 1] };
const tuneVal = (k, v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return TUNE_DEF[k];
  return Math.min(TUNE_LIM[k][1], Math.max(TUNE_LIM[k][0], v));
};
const tune = { base: tuneVal('base', store.get('marbleDerby.base', TUNE_DEF.base)), rest: tuneVal('rest', store.get('marbleDerby.rest', TUNE_DEF.rest)) };
const speedMult = () => tune.base * SPEEDS[speedK];
const saveTune = () => { store.set('marbleDerby.base', tune.base); store.set('marbleDerby.rest', tune.rest); };
// 彈珠彈性只影響彈珠互撞；其他物件取兩者較小值，所以調低時撞賽道、釘子也會變得較不彈
function applyRest() { if (race) for (const m of race.marbles) m.collider.setRestitution(tune.rest); }
function showTune() {
  $('baseVal').textContent = `1x ＝ 物理 ${tune.base.toFixed(1)} 倍`;
  $('restVal').textContent = tune.rest.toFixed(2);
}
function syncTune() { $('baseRange').value = tune.base; $('restRange').value = tune.rest; showTune(); }
$('baseRange').oninput = e => { tune.base = tuneVal('base', Number(e.target.value)); showTune(); saveTune(); };
$('restRange').oninput = e => { tune.rest = tuneVal('rest', Number(e.target.value)); showTune(); saveTune(); applyRest(); };
$('tuneReset').onclick = () => { tune.base = TUNE_DEF.base; tune.rest = TUNE_DEF.rest; syncTune(); saveTune(); applyRest(); };
$('tuneClose').onclick = () => $('tune').classList.add('hidden');
for (const b of document.querySelectorAll('.gear')) b.onclick = () => $('tune').classList.toggle('hidden');
syncTune();

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
  applyRest();
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
  if (!race || phase === 'betting' || e.repeat || e.target.tagName === 'INPUT') return;
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
      case 'hit': hits.push(e); break;
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

// ---------- 名牌 & 小地圖 & 排行 ----------
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

// 小地圖：俯瞰整條賽道（x 向右、z 向下，不旋轉），底圖畫一次存在離屏 canvas，每幀只重畫彈珠點
const mapBox = (() => {
  const pad = 6;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const grow = (x, z, r) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r); };
  track.P.forEach((p, i) => grow(p.x, p.z, track.half[i]));
  for (const f of track.funnels) grow(f.c[0], f.c[1], f.R);
  return { x0: x0 - pad, z0: z0 - pad, w: x1 - x0 + 2 * pad, h: z1 - z0 + 2 * pad };
})();
const mini = { cv: $('miniMap'), base: document.createElement('canvas'), g: null, s: 1, dpr: 1, dirty: true };
mini.cv.style.aspectRatio = `${mapBox.w} / ${mapBox.h}`;
addEventListener('resize', () => { mini.dirty = true; });

function buildMiniBase() {
  const { cv, base } = mini, dpr = mini.dpr = Math.min(devicePixelRatio || 1, 2);
  const w = cv.width = base.width = Math.round(cv.clientWidth * dpr), h = cv.height = base.height = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return false;
  mini.g = cv.getContext('2d');
  const s = mini.s = Math.min(w / mapBox.w, h / mapBox.h);   // 世界 1 單位＝幾個畫素
  const X = x => (x - mapBox.x0) * s, Y = z => (z - mapBox.z0) * s;
  const g = base.getContext('2d'), { P, R, half, N } = track;
  const skip = new Uint8Array(N);
  for (const f of track.funnels) skip.fill(1, f.i0, f.i1 + 1);   // 漏斗裡沒有賽道，改畫圓
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [col, extra] of [['#6b4a22', 2 * dpr], ['#f3d9a4', 0]]) {   // 先畫深色外框再畫淺色路面
    g.strokeStyle = col;
    for (let i = 0; i < N - 1; i++) {
      if (skip[i]) continue;
      g.lineWidth = Math.max(2.4 * dpr, 1.6 * half[i] * s) + extra;
      g.beginPath(); g.moveTo(X(P[i].x), Y(P[i].z)); g.lineTo(X(P[i + 1].x), Y(P[i + 1].z)); g.stroke();
    }
  }
  g.fillStyle = '#f7c08a'; g.strokeStyle = '#6b4a22'; g.lineWidth = 1.5 * dpr;
  for (const f of track.funnels) { g.beginPath(); g.arc(X(f.c[0]), Y(f.c[1]), Math.max(3 * dpr, f.R * s), 0, 7); g.fill(); g.stroke(); }
  const bar = (i, col, dash) => {   // 橫跨賽道的起點／終點線
    const hw = half[i] + 1.5;
    g.beginPath(); g.moveTo(X(P[i].x - R[i].x * hw), Y(P[i].z - R[i].z * hw)); g.lineTo(X(P[i].x + R[i].x * hw), Y(P[i].z + R[i].z * hw));
    g.lineCap = 'butt'; g.lineWidth = 3 * dpr; g.strokeStyle = col; g.setLineDash(dash.map(d => d * dpr)); g.stroke();
  };
  bar(track.gateI, '#e8483f', []);
  bar(track.finishI, '#111', []);
  bar(track.finishI, '#fff', [2, 2]);
  return true;
}

function drawMini() {
  if (mini.dirty) { if (!buildMiniBase()) return; mini.dirty = false; }
  const { g, s, dpr, cv } = mini;
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(mini.base, 0, 0);
  const at = m => { const p = m.body.translation(); return [(p.x - mapBox.x0) * s, (p.z - mapBox.z0) * s]; };
  const alive = race.marbles.filter(m => m.alive);
  g.lineWidth = dpr;
  for (const m of alive) {
    if (isMine(m)) continue;
    const [x, y] = at(m);
    g.beginPath(); g.arc(x, y, 2.6 * dpr, 0, 7);
    g.fillStyle = hex(m.color); g.strokeStyle = 'rgba(0,0,0,.45)'; g.fill(); g.stroke();
  }
  for (const m of alive) {   // 押注的彈珠大一點、加白框，畫在最上面
    if (!isMine(m)) continue;
    const [x, y] = at(m);
    g.beginPath(); g.arc(x, y, 4 * dpr, 0, 7);
    g.fillStyle = hex(m.color); g.fill();
    g.lineWidth = 3.6 * dpr; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
    g.lineWidth = 1.8 * dpr; g.strokeStyle = '#fff'; g.stroke();
  }
  const [fx, fy] = at(view.focusMarble());   // 鏡頭跟的彈珠加一圈光環
  g.beginPath(); g.arc(fx, fy, 7.5 * dpr, 0, 7);
  g.lineWidth = 2 * dpr; g.strokeStyle = '#ffd400'; g.shadowColor = '#ffd400'; g.shadowBlur = 6 * dpr; g.stroke();
  g.shadowBlur = 0;
}

function updateHud() {
  drawMini();
  hudTimer -= 1;
  if (hudTimer > 0) return;
  hudTimer = 6;

  const status = m => m.finished ? `🏁 第 ${m.place} 名` : `第 ${m.rank} 名`;
  setHtml('myBets', bets.length
    ? '<div class="list">' + bets.map(b => { const m = race.marbles[b.id]; return `<div><span class="sw" style="background:${hex(m.color)}"></span><b>${m.name}</b> ${TYPE_NAME[b.type]} ${b.amount}<span class="pos">${status(m)}</span></div>`; }).join('') + '</div>'
    : '<div class="watching">觀看中</div>');

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
    const mult = race.phase === 'countdown' ? 1 : speedMult();
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
  view.render(phase === 'betting' ? 0 : acc / DT, phase === 'betting' || race.phase === 'countdown' ? dt : dt * speedMult());
  if (phase !== 'betting') { updateHud(); updateTags(); }
  // 滾動聲跟著鏡頭跟隨的彈珠
  const fm = phase === 'betting' ? null : view.focusMarble();
  if (fm) { const v = fm.body.linvel(); sfx.roll(Math.hypot(v.x, v.y, v.z), fm.grounded && race.phase === 'race'); }
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

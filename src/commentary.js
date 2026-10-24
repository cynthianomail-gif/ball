// 即時轉播：每幀看比賽狀態決定要講什麼，用瀏覽器內建語音（Web Speech API）念出來
// 一次只講一句；新的一句先排隊，講不及、過時的直接丟掉（彈珠跑很快，晚兩秒講的已經不是現在的事）
// 之後要換成 AI 轉播員的音檔，只要換掉最下面「念出來」那一段
const synth = window.speechSynthesis || null;
const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const pick = list => list[Math.floor(Math.random() * list.length)];
const now = () => performance.now() / 1000;

// 語氣：一句話可以拆成好幾段，每段用不同的速度和音高念，聽起來才有起伏
// 0 失望（慢、低） 1 平穩 2 有精神 3 興奮 4 爆發（最快、最高）
const MOOD = [{ rate: 1.0, pitch: 0.85 }, { rate: 1.15, pitch: 1.05 }, { rate: 1.25, pitch: 1.18 }, { rate: 1.35, pitch: 1.32 }, { rate: 1.45, pitch: 1.5 }];

// 領先的彈珠第一個進到某一關時講的話（n＝領先者名字）
const ZONE_LINES = {
  funnel: [n => [[`${n}率先衝進大漏斗！`, 3], ['轉啊轉啊～', 2]], () => [['大漏斗來了！', 3], ['大家一起繞圈圈！', 2]]],
  zigzag: [n => [['六連發夾彎！', 3], [`${n}帶頭左右甩！`, 2]], () => [['夾彎來了！', 3], ['一顆一顆排好隊！', 2]]],
  minifunnel: [() => [['小漏斗！', 3], ['一次只能過一顆喔！', 2]], n => [[`${n}率先掉進小漏斗！`, 3]]],
  fork: [n => [['分岔路口！', 3], [`${n}會走哪一邊？`, 2]], () => [['左邊？還是右邊？', 3]]],
  cross: [() => [['旋轉十字門！', 3], ['小心被打飛啊！', 3]], n => [[`${n}來到旋轉十字門！`, 3]]],
  piston: [() => [['跳跳積木！', 3], ['要看準時機！', 2]], n => [[`${n}衝進跳跳積木！`, 3]]],
  pegs: [() => [['彈珠台！', 3], ['彈來彈去，全看運氣！', 2]], n => [[`${n}掉進彈珠台！`, 3], ['叮叮咚咚！', 3]]],
  water: [() => [['最後的水底隧道！', 3], ['走中間才快！', 2]], n => [['水底隧道！', 3], [`${n}還守在第一！`, 3]]],
};

export class Commentator {
  constructor({ duck = () => {}, cheer = () => {} } = {}) {
    this.duck = duck;          // 講話時把背景音樂壓低
    this.cheer = cheer;        // 精彩時刻的觀眾歡呼（0～1 多熱烈）
    this.volume = 0.9;
    this.queue = [];
    this.speaking = false;
    this.voice = null;
    this.race = null;
    if (synth) {
      this._pickVoice();
      synth.addEventListener?.('voiceschanged', () => this._pickVoice());
    }
  }

  get supported() { return !!synth; }
  get voiceName() { return this.voice?.name || ''; }

  // 中文語音裡挑最自然的：台灣的 Natural／Online（Edge）＞ Google 台灣 ＞ 其他台灣 ＞ 任何中文
  _pickVoice() {
    const vs = synth.getVoices();
    const tw = vs.filter(v => /zh[-_]TW/i.test(v.lang));
    this.voice = tw.find(v => /Natural|Online/i.test(v.name)) || tw.find(v => /Google/i.test(v.name)) || tw[0]
      || vs.find(v => /^zh/i.test(v.lang)) || null;
  }

  // iOS 要在點擊當下先念過一次（空的也行），之後才准自己出聲
  unlock() {
    if (!synth || this.unlocked) return;
    this.unlocked = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  }

  setVolume(v) {
    this.volume = v;
    if (!v) this.stop();
  }

  stop() {
    this.queue.length = 0;
    this.race = null;
    this._cancel();
  }

  // 新的一場開跑前：mine＝有下注的彈珠 id
  start(race, mine, raceNo) {
    this.stop();
    this.race = race;
    this.mine = new Set(mine);
    this.leader = -1; this.leadSince = 0; this.leadSaid = true; this.firstLead = true; this.announced = -1;
    this.zonesSaid = new Set();
    this.finalSaid = false;
    this.ranks = new Map();        // 下注的彈珠：上次講過的名次、目前觀察中的名次與開始時間
    this.lastLine = now();
    this.lastRescue = -99; this.lastClose = -99; this.lastLeadLine = -99;
    const names = mine.map(id => race.marbles[id].name);
    this.say(names.length ? [[`第${raceNo}場比賽！`, 2], ['各就各位…', 1], [`你押的是${names.join('、')}，加油！`, 3]]
      : [[`第${raceNo}場比賽！`, 2], ['各就各位…', 1]], { pri: 3, ttl: 4 });
  }

  // 比賽事件（sim 每步丟出來的）
  onEvent(e) {
    if (!this.race) return;
    const t = now();
    switch (e.type) {
      case 'go':
        this.cheer(0.7);
        this.say(pick([[['出發！！', 4]], [['衝啊！！', 4]], [['閘門打開！', 3], ['衝啊！！', 4]]]), { pri: 3, ttl: 2 });
        break;
      case 'rescue':
        if (this.mine.has(e.m.id)) this.say([['糟糕！', 4], [`你押的${e.m.name}飛出去了！`, 3], ['手套快來救！', 2]], { pri: 2, ttl: 3 });
        else if (t - this.lastRescue > 6) {
          this.lastRescue = t;
          this.say(pick([[['哎呀！', 3], [`${e.m.name}飛出賽道了！`, 2]], [[`${e.m.name}被打飛！`, 3], ['手套出動！', 2]]]), { ttl: 2.5 });
        }
        break;
      case 'finish': {
        const n = e.m.name, mine = this.mine.has(e.m.id);
        if (e.place === 1) {
          this.cheer(1);
          this.say(mine ? [['衝線！！', 4], [`${n}奪冠！`, 4], ['你押中了！太神啦！', 4]]
            : [['衝線！！', 4], ['冠軍是…', 2], [`${n}！！`, 4]], { pri: 3, ttl: 4, interrupt: true });
        } else if (e.place === 2) this.say([['第二名，', 2], [`${n}！`, 3]], { pri: 3, ttl: 4 });
        else if (e.place === 3) this.say([['第三名，', 2], [`${n}！`, 3], ['前三名出爐！', 2]], { pri: 3, ttl: 4 });
        break;
      }
    }
  }

  // 每幀呼叫：fast＝開 5x 以上，只講重要的
  update(fast) {
    const r = this.race;
    if (r && r.phase === 'race' && r.ranking) this._watch(r);
    this._pump(fast);
  }

  _watch(r) {
    const t = now(), lead = r.ranking[0];
    if (!r.finishOrder.length) {
      // 換人領先：維持 0.6 秒才算，避免兩顆並排時一直換；不是你押的彈珠，兩次之間至少隔 3 秒
      // 被短暫超前又搶回來的不算換人（announced＝上次講過的領先者）
      if (lead.id !== this.leader) { this.leader = lead.id; this.leadSince = t; this.leadSaid = lead.id === this.announced; }
      else if (!this.leadSaid && t - this.leadSince > 0.6 && (this.mine.has(lead.id) || t - this.lastLeadLine > 3)) {
        this.leadSaid = true; this.lastLeadLine = t; this.announced = lead.id;
        const n = lead.name, mine = this.mine.has(lead.id);
        if (this.firstLead) { this.firstLead = false; this.say([[`${n}一馬當先！`, 3]], { ttl: 2 }); }
        else if (mine) { this.cheer(0.6); this.say([['好耶！', 4], [`你押的${n}衝上第一！`, 3]], { pri: 3, ttl: 2 }); }
        else this.say(pick([[['哇！', 4], [`${n}超車了！`, 3]], [[`${n}！`, 4], ['衝到最前面了！', 3]], [['換人了！', 3], [`現在是${n}領先！`, 2]]]), { pri: 2, ttl: 2 });
      }
      // 領先者進到新的一關
      for (const z of r.track.zones) {
        if (this.zonesSaid.has(z) || lead.maxS < z.s0) continue;
        this.zonesSaid.add(z);
        if (lead.maxS < z.s1 && ZONE_LINES[z.type]) this.say(pick(ZONE_LINES[z.type])(lead.name), { ttl: 3 });
      }
      // 最後衝刺
      if (!this.finalSaid && lead.maxS > r.finishS - 30) {
        this.finalSaid = true;
        const second = r.ranking[1];
        this.cheer(0.5);
        this.say([['最後衝刺！！', 4], [`${lead.name}領先！`, 3], [`${second.name}追上來了！`, 4]], { pri: 2, ttl: 3 });
      }
      // 前兩名咬很緊
      const second = r.ranking[1];
      if (second && lead.maxS - second.maxS < 0.8 && t - this.lastClose > 12 && t - this.leadSince > 2) {
        this.lastClose = t;
        this.say([[`${lead.name}跟${second.name}！`, 3], ['咬得好緊啊！', 3]], { pri: 0, ttl: 2 });
      }
    }
    // 你押的彈珠名次變化：維持 1.2 秒才算、同一顆至少隔 6 秒，進前三或掉出前三才講
    for (const id of this.mine) {
      const m = r.marbles[id];
      if (m.finished || !m.alive) continue;
      let s = this.ranks.get(id);
      if (!s) { this.ranks.set(id, { said: m.rank, cur: m.rank, since: t, last: -99 }); continue; }
      if (m.rank !== s.cur) { s.cur = m.rank; s.since = t; continue; }
      if (s.cur === s.said || t - s.since < 1.2 || t - s.last < 6) continue;
      const up = s.cur < s.said;
      if (up && s.cur <= 3 && s.cur > 1) { this.say([['漂亮！', 4], [`${m.name}衝上第${NUM[s.cur]}名！`, 3]], { pri: 2, ttl: 2 }); s.last = t; }
      else if (!up && s.said <= 3 && s.cur > 3) { this.say([['啊…', 0], [`${m.name}掉到第${NUM[s.cur] || s.cur}名了…`, 0]], { ttl: 2 }); s.last = t; }
      s.said = s.cur;
    }
    // 太久沒講話：報一下前三名
    if (!r.finishOrder.length && t - this.lastLine > 6 && !this.speaking && !this.queue.length) {
      const [a, b, c] = r.ranking;
      this.say(`目前第一${a.name}，第二${b.name}，第三${c.name}。`, { pri: 0, ttl: 1.5 });
    }
  }

  // parts：一段文字（用 mood 的語氣），或 [[文字, 語氣], ...] 分段念
  // pri：0 閒聊 1 一般 2 重要 3 一定要講；ttl：幾秒內沒輪到就丟掉；interrupt：打斷正在講的
  say(parts, { pri = 1, ttl = 2.5, mood = 1, interrupt = false } = {}) {
    if (!synth || !this.volume) return;
    const line = { parts: typeof parts === 'string' ? [[parts, mood]] : parts, pri, until: now() + ttl };
    if (interrupt) { this.queue.length = 0; this._cancel(); }
    this.queue.push(line);
    this.lastLine = now();
  }

  _pump(fast) {
    if (!synth || this.speaking) return;
    const t = now();
    this.queue = this.queue.filter(l => l.until > t && (!fast || l.pri >= 2));
    if (!this.queue.length) return;
    let best = 0;
    for (let k = 1; k < this.queue.length; k++) if (this.queue[k].pri > this.queue[best].pri) best = k;
    this._speak(this.queue.splice(best, 1)[0].parts);
  }

  // ---------- 念出來 ----------
  _speak(parts) {
    const token = this.token = {};
    const done = () => {
      if (this.token !== token) return;
      this.token = null; this.speaking = false; this.lastLine = now();
      clearTimeout(this.guard);
      this.duck(false);
    };
    this.speaking = true;
    this.duck(true);
    // 有些瀏覽器偶爾不回 onend：最多等 8 秒就當作講完
    this.guard = setTimeout(done, 8000);
    // 每段各一句排進瀏覽器的語音佇列，最後一段念完才算講完
    parts.forEach(([text, mood], k) => {
      const u = new SpeechSynthesisUtterance(text), v = MOOD[mood];
      u.lang = 'zh-TW';
      if (this.voice) u.voice = this.voice;
      u.rate = v.rate; u.pitch = v.pitch; u.volume = this.volume;
      u.onerror = done;
      if (k === parts.length - 1) u.onend = done;
      synth.speak(u);
    });
  }

  _cancel() {
    if (!synth) return;
    this.token = null; this.speaking = false;
    clearTimeout(this.guard);
    this.duck(false);
    synth.cancel();
  }
}

// 即時轉播：每幀看比賽狀態決定要講什麼，用瀏覽器內建語音（Web Speech API）念出來
// 一次只講一句；新的一句先排隊，講不及、過時的直接丟掉（彈珠跑很快，晚兩秒講的已經不是現在的事）
// 之後要換成 AI 轉播員的音檔，只要換掉最下面「念出來」那一段
const synth = window.speechSynthesis || null;
const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const pick = list => list[Math.floor(Math.random() * list.length)];
const now = () => performance.now() / 1000;

// 領先的彈珠第一個進到某一關時講的話（n＝領先者名字）
const ZONE_LINES = {
  funnel: [n => `${n}率先衝進大漏斗！`, () => '大漏斗來了，大家開始繞圈圈！'],
  zigzag: [n => `六連發夾彎！${n}帶頭左右甩！`, () => '進入夾彎，一顆一顆排隊過！'],
  minifunnel: [() => '連續小漏斗，一次只能過一顆！', n => `${n}率先掉進小漏斗！`],
  fork: [n => `前面分岔了，${n}會走哪一邊？`, () => '分岔路口！左邊還是右邊？'],
  cross: [() => '旋轉十字門！小心被打飛！', n => `${n}來到旋轉十字門！`],
  piston: [() => '跳跳積木區，要看準時機！', n => `${n}衝進跳跳積木！`],
  pegs: [() => '彈珠台！彈來彈去全看運氣！', n => `${n}掉進彈珠台區！`],
  water: [() => '最後的水底隧道，走中間乾道才快！', n => `水底隧道！${n}還在領先！`],
};

export class Commentator {
  constructor({ duck = () => {} } = {}) {
    this.duck = duck;          // 講話時把背景音樂壓低
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
    this.leader = -1; this.leadSince = 0; this.leadSaid = true; this.firstLead = true;
    this.zonesSaid = new Set();
    this.finalSaid = false;
    this.ranks = new Map();        // 下注的彈珠：上次講過的名次、目前觀察中的名次與開始時間
    this.lastLine = now();
    this.lastRescue = -99; this.lastClose = -99; this.lastLeadLine = -99;
    const names = mine.map(id => race.marbles[id].name);
    this.say(names.length ? `第${raceNo}場，各就各位！你押的是${names.join('、')}。` : `第${raceNo}場，各就各位！`, 3, 4);
  }

  // 比賽事件（sim 每步丟出來的）
  onEvent(e) {
    if (!this.race) return;
    const t = now();
    switch (e.type) {
      case 'go':
        this.say(pick(['比賽開始！', '出發！', '閘門打開，衝啊！']), 3, 2);
        break;
      case 'rescue':
        if (this.mine.has(e.m.id)) this.say(`糟糕！你押的${e.m.name}飛出去了，手套來救！`, 2, 3);
        else if (t - this.lastRescue > 6) {
          this.lastRescue = t;
          this.say(pick([`${e.m.name}飛出賽道，手套把它撈回來！`, `哎呀，${e.m.name}出界了！`]), 1, 2.5);
        }
        break;
      case 'finish': {
        const n = e.m.name, mine = this.mine.has(e.m.id);
        if (e.place === 1) this.say(mine ? `${n}奪冠！你押的${n}拿下冠軍！` : pick([`${n}衝過終點，拿下冠軍！`, `冠軍是${n}！`]), 3, 4, true);
        else if (e.place === 2) this.say(`第二名，${n}！`, 3, 4);
        else if (e.place === 3) this.say(`第三名${n}，前三名出爐！`, 3, 4);
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
      if (lead.id !== this.leader) { this.leader = lead.id; this.leadSince = t; this.leadSaid = false; }
      else if (!this.leadSaid && t - this.leadSince > 0.6 && (this.mine.has(lead.id) || t - this.lastLeadLine > 3)) {
        this.leadSaid = true; this.lastLeadLine = t;
        const n = lead.name, mine = this.mine.has(lead.id);
        if (this.firstLead) { this.firstLead = false; this.say(`${n}搶到領先！`, 1, 2); }
        else this.say(mine ? `你押的${n}衝上第一了！` : pick([`${n}超前，現在領先！`, `換${n}領先了！`, `${n}衝到最前面！`]), mine ? 3 : 2, 2);
      }
      // 領先者進到新的一關
      for (const z of r.track.zones) {
        if (this.zonesSaid.has(z) || lead.maxS < z.s0) continue;
        this.zonesSaid.add(z);
        if (lead.maxS < z.s1 && ZONE_LINES[z.type]) this.say(pick(ZONE_LINES[z.type])(lead.name), 1, 3);
      }
      // 最後衝刺
      if (!this.finalSaid && lead.maxS > r.finishS - 30) {
        this.finalSaid = true;
        const second = r.ranking[1];
        this.say(`最後衝刺！${lead.name}領先，${second.name}緊追在後！`, 2, 3);
      }
      // 前兩名咬很緊
      const second = r.ranking[1];
      if (second && lead.maxS - second.maxS < 0.8 && t - this.lastClose > 12 && t - this.leadSince > 2) {
        this.lastClose = t;
        this.say(`${lead.name}跟${second.name}咬得很緊！`, 0, 2);
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
      if (up && s.cur <= 3 && s.cur > 1) { this.say(`你押的${m.name}衝上第${NUM[s.cur]}名！`, 2, 2); s.last = t; }
      else if (!up && s.said <= 3 && s.cur > 3) { this.say(`哎呀，${m.name}掉到第${NUM[s.cur] || s.cur}名！`, 1, 2); s.last = t; }
      s.said = s.cur;
    }
    // 太久沒講話：報一下前三名
    if (!r.finishOrder.length && t - this.lastLine > 6 && !this.speaking && !this.queue.length) {
      const [a, b, c] = r.ranking;
      this.say(`目前第一${a.name}，第二${b.name}，第三${c.name}。`, 0, 1.5);
    }
  }

  // pri：0 閒聊 1 一般 2 重要 3 一定要講；ttl：幾秒內沒輪到就丟掉；interrupt：打斷正在講的
  say(text, pri = 1, ttl = 2.5, interrupt = false) {
    if (!synth || !this.volume) return;
    const line = { text, pri, until: now() + ttl };
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
    this._speak(this.queue.splice(best, 1)[0].text);
  }

  // ---------- 念出來 ----------
  _speak(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    if (this.voice) u.voice = this.voice;
    u.rate = 1.2; u.pitch = 1.1; u.volume = this.volume;
    const token = this.token = {};
    const done = () => {
      if (this.token !== token) return;
      this.token = null; this.speaking = false; this.lastLine = now();
      clearTimeout(this.guard);
      this.duck(false);
    };
    u.onend = done; u.onerror = done;
    this.speaking = true;
    this.duck(true);
    // 有些瀏覽器偶爾不回 onend：最多等 8 秒就當作講完
    this.guard = setTimeout(done, 8000);
    synth.speak(u);
  }

  _cancel() {
    if (!synth) return;
    this.token = null; this.speaking = false;
    clearTimeout(this.guard);
    this.duck(false);
    synth.cancel();
  }
}

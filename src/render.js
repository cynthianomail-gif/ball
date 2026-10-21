// 3D 畫面：臥室、積木賽道、彈珠、鏡頭
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STEP, WALL_H, WALL_T, BEAM, EDGE_RISE, colliderProfile, trackPoint, trackQuat, floorHeightAt, mulberry32, ZONE_INFO } from './track.js';
import { RADIUS, PISTON, PEG_R, goldLit } from './sim.js';

const TOY = [0xe8483f, 0xf6b929, 0x2f7de1, 0x35b45b, 0xf07c2a, 0x8e5bd6];

// ---------- 程式產生的貼圖 ----------
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function woodTex(base = [196, 150, 98], planks = 4, seed = 3) {
  const r = mulberry32(seed);
  return canvasTex(512, 512, (g, w, h) => {
    const ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const k = 0.88 + r() * 0.2;
      g.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
      g.fillRect(0, p * ph, w, ph);
      for (let l = 0; l < 26; l++) {
        const y = p * ph + r() * ph;
        g.strokeStyle = `rgba(90,55,25,${0.05 + r() * 0.1})`;
        g.lineWidth = 1 + r() * 2;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + l) * 3 * r());
        g.stroke();
      }
      g.fillStyle = 'rgba(60,35,15,0.55)';
      g.fillRect(0, p * ph, w, 3);
      const cut = r() * w;
      g.fillRect(cut, p * ph, 3, ph);
    }
  }, true);
}

function letterTex(letter, color) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#' + color.toString(16).padStart(6, '0');
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 8;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#fff';
    g.font = 'bold 76px Arial Black, Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, w / 2, h / 2 + 4);
  });
}

function marbleTex(color, pattern, seed) {
  const r = mulberry32(seed + 11);
  const col = new THREE.Color(color);
  const hex = '#' + col.getHexString();
  const light = '#' + col.clone().lerp(new THREE.Color(1, 1, 1), 0.65).getHexString();
  const dark = '#' + col.clone().multiplyScalar(0.45).getHexString();
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = hex; g.fillRect(0, 0, w, h);
    if (pattern === 0 || pattern === 3) {          // 漩渦
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = k % 2 ? light : '#ffffff'; g.lineWidth = 7 + r() * 8;
        g.beginPath();
        const ph = r() * 6, amp = 18 + r() * 25, y0 = 20 + r() * 88;
        for (let x = -10; x <= w + 10; x += 6) g.lineTo(x, y0 + Math.sin(x / w * Math.PI * 4 + ph) * amp);
        g.stroke();
      }
    } else if (pattern === 1 || pattern === 4) {   // 條紋
      g.fillStyle = pattern === 1 ? '#ffffff' : dark;
      for (let k = 0; k < 4; k++) g.fillRect(0, 12 + k * 30, w, 9);
    } else if (pattern === 2) {                    // 點點
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 22; k++) { g.beginPath(); g.arc(r() * w, r() * h, 5 + r() * 7, 0, 7); g.fill(); }
    } else {                                       // 貓眼
      g.fillStyle = light;
      for (let k = 0; k < 4; k++) {
        g.beginPath(); g.ellipse((k + 0.5) * w / 4, h / 2, 12, 48, 0, 0, 7); g.fill();
      }
    }
  });
}

function bannerTex(text, sub, bg = '#fff7e0', fg = '#3a2a1a', checker = false) {
  return canvasTex(1024, 192, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (checker) {
      const s = 32;
      for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
        if (((x + y) / s) % 2 === 0) { g.fillStyle = '#111'; g.fillRect(x, y, s, s); }
      }
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(180, 30, w - 360, h - 60);
    }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 84px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
    g.fillText(text, w / 2, sub ? h / 2 - 22 : h / 2);
    if (sub) { g.font = 'bold 40px "Microsoft JhengHei", "PingFang TC", sans-serif'; g.fillText(sub, w / 2, h / 2 + 52); }
  });
}

// ---------- 主畫面類別 ----------
// 鏡頭模式：dist 在目標後方多遠、height 多高、ahead 看目標前方多遠
export const CAM_MODES = [
  { name: '上帝視角', dist: 13, height: 22, ahead: 3, lift: 0, shadow: 45 },
  { name: '俯瞰全景', dist: 3, height: 42, ahead: 4, lift: 0, shadow: 60 },
  { name: '追尾', dist: 8.5, height: 3.6, ahead: 4, lift: 0.8, shadow: 40 },
];

export class View {
  constructor(canvas, track) {
    this.track = track;
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.mobile = mobile;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    const maxPr = Math.min(devicePixelRatio, mobile ? 1.5 : 2);
    this.quality = { pr: maxPr, max: maxPr, min: Math.min(maxPr, mobile ? 0.75 : 1), ema: 1 / 60, timer: 0 };
    r.setPixelRatio(maxPr);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3e3c8);
    scene.fog = new THREE.Fog(0xf3e3c8, 160, 560);
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
    this.camMode = 0;           // CAM_MODES 的索引
    this.yawOffset = 0;
    this.dragging = false;
    this.camFwd = new THREE.Vector3(1, 0, 0);
    this.camLook = new THREE.Vector3();
    this.camTarget = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this.camInit = false;

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a6a48, 1.1));
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sunOffset = new THREE.Vector3(70, 120, 40);

    this._buildRoom();
    this._buildTrack();
    this._buildObstacles();
    this._buildArches();
    this.marbleGroup = new THREE.Group();
    scene.add(this.marbleGroup);

    // 下注彈珠頭上的箭頭
    this.markerGeo = new THREE.ConeGeometry(0.35, 0.7, 16);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffd400 });
    this.markers = [];
    this.focusId = -1;          // 鏡頭跟隨的彈珠，-1 = 跟領先者

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // 動態解析度：跑不動就降低渲染解析度，順了再慢慢調回來
  adaptQuality(frameDt) {
    if (frameDt > 0.25) return;            // 切到背景回來的那一幀不算
    const q = this.quality;
    q.ema += (frameDt - q.ema) * 0.05;
    q.timer += frameDt;
    if (q.timer < 1.5) return;
    let pr = q.pr;
    if (q.ema > 1 / 45 && pr > q.min) pr = Math.max(q.min, pr - 0.25);
    else if (q.ema < 1 / 57 && pr < q.max && q.timer > 4) pr = Math.min(q.max, pr + 0.25);
    else if (q.ema < 1 / 57) return;      // 順了也要等久一點才調高
    q.timer = 0;
    if (pr !== q.pr) { q.pr = pr; this.renderer.setPixelRatio(pr); this.resize(); }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 78 : 62;
    this.camera.updateProjectionMatrix();
  }

  _trackBlocked(x0, x1, z0, z1, maxY) {
    const t = this.track;
    for (let i = 0; i < t.N; i += 4) {
      const p = t.P[i];
      if (p.x > x0 - 9 && p.x < x1 + 9 && p.z > z0 - 9 && p.z < z1 + 9 && p.y - BEAM - 2 < maxY) return true;
    }
    return false;
  }

  _box(w, h, d, mat, x, y, z, parent = this.scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  _buildRoom() {
    const t = this.track, scene = this.scene;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of t.P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    x0 -= 50; x1 += 50; z0 -= 50; z1 += 50;
    const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, H = 170;
    this.room = { x0, x1, z0, z1 };

    const ft = woodTex([170, 118, 72], 6, 5);
    ft.repeat.set(W / 60, D / 60);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); floor.receiveShadow = true;
    scene.add(floor);

    const wp = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#f6e7cf'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#efd9b8'; for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 28, h);
      g.fillStyle = '#e8a87c';
      for (let y = 32; y < h; y += 64) for (let x = 46; x < w; x += 64) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    }, true);
    const wallMat = (rx, ry) => { const tx = wp.clone(); tx.repeat.set(rx, ry); tx.needsUpdate = true; return new THREE.MeshStandardMaterial({ map: tx, roughness: 0.9 }); };
    const mk = (w, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat(w / 40, H / 40));
      m.position.set(x, H / 2, z); m.rotation.y = ry; m.receiveShadow = true; scene.add(m);
    };
    mk(W, cx, z0, 0); mk(W, cx, z1, Math.PI); mk(D, x0, cz, Math.PI / 2); mk(D, x1, cz, -Math.PI / 2);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xfff8ec }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, H, cz); scene.add(ceil);
    // 踢腳板
    const trim = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    this._box(W, 6, 1, trim, cx, 3, z0 + 0.5); this._box(W, 6, 1, trim, cx, 3, z1 - 0.5);
    this._box(1, 6, D, trim, x0 + 0.5, 3, cz); this._box(1, 6, D, trim, x1 - 0.5, 3, cz);

    // 窗戶（光源方向）
    const win = new THREE.Mesh(new THREE.PlaneGeometry(110, 80), new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
    win.position.set(x1 - 0.6, 95, cz); win.rotation.y = -Math.PI / 2; scene.add(win);
    const frame = new THREE.MeshStandardMaterial({ color: 0xffffff });
    this._box(2, 84, 4, frame, x1 - 1, 95, cz); this._box(2, 4, 114, frame, x1 - 1, 95, cz);
    this._box(2, 4, 114, frame, x1 - 1, 136, cz); this._box(2, 4, 114, frame, x1 - 1, 54, cz);
    this.sunOffset.set(110, 140, 30);

    // 地毯
    const rug = new THREE.Mesh(new THREE.CircleGeometry(70, 64), new THREE.MeshStandardMaterial({
      map: canvasTex(512, 512, (g, w, h) => {
        const cols = ['#5b8fb9', '#f2e6c9', '#e07a5f', '#f2e6c9', '#81b29a', '#f2e6c9', '#f2cc8f'];
        for (let k = 0; k < cols.length; k++) { g.fillStyle = cols[k]; g.beginPath(); g.arc(w / 2, h / 2, w / 2 * (1 - k / cols.length), 0, 7); g.fill(); }
      }), roughness: 1,
    }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(cx, 0.15, cz); rug.receiveShadow = true; scene.add(rug);

    // 起點書桌
    const p0 = t.P[0];
    const deskTop = p0.y - BEAM - 1.5;
    const desk = new THREE.MeshStandardMaterial({ map: woodTex([150, 100, 60], 3, 9), roughness: 0.5 });
    const dx0 = p0.x - 22, dx1 = p0.x + 62, dz0 = p0.z - 28, dz1 = p0.z + 28;
    this._box(dx1 - dx0, 3, dz1 - dz0, desk, (dx0 + dx1) / 2, deskTop - 1.5, p0.z);
    for (const [lx, lz] of [[dx0 + 3, dz0 + 3], [dx1 - 3, dz0 + 3], [dx0 + 3, dz1 - 3], [dx1 - 3, dz1 - 3]])
      this._box(4, deskTop - 3, 4, desk, lx, (deskTop - 3) / 2, lz);
    // 桌上檯燈
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2f7de1, roughness: 0.4 });
    this._box(10, 1.5, 10, lampMat, dx0 + 8, deskTop + 0.75, dz1 - 9);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 26), lampMat);
    pole.position.set(dx0 + 8, deskTop + 13, dz1 - 9); scene.add(pole);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(7, 9, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xf6b929, side: THREE.DoubleSide }));
    shade.position.set(dx0 + 8, deskTop + 28, dz1 - 9); scene.add(shade);
    const bulb = new THREE.PointLight(0xffc77a, 900, 120, 1.6);
    bulb.position.set(dx0 + 8, deskTop + 25, dz1 - 9); scene.add(bulb);

    // 家具：自動找沒擋到賽道的地方
    const place = (w, d, h, build) => {
      const cand = [];
      for (let k = 0; k <= 10; k++) {
        const fx = x0 + 4 + (W - w - 8) * k / 10, fz = z0 + 4 + (D - d - 8) * k / 10;
        cand.push([fx, z0 + 2, w, d], [fx, z1 - d - 2, w, d], [x0 + 2, fz, d, w], [x1 - d - 2, fz, d, w]);
      }
      for (const [ax, az, aw, ad] of cand) {
        if (this._overlapsProps(ax, ax + aw, az, az + ad)) continue;
        if (!this._trackBlocked(ax, ax + aw, az, az + ad, h)) { this.props.push([ax, ax + aw, az, az + ad]); build(ax, az, aw, ad); return; }
      }
    };
    this.props = [[dx0, dx1, dz0, dz1]];
    // 床
    place(110, 200, 55, (ax, az, aw, ad) => {
      const c = [ax + aw / 2, az + ad / 2];
      this._box(aw, 30, ad, new THREE.MeshStandardMaterial({ map: woodTex([120, 80, 50], 3, 2) }), c[0], 15, c[1]);
      this._box(aw - 4, 14, ad - 4, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), c[0], 37, c[1]);
      const long = ad > aw;
      const blanket = new THREE.MeshStandardMaterial({ color: 0x5b8fb9, roughness: 1 });
      if (long) this._box(aw - 2, 15, ad * 0.6, blanket, c[0], 38, c[1] + ad * 0.18);
      else this._box(aw * 0.6, 15, ad - 2, blanket, c[0] + aw * 0.18, 38, c[1]);
      const pil = new THREE.MeshStandardMaterial({ color: 0xffe9d6, roughness: 1 });
      if (long) this._box(aw * 0.7, 7, 26, pil, c[0], 47, az + 20); else this._box(26, 7, ad * 0.7, pil, ax + 20, 47, c[1]);
    });
    // 書櫃
    place(70, 30, 150, (ax, az, aw, ad) => {
      const wood = new THREE.MeshStandardMaterial({ map: woodTex([200, 160, 110], 3, 4) });
      const cx2 = ax + aw / 2, cz2 = az + ad / 2;
      const along = aw > ad;
      this._box(aw, 150, ad, wood, cx2, 75, cz2);
      const r = mulberry32(42);
      for (let sh = 0; sh < 4; sh++) {
        const y = 22 + sh * 34;
        let off = -((along ? aw : ad) / 2) + 4;
        while (off < (along ? aw : ad) / 2 - 8) {
          const bw = 3 + r() * 4, bh = 18 + r() * 9;
          const mat = new THREE.MeshStandardMaterial({ color: TOY[Math.floor(r() * TOY.length)], roughness: 0.7 });
          const front = along ? [cx2 + off, y + bh / 2, cz2 + (az < this.room.z0 + 10 ? ad / 2 + 2 : -ad / 2 - 2)] : [cx2 + (ax < this.room.x0 + 10 ? ad / 2 + 2 : -ad / 2 - 2), y + bh / 2, cz2 + off];
          this._box(along ? bw : 8, bh, along ? 8 : bw, mat, ...front);
          off += bw + 0.6;
        }
      }
    });
    // 玩具箱
    place(50, 35, 30, (ax, az, aw, ad) => {
      this._box(aw, 30, ad, new THREE.MeshStandardMaterial({ color: 0xe8483f, roughness: 0.6 }), ax + aw / 2, 15, az + ad / 2);
    });

    // 散落的大積木
    const r = mulberry32(77);
    for (let k = 0; k < 40; k++) {
      const s = 5 + r() * 6;
      const x = x0 + 15 + r() * (W - 30), z = z0 + 15 + r() * (D - 30);
      if (this._trackBlocked(x - s, x + s, z - s, z + s, s + 2) || this._overlapsProps(x - s, x + s, z - s, z + s)) continue;
      const col = TOY[Math.floor(r() * TOY.length)];
      const m = this._box(s, s, s, new THREE.MeshStandardMaterial({ map: letterTex(String.fromCharCode(65 + Math.floor(r() * 26)), col), roughness: 0.5 }), x, s / 2, z);
      m.rotation.y = r() * Math.PI;
    }
  }

  _overlapsProps(a0, a1, b0, b1) {
    return (this.props || []).some(([x0, x1, z0, z1]) => a0 < x1 && a1 > x0 && b0 < z1 && b1 > z0);
  }

  _buildTrack() {
    const t = this.track;
    const wt = woodTex([224, 186, 132], 4, 8);
    const floorMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.45 });
    const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
    const cols = TOY.map(c => new THREE.Color(c));

    for (const [a, b] of t.ranges) {
      // 地板
      const pos = [], uv = [], idx = [];
      const M = 17;
      for (let i = a; i <= b; i++) {
        const prof = colliderProfile(t.half[i]).slice(2, 2 + M);
        for (let k = 0; k < M; k++) {
          const [px, py] = prof[k];
          const P = t.P[i], R = t.R[i], U = t.U[i];
          pos.push(P.x + R.x * px + U.x * py, P.y + R.y * px + U.y * py, P.z + R.z * px + U.z * py);
          uv.push(px / 8, i * STEP / 8);
        }
      }
      for (let i = 0; i < b - a; i++) for (let k = 0; k < M - 1; k++) {
        const A = i * M + k, B = A + 1, C = A + M, D = C + 1;
        idx.push(A, B, C, B, D, C);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const fm = new THREE.Mesh(g, floorMat); fm.receiveShadow = true; this.scene.add(fm);

      // 牆＋底（每 6 單位換一個積木顏色）
      const sp = [], sc = [], si = [];
      const CH = 12;
      for (let c0 = a; c0 < b; c0 += CH) {
        const c1 = Math.min(b, c0 + CH);
        const col = cols[Math.floor(c0 / CH) % cols.length];
        const loops = [];
        for (let i = c0; i <= c1; i++) {
          const hw = t.half[i];
          loops.push([[hw, EDGE_RISE], [hw, WALL_H], [hw + WALL_T, WALL_H], [hw + WALL_T, -BEAM], [-hw - WALL_T, -BEAM], [-hw - WALL_T, WALL_H], [-hw, WALL_H], [-hw, EDGE_RISE]]);
        }
        for (let e = 0; e < 7; e++) {
          const base = sp.length / 3;
          const shade = e === 2 || e === 5 ? 1.0 : e === 4 ? 0.55 : 0.88;
          for (let i = c0; i <= c1; i++) {
            const L = loops[i - c0];
            for (const [px, py] of [L[e], L[e + 1]]) {
              const P = t.P[i], R = t.R[i], U = t.U[i];
              sp.push(P.x + R.x * px + U.x * py, P.y + R.y * px + U.y * py, P.z + R.z * px + U.z * py);
              sc.push(col.r * shade, col.g * shade, col.b * shade);
            }
          }
          for (let i = 0; i < c1 - c0; i++) {
            const A = base + i * 2, B = A + 1, C = A + 2, D = A + 3;
            si.push(A, B, C, B, D, C);
          }
        }
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
      sg.setIndex(si); sg.computeVertexNormals();
      const sm = new THREE.Mesh(sg, shellMat); sm.castShadow = true; sm.receiveShadow = true; this.scene.add(sm);
    }

    // 積木柱子撐住賽道
    const S = 3.4;
    const mats = [];
    const r = mulberry32(5);
    for (let i = 20; i < t.N - 10; i += Math.round(13 / STEP)) {
      if (!t.floor[i]) continue;
      const p = t.P[i];
      const top = p.y - BEAM - 0.2;
      if (top < 2) continue;
      if (this._overlapsProps(p.x - 3, p.x + 3, p.z - 3, p.z + 3)) continue;
      let blocked = false;
      for (let j = 0; j < t.N; j += 3) {
        if (Math.abs(j - i) < 30) continue;
        const q = t.P[j];
        if (q.y < p.y && Math.hypot(q.x - p.x, q.z - p.z) < t.half[j] + 4) { blocked = true; break; }
      }
      if (blocked) continue;
      const n = Math.ceil(top / S);
      const yaw = Math.atan2(-t.T[i].z, t.T[i].x);
      for (let k = 0; k < n; k++) mats.push({ x: p.x, y: Math.min(top - S / 2, k * S + S / 2), z: p.z, yaw, c: TOY[Math.floor(r() * TOY.length)] });
    }
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(S, S, S), new THREE.MeshStandardMaterial({ roughness: 0.5 }), mats.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    mats.forEach((b, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
      inst.setMatrixAt(k, m4.compose(v.set(b.x, b.y, b.z), q, one));
      inst.setColorAt(k, new THREE.Color(b.c));
    });
    inst.castShadow = true; inst.receiveShadow = true;
    this.scene.add(inst);
  }

  _buildObstacles() {
    const t = this.track;
    const crosses = t.zones.flatMap(z => z.crosses);
    const pistons = t.zones.flatMap(z => z.pistons);
    const pegs = t.zones.flatMap(z => z.pegs);

    // 旋轉十字外觀
    const stripe = canvasTex(256, 32, (g, w, h) => {
      for (let x = 0; x < w; x += 32) { g.fillStyle = (x / 32) % 2 ? '#ffffff' : '#e8483f'; g.fillRect(x, 0, 32, h); }
    }, true);
    this.crossMeshes = crosses.map(c => {
      const grp = new THREE.Group();
      const hl = t.half[c.i] - 0.5;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 3.2, 20), new THREE.MeshStandardMaterial({ color: 0xf6b929, roughness: 0.4 }));
      post.position.y = 1.6;
      const tx = stripe.clone(); tx.repeat.set(hl / 2, 1); tx.needsUpdate = true;
      const barMat = new THREE.MeshStandardMaterial({ map: tx, roughness: 0.4 });
      const bar1 = new THREE.Mesh(new THREE.BoxGeometry(hl * 2, 0.5, 0.5), barMat);
      const bar2 = bar1.clone(); bar2.rotation.y = Math.PI / 2;
      bar1.position.y = bar2.position.y = 0.95;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 12), new THREE.MeshStandardMaterial({ color: 0xe8483f }));
      cap.position.y = 3.3;
      for (const m of [post, bar1, bar2, cap]) { m.castShadow = true; grp.add(m); }
      this.scene.add(grp);
      return grp;
    });

    // 跳跳積木：每種顏色一組 InstancedMesh，位置每幀從物理同步
    const S = PISTON.size * 2;
    const geo = new THREE.BoxGeometry(S, S, S);
    const group = (ids, mat) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, ids.length));
      mesh.count = ids.length;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      return { mesh, ids };
    };
    this.pistonGroups = TOY.map((col, k) => group(
      pistons.map((p, n) => p.color === k && !p.gold ? n : -1).filter(n => n >= 0),
      new THREE.MeshStandardMaterial({ map: letterTex('ABCDEF'[k], col), roughness: 0.45 })));
    this.ringSmall = new THREE.RingGeometry(0.32, 0.5, 32);
    this.ringBig = new THREE.RingGeometry(0.72, 0.9, 40);
    // 金色積木：同一列一起閃，每列一組材質
    const goldTex = letterTex('★', 0xe0a000);
    const goldRows = [...new Set(pistons.filter(p => p.gold).map(p => p.row))];
    this.goldGroups = goldRows.map(row => {
      const g = group(pistons.map((p, n) => p.gold && p.row === row ? n : -1).filter(n => n >= 0),
        new THREE.MeshStandardMaterial({ map: goldTex, emissive: 0xff9a00, emissiveIntensity: 0, metalness: 0.5, roughness: 0.3 }));
      this.pistonGroups.push(g);
      // 亮的時候積木上方浮著一大一小兩個金色光圈（彈跳墊的樣子）
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffae00, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
      const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      const rings = g.ids.map(n => {
        const pc = pistons[n];
        const grp = new THREE.Group();
        const small = new THREE.Mesh(this.ringSmall, ringMat), big = new THREE.Mesh(this.ringBig, ringMat);
        big.position.y = 0.25;
        grp.add(small, big);
        grp.quaternion.copy(trackQuat(t, pc.i));
        small.quaternion.copy(flat); big.quaternion.copy(flat);
        this.scene.add(grp);
        return { grp, small, big, id: n };
      });
      return { ...g, row, ringMat, rings };
    });

    // 彈珠台釘子：金屬細柱 + 彩色釘帽
    const pinMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(PEG_R, PEG_R, 2.6, 12), new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.85, roughness: 0.25 }), pegs.length);
    const capMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 16, 10), new THREE.MeshStandardMaterial({ roughness: 0.3 }), pegs.length);
    const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3();
    pegs.forEach((pg, k) => {
      const q = trackQuat(t, pg.i);
      const pos = trackPoint(t, pg.i, pg.lat, floorHeightAt(pg.lat, t.half[pg.i]) + 1.1);
      pinMesh.setMatrixAt(k, m4.compose(pos, q, one));
      capMesh.setMatrixAt(k, m4.compose(pos.clone().add(up.copy(t.U[pg.i]).multiplyScalar(1.35)), q, one));
      capMesh.setColorAt(k, new THREE.Color(TOY[k % TOY.length]));
    });
    pinMesh.castShadow = capMesh.castShadow = true;
    this.scene.add(pinMesh, capMesh);

    // 起跑閘門
    const gi = t.gateI;
    this.gateMesh = new THREE.Mesh(new THREE.BoxGeometry((t.half[gi] + 1) * 2, WALL_H * 2, 0.6), new THREE.MeshStandardMaterial({ color: 0xe8483f, transparent: true, opacity: 0.85 }));
    this.gateMesh.position.copy(trackPoint(t, gi, 0, WALL_H / 2));
    this.gateMesh.quaternion.copy(trackQuat(t, gi));
    this.scene.add(this.gateMesh);
  }

  _arch(i, tex) {
    const t = this.track;
    const hw = t.half[i] + WALL_T + 1.3;
    const q = trackQuat(t, i);
    const grp = new THREE.Group();
    grp.position.copy(t.P[i]); grp.quaternion.copy(q);
    const S = 1.6;
    for (const side of [-1, 1]) for (let k = 0; k < 5; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(S, S, S), new THREE.MeshStandardMaterial({ color: TOY[(k + (side > 0 ? 3 : 0)) % TOY.length], roughness: 0.5 }));
      b.position.set(side * hw, -BEAM + S / 2 + k * S, 0); b.castShadow = true; grp.add(b);
    }
    const top = -BEAM + 5 * S;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + S, 2.4, 0.4), [
      ...Array(4).fill(new THREE.MeshStandardMaterial({ color: 0xffffff })),
      new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ map: tex }),
    ]);
    banner.position.set(0, top + 1.2, 0); banner.castShadow = true;
    grp.add(banner);
    this.scene.add(grp);
    return grp;
  }

  _buildArches() {
    const t = this.track;
    this._arch(t.gateI + 2, bannerTex('起跑 START', null, '#fff7e0', '#e8483f'));
    const look = { cross: ['小心被十字擋下來', '#e8483f'], piston: ['金色積木會把你彈去抄近路', '#35b45b'], pegs: ['彈來彈去看運氣', '#8e5bd6'] };
    t.zones.forEach((z, k) => this._arch(z.i0, bannerTex(`${k + 1}. ${ZONE_INFO[z.type].name}`, look[z.type][0], look[z.type][1], '#ffffff')));
    this._arch(t.finishI, bannerTex('終點 FINISH', null, '#ffffff', '#111', true));
  }

  // ---------- 每場比賽 ----------
  setRace(race) {
    this.race = race;
    for (const c of [...this.marbleGroup.children]) { c.geometry?.dispose(); c.material?.map?.dispose(); c.material?.dispose(); }
    this.marbleGroup.clear();
    const geo = new THREE.SphereGeometry(RADIUS, 32, 20);
    this.meshes = race.marbles.map(m => {
      const mat = new THREE.MeshPhysicalMaterial({
        map: marbleTex(m.color, m.pattern, m.id), roughness: 0.08, metalness: 0.0,
        clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      this.marbleGroup.add(mesh);
      return mesh;
    });
    this.prev = race.marbles.map(m => ({ p: new THREE.Vector3().copy(m.body.translation()), q: new THREE.Quaternion().copy(m.body.rotation()) }));
    this.gateMesh.visible = true;
    this.gateMesh.position.copy(trackPoint(this.track, this.track.gateI, 0, WALL_H / 2));
    this.camInit = false;
    this.yawOffset = 0;
  }

  snapshot() {
    const ms = this.race.marbles;
    for (let k = 0; k < ms.length; k++) {
      if (!ms[k].alive) continue;
      this.prev[k].p.copy(ms[k].body.translation());
      this.prev[k].q.copy(ms[k].body.rotation());
    }
  }

  // 在這些彈珠頭上放箭頭
  setMarked(ids) {
    for (const mk of this.markers) this.scene.remove(mk.mesh);
    this.markers = ids.map(id => {
      const mesh = new THREE.Mesh(this.markerGeo, this.markerMat);
      mesh.rotation.x = Math.PI;
      this.scene.add(mesh);
      return { id, mesh };
    });
  }

  focusMarble() {
    const race = this.race;
    const f = race.marbles[this.focusId];
    if (f && f.alive) return f;
    return race.ranking.find(m => m.alive) || race.ranking[0];
  }

  render(alpha, dt) {
    const race = this.race;
    const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
    race.marbles.forEach((m, k) => {
      const mesh = this.meshes[k];
      if (m.alive) {
        mesh.position.lerpVectors(this.prev[k].p, _p.copy(m.body.translation()), alpha);
        mesh.quaternion.slerpQuaternions(this.prev[k].q, _q.copy(m.body.rotation()), alpha);
        mesh.scale.setScalar(1);
      } else {
        const e = race.time - m.elimT;
        const s = e < 0.15 ? 1 + e * 3 : Math.max(0, 1.45 - (e - 0.15) * 2.5);
        mesh.scale.setScalar(Math.max(0.0001, s));
        mesh.visible = s > 0.01;
      }
    });

    for (let k = 0; k < this.crossMeshes.length; k++) {
      const b = race.crosses[k].body;
      this.crossMeshes[k].position.copy(b.translation());
      this.crossMeshes[k].quaternion.copy(b.rotation());
    }
    const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    for (const { mesh, ids } of this.pistonGroups) {
      ids.forEach((id, k) => {
        const b = race.pistons[id].body;
        mesh.setMatrixAt(k, m4.compose(_p.copy(b.translation()), _q.copy(b.rotation()), one));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    // 金色積木閃光：亮的時候（可以抄近路）發出金光
    for (const g of this.goldGroups) {
      const lit = goldLit(race.pistons[g.ids[0]], race.time);
      const flicker = 0.5 + 0.5 * Math.sin(race.time * 18);
      g.mesh.material.emissiveIntensity = lit ? 0.6 + flicker * 0.5 : 0;
      // 光圈一上一下彈跳，越高越淡
      const bounce = Math.abs(Math.sin(race.time * 6));
      g.ringMat.opacity = 0.95 - bounce * 0.45;
      for (const r of g.rings) {
        r.grp.visible = lit;
        if (!lit) continue;
        const b = race.pistons[r.id].body, uv = this.track.U[race.pistons[r.id].i];
        r.grp.position.copy(b.translation()).addScaledVector(uv, PISTON.size + 0.08 + bounce * 0.7);
        r.big.scale.setScalar(1 + bounce * 0.15);
      }
    }
    if (race.phase === 'race' && this.gateMesh.visible) {
      this.gateMesh.position.addScaledVector(this.track.U[this.track.gateI], -dt * 8);
      if (race.time > 5) this.gateMesh.visible = false;
    }

    // 鏡頭
    // 跟領先者時對準賽道中線，換人領先鏡頭也不會跳；跟某顆彈珠時對準牠
    const fm = this.focusMarble();
    const t = this.track;
    const aim = this.focusId >= 0 && fm.id === this.focusId
      ? this.meshes[fm.id].position
      : trackPoint(t, Math.min(t.N - 1, Math.round(fm.maxS / STEP)), 0, RADIUS, this._aim);
    // 目標點平滑跟隨，上下彈跳跟得更慢，畫面才不會跟著抖
    const target = this.camTarget;
    if (!this.camInit) target.copy(aim);
    const kh = 1 - Math.exp(-dt * 8), kv = 1 - Math.exp(-dt * 3);
    target.x += (aim.x - target.x) * kh; target.z += (aim.z - target.z) * kh; target.y += (aim.y - target.y) * kv;
    // 方向只看前方一段賽道的走向（不看彈珠速度，撞到東西也不會晃）
    const want = this._want.set(0, 0, 0);
    for (let d = 4; d <= 24; d += 4) { const tt = t.T[Math.min(t.N - 1, fm.idx + d)]; want.x += tt.x; want.z += tt.z; }
    want.normalize();
    if (!this.camInit) this.camFwd.copy(want);
    this.camFwd.lerp(want, 1 - Math.exp(-dt * 2)).normalize();
    if (!this.dragging) this.yawOffset *= Math.exp(-dt * 1.2);
    const fwd = this.camFwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOffset);
    this.viewFwd = fwd;

    const cm = CAM_MODES[this.camMode];
    const desired = target.clone().addScaledVector(fwd, -cm.dist);
    desired.y += cm.height;
    const look = target.clone().addScaledVector(fwd, cm.ahead);
    look.y += cm.lift;
    if (!this.camInit) { this.camera.position.copy(desired); this.camLook.copy(look); this.camInit = true; }
    const k = 1 - Math.exp(-dt * 6);
    this.camera.position.lerp(desired, k);
    this.camLook.lerp(look, 1 - Math.exp(-dt * 10));
    this.camera.lookAt(this.camLook);

    // 陽光陰影跟著鏡頭目標，鏡頭越高陰影範圍越大
    const sc = this.sun.shadow.camera;
    if (sc.right !== cm.shadow) {
      sc.left = sc.bottom = -cm.shadow; sc.right = sc.top = cm.shadow;
      sc.updateProjectionMatrix();
    }
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);

    // 下注彈珠的箭頭
    const bob = 1.5 + Math.sin(performance.now() / 200) * 0.15;
    for (const mk of this.markers) {
      mk.mesh.visible = race.marbles[mk.id].alive;
      mk.mesh.position.copy(this.meshes[mk.id].position);
      mk.mesh.position.y += bob;
    }

    this.renderer.render(this.scene, this.camera);
  }

  // 世界座標 → 螢幕座標（顯示名牌用）
  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, visible: p.z < 1 && p.z > -1 };
  }
}

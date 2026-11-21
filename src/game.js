/* ============================================================
 *  追上去！· 追及问题实验室   game.js
 *  六年级 · 平板横屏 · 触控优先
 * ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/* ---------------- 配置 ---------------- */
const CFG = {
  vMing: 4,            // 小明速度 米/秒
  startX: 30,          // 小明先跑 30 米
  finishX: 100,        // 公交站
  segM: 2,             // 追赶绳每格 2 米
  segCount: 15,        // 30 / 2
  minV: 3,
  maxV: 8,
  official: 6,         // 题目里小红的速度
  trackX0: -8,
  trackX1: 108,
  laneMing: -1.35,
  laneHong: 1.35,
};
const RUN_END_T = (CFG.finishX - CFG.startX) / CFG.vMing;   // 17.5 秒
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/RobotExpressive/RobotExpressive.glb';

/* ---------------- 工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const fmt = (n, d = 1) => Number(n).toFixed(d);
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function texFromCanvas(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---------------- 音效（纯 WebAudio，无外部文件） ---------------- */
const Sfx = {
  ctx: null, on: true,
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'sine', vol = 0.12, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },
  tick() { this.tone(820, 0.045, 'square', 0.035); },
  click() { this.tone(560, 0.05, 'sine', 0.06); },
  start() { this.tone(392, 0.12, 'triangle', 0.09); this.tone(523, 0.16, 'triangle', 0.09, 0.12); },
  win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.30, 'triangle', 0.13, i * 0.085)); },
  fail() { [392, 311, 247].forEach((f, i) => this.tone(f, 0.22, 'sawtooth', 0.055, i * 0.13)); },
  reveal() { this.tone(880, 0.2, 'sine', 0.09); this.tone(1318.5, 0.34, 'sine', 0.08, 0.1); },
};

/* ============================================================
 *  3D 场景
 * ============================================================ */
class Lab {
  constructor(canvas) {
    this.canvas = canvas;
    this.W = 1; this.H = 1; this.aspect = 1.6;
    this.camX = 20; this.camW = 46; this.camMode = 'follow';
    this.xM = CFG.startX; this.xR = 0; this.lookY = 4.2;
    this.busHomeX = 0; this.busAwayX = 0; this.busMoving = false;
    this._v = new THREE.Vector3();
    this.mixers = [];
  }

  async init() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);
    this.camTheta = 26 * Math.PI / 180;

    this.buildLights();
    this.buildGround();
    this.buildTrack();
    this.buildProps();
    await this.loadChars();
    this.resize();
    this.updateCamera(0, true, { t: 0, vR: CFG.vMing });
  }

  /* ---------- 灯光 ---------- */
  buildLights() {
    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x6f9a58, 1.05);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff6e8, 1.55);
    dir.position.set(30, 60, 40);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.5);
    fill.position.set(-40, 30, 20);
    this.scene.add(fill);
  }

  /* ---------- 草地 ---------- */
  buildGround() {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(280, 56),
      new THREE.MeshLambertMaterial({ color: 0x8ccb70 })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(50, -0.02, 15);
    this.scene.add(g);

    // 远处的小山丘（贴在草地边缘，露出一条山脊）
    const hillMat1 = new THREE.MeshLambertMaterial({ color: 0x74b463, flatShading: true });
    const hillMat2 = new THREE.MeshLambertMaterial({ color: 0x639e57, flatShading: true });
    const hillGeo = new THREE.SphereGeometry(1, 10, 7);
    const hills = [
      [-46, -14.5, 26, 2.8, hillMat2], [-2, -15, 20, 2.2, hillMat1], [34, -14.5, 24, 3.0, hillMat2],
      [72, -15, 22, 2.4, hillMat1], [108, -14.5, 26, 2.8, hillMat2], [146, -15, 24, 2.6, hillMat1],
    ];
    hills.forEach(([x, z, sx, sy, mat]) => {
      const m = new THREE.Mesh(hillGeo, mat);
      m.position.set(x, -1.0, z);
      m.scale.set(sx, sy, 8);
      this.scene.add(m);
    });
  }

  /* ---------- 跑道 ---------- */
  buildTrack() {
    const W = 2048, H = 256;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const X0 = CFG.trackX0, X1 = CFG.trackX1, LEN = X1 - X0;
    const px = m => (m - X0) / LEN * W;
    const yOf = z => (z + 3.1) / 6.2 * H;

    g.fillStyle = '#d2603f'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3200; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    // 边线
    g.fillStyle = 'rgba(255,253,248,.96)';
    g.fillRect(0, yOf(2.62), W, 4);
    g.fillRect(0, yOf(-2.62), W, 4);
    // 每米刻度
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let m = 0; m <= 108; m++) {
      const x = px(m);
      g.fillRect(x - 1, yOf(2.95), 2, 12);
      g.fillRect(x - 1, yOf(-3.02), 2, 9);
    }
    // 每 10 米粗刻度
    g.fillStyle = 'rgba(255,255,255,.9)';
    for (let m = 0; m <= 100; m += 10) {
      const x = px(m);
      g.fillRect(x - 1.5, yOf(2.95), 3, 22);
      g.fillRect(x - 1, yOf(-3.05), 2, 15);
    }
    // 起跑线
    g.fillStyle = '#fffaf3';
    g.fillRect(px(0) - 2, 0, 5, H);
    // 小明先跑的 30 米标记（虚线）
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (let y = 0; y < H; y += 22) g.fillRect(px(30) - 2, y, 4, 11);
    // 终点棋盘格
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? '#fffaf3' : '#1b2c4a';
      g.fillRect(px(100) - 9 + i * 6, 0, 6, H);
    }

    const tex = texFromCanvas(c);
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(LEN, 6.2),
      new THREE.MeshLambertMaterial({ map: tex })
    );
    track.rotation.x = -Math.PI / 2;
    track.position.set((X0 + X1) / 2, 0.012, 0);
    this.scene.add(track);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(LEN, 0.2, 6.4),
      new THREE.MeshLambertMaterial({ color: 0xa8462f })
    );
    base.position.set((X0 + X1) / 2, -0.1, 0);
    this.scene.add(base);
  }

  makeSign(text, bg, fg) {
    const S = 160;
    const c = document.createElement('canvas'); c.width = S; c.height = 84;
    const g = c.getContext('2d');
    g.fillStyle = bg; roundRect(g, 2, 2, S - 4, 80, 26); g.fill();
    if (bg === '#ffffff') { g.strokeStyle = 'rgba(18,32,58,.16)'; g.lineWidth = 3; g.stroke(); }
    g.fillStyle = fg;
    g.font = '800 48px "PingFang SC","Noto Sans SC",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, S / 2, 45);
    const tex = texFromCanvas(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(2.1, 1.1, 1);
    return sp;
  }

  /* ---------- 场景道具 ---------- */
  buildProps() {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6243, flatShading: true });
    const leaf1 = new THREE.MeshLambertMaterial({ color: 0x4fa35a, flatShading: true });
    const leaf2 = new THREE.MeshLambertMaterial({ color: 0x63b96a, flatShading: true });
    const tree = (x, z, s) => {
      const grp = new THREE.Group();
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.22 * s, 1.2 * s, 6), trunkMat);
      tr.position.y = 0.6 * s;
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.95 * s, 1.9 * s, 7), leaf1);
      c1.position.y = 1.8 * s;
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.7 * s, 1.5 * s, 7), leaf2);
      c2.position.y = 2.75 * s;
      grp.add(tr, c1, c2);
      grp.position.set(x, 0, z);
      this.scene.add(grp);
    };
    const spots = [[-8, -12.5, 1.15], [10, -10.5, 0.8], [16, -15.5, 1.0], [40, -11, 0.95],
      [46, -15, 1.25], [66, -12, 0.85], [84, -10.5, 0.9], [96, -15.5, 1.1],
      [124, -12, 1.0], [-26, -13, 1.0], [144, -14, 1.1], [58, -9.5, 0.7],
      [-2, -8.6, 0.72], [7, -9.2, 0.62], [24, -8.8, 0.68], [33, -11.5, 0.9],
      [52, -8.4, 0.6], [76, -9, 0.72], [90, -11, 0.85], [112, -9.2, 0.65]];
    spots.forEach(([x, z, s]) => tree(x, z, s));

    // 远侧护栏
    const railMat = new THREE.MeshLambertMaterial({ color: 0xf4f7fc });
    [0.52, 0.92].forEach(y => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(116, 0.07, 0.07), railMat);
      rail.position.set(50, y, -4.75);
      this.scene.add(rail);
    });
    const fencePostGeo = new THREE.BoxGeometry(0.09, 1.02, 0.09);
    const posts = new THREE.InstancedMesh(fencePostGeo, railMat, 30);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 30; i++) {
      mtx.makeTranslation(-8 + i * 4, 0.51, -4.75);
      posts.setMatrixAt(i, mtx);
    }
    posts.instanceMatrix.needsUpdate = true;
    this.scene.add(posts);

    // 终点拱门
    const postMat = new THREE.MeshLambertMaterial({ color: 0xf2f5fb, flatShading: true });
    const postGeo = new THREE.BoxGeometry(0.34, 4.6, 0.34);
    [-4.15, 4.15].forEach(z => {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(100, 2.3, z);
      this.scene.add(p);
    });
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 512; bannerCanvas.height = 128;
    const bg = bannerCanvas.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
      bg.fillStyle = (i + j) % 2 ? '#ffffff' : '#1b2c4a';
      bg.fillRect(i * 32, j * 32, 32, 32);
    }
    bg.fillStyle = 'rgba(255,255,255,.94)';
    roundRect(bg, 132, 34, 248, 60, 18); bg.fill();
    bg.fillStyle = '#12203a';
    bg.font = '800 40px "PingFang SC","Noto Sans SC",sans-serif';
    bg.textAlign = 'center'; bg.textBaseline = 'middle';
    bg.fillText('终点 · 公交站', 256, 66);
    const bTex = texFromCanvas(bannerCanvas);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(8.6, 2.0),
      new THREE.MeshLambertMaterial({ map: bTex, side: THREE.DoubleSide })
    );
    banner.position.set(100, 4.6, 0);
    this.scene.add(banner);

    // 公交站台
    const shelterMat = new THREE.MeshLambertMaterial({ color: 0x4f6b8f, flatShading: true });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0xbfe0f5, transparent: true, opacity: 0.55 });
    [-5.9, -2.6].forEach(z => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), shelterMat);
      p.position.set(101.6, 1.3, z);
      this.scene.add(p);
    });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 3.9), shelterMat);
    roof.position.set(101.6, 2.62, -4.25);
    this.scene.add(roof);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 3.5), glassMat);
    back.position.set(102.3, 1.0, -4.25);
    this.scene.add(back);

    // 末班车
    const bus = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xf5b731, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 2.6), bodyMat);
    body.position.y = 1.7;
    const winMat = new THREE.MeshLambertMaterial({ color: 0x2b4a6b });
    const win = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.95, 2.66), winMat);
    win.position.y = 2.15;
    const roofBox = new THREE.Mesh(new THREE.BoxGeometry(9, 0.22, 2.6),
      new THREE.MeshLambertMaterial({ color: 0xd99a1e }));
    roofBox.position.y = 3.06;
    const wMat = new THREE.MeshLambertMaterial({ color: 0x2c3446 });
    [[-3, 0.45], [3, 0.45], [-3, -0.45], [3, -0.45]].forEach(() => { });
    [3.1, -3.1].forEach(x => {
      [1.3, -1.3].forEach(z => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.32, 10), wMat);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.55, z);
        bus.add(wheel);
      });
    });
    bus.add(body, win, roofBox);
    bus.position.set(104.6, 0, -5.6);
    this.scene.add(bus);
    this.bus = bus;
    this.busHomeX = 104.6;

    // 站牌
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6),
      new THREE.MeshLambertMaterial({ color: 0x9aa7b8 }));
    pole.position.set(100.6, 1.5, -3.3);
    this.scene.add(pole);
    const sign = this.makeSign('末班车', '#2f7cf6', '#ffffff');
    sign.position.set(100.6, 3.2, -3.3);
    sign.scale.set(1.7, 1.7, 1);
    this.scene.add(sign);
  }

  /* ---------- 角色 ---------- */
  async loadChars() {
    let gltf = null;
    try {
      gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    } catch (e) {
      console.warn('模型加载失败，使用简化角色', e);
    }
    if (gltf) {
      this.ming = this.makeChar(gltf, 0x5a9bff, '小明', CFG.laneMing);
      this.hong = this.makeChar(gltf, 0xff8b5e, '小红', CFG.laneHong);
    } else {
      this.ming = this.makeCapsuleChar(0x4a86f0, CFG.laneMing);
      this.hong = this.makeCapsuleChar(0xff7a45, CFG.laneHong);
    }
  }

  makeChar(gltf, tint, name, lane) {
    const src = gltf.scene;
    const root = skeletonClone(src);
    // 统一尺寸
    root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(root);
    const h = Math.max(0.001, bb.max.y - bb.min.y);
    const s = 2.8 / h;
    root.scale.setScalar(s);
    root.updateMatrixWorld(true);
    bb.setFromObject(root);

    const holder = new THREE.Group();
    root.position.y = -bb.min.y;
    holder.add(root);
    holder.position.set(0, 0, lane);
    this.scene.add(holder);

    // 上色
    root.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const out = mats.map(m => {
          const nm = m.clone();
          if (nm.color) nm.color.setHex(tint);
          nm.roughness = 0.72;
          nm.metalness = 0.05;
          return nm;
        });
        o.material = Array.isArray(o.material) ? out : out[0];
      }
    });

    // 影子
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 18),
      new THREE.MeshBasicMaterial({ color: 0x1c3320, transparent: true, opacity: 0.20, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.02, 0);
    shadow.scale.set(1.15, 0.55, 1);
    holder.add(shadow);

    // 动画
    const mixer = new THREE.AnimationMixer(root);
    this.mixers.push(mixer);
    const actions = {};
    const wanted = ['Idle', 'Walking', 'Running', 'Dance', 'ThumbsUp', 'Wave', 'Jump', 'Standing', 'Yes'];
    wanted.forEach(w => {
      const clip = gltf.animations.find(c => c.name.toLowerCase() === w.toLowerCase());
      if (clip) {
        const a = mixer.clipAction(clip);
        a.setLoop(THREE.LoopRepeat, Infinity);
        actions[w] = a;
      }
    });
    const ch = { holder, root, mixer, actions, current: '', pose: '', lane, tint, name };
    this.setAnim(ch, 'Idle', 0);
    ch.baseRotY = Math.PI / 2;
    root.rotation.y = ch.baseRotY;
    return ch;
  }

  makeCapsuleChar(tint, lane) {
    const holder = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: tint });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.55, 4, 10), mat);
    body.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12),
      new THREE.MeshLambertMaterial({ color: 0xffd9b8 }));
    head.position.y = 1.55;
    holder.add(body, head);
    holder.position.set(0, 0, lane);
    this.scene.add(holder);
    return { holder, root: holder, mixer: null, actions: {}, current: '', pose: '', lane, name: '' };
  }

  setAnim(ch, name, fade = 0.22) {
    if (!ch || !ch.actions) return;
    const next = ch.actions[name];
    if (!next || ch.current === name) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    const prev = ch.actions[ch.current];
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    ch.current = name;
  }

  setPose(ming, hong) {
    if (this._poseM !== ming) { this.setAnim(this.ming, ming); this._poseM = ming; }
    if (this._poseH !== hong) { this.setAnim(this.hong, hong); this._poseH = hong; }
  }

  /* ---------- 每帧 ---------- */
  update(dt, st) {
    const p = this.posAt(st.t, st.vR);
    this.xM = p.xM; this.xR = p.xR;

    if (this.ming) this.ming.holder.position.x = p.xM;
    if (this.hong) this.hong.holder.position.x = p.xR;

    // 姿态
    if (st.cheer) this.setPose('Idle', 'ThumbsUp');
    else if (st.playing) this.setPose('Running', 'Running');
    else this.setPose('Idle', 'Idle');

    // 跑步动画速度随速度变化
    if (this.ming && this.ming.actions.Running) {
      this.ming.actions.Running.timeScale = clamp(CFG.vMing / 4, 0.5, 2.2);
      this.ming.actions.Running.setEffectiveWeight(1);
    }
    if (this.hong && this.hong.actions.Running) {
      this.hong.actions.Running.timeScale = clamp(st.vR / 4, 0.5, 2.4);
    }
    this.mixers.forEach(m => m.update(dt));

    // 公交车离站
    if (this.busMoving && this.bus) {
      this.bus.position.x += dt * 26;
    } else if (this.bus) {
      this.bus.position.x = this.busHomeX;
    }

    this.updateCamera(dt, false, st);
  }

  posAt(t, vR) {
    const xM = Math.min(CFG.startX + CFG.vMing * t, CFG.finishX);
    const xR = Math.min(vR * t, CFG.finishX);
    return { xM, xR, gap: Math.max(0, xM - xR) };
  }

  updateCamera(dt, instant, st) {
    let tw, tx;
    if (this.camMode === 'xiaoming') { tw = 44; tx = this.xM - 10; }
    else if (this.camMode === 'proof') { tw = 32; tx = 94; }
    else if (this.camMode === 'wide') { tw = 58; tx = 26; }
    else { tw = 40; tx = (this.xM + this.xR) / 2; }   // 固定画框：1 米 = 固定像素
    tx = clamp(tx, tw * 0.5 - 8, 106 - tw * 0.5 + 8);
    const k = this.camMode === 'xiaoming' ? 16 : 5.5;
    const targetLy = 4.2 - (st && st.sheetLift ? 4.4 : 0);
    if (instant) { this.camX = tx; this.camW = tw; this.lookY = targetLy; }
    else {
      this.camX = damp(this.camX, tx, k, dt);
      this.camW = damp(this.camW, tw, k, dt);
      this.lookY = damp(this.lookY, targetLy, 7, dt);
    }
    this.applyFrustum();
    const D = 64, th = this.camTheta;
    this.camera.position.set(this.camX, D * Math.sin(th), D * Math.cos(th));
    this.camera.lookAt(this.camX, this.lookY, 0);
    this.camera.updateMatrixWorld(true);   // 立刻刷新，保证投影可用
  }

  applyFrustum() {
    if (!this.camera) return;
    const hw = this.camW / 2, hh = hw / this.aspect;
    const c = this.camera;
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    c.updateProjectionMatrix();
  }

  resize() {
    if (!this.renderer) return;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.aspect = this.W / this.H;
    this.renderer.setSize(this.W, this.H, false);
    this.applyFrustum();
  }

  render() { if (this.renderer) this.renderer.render(this.scene, this.camera); }

  project(x, y, z) {
    const v = this._v.set(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.W, y: (-v.y * 0.5 + 0.5) * this.H, z: v.z };
  }

  resetRun() {
    this.busMoving = false;
    this._poseM = this._poseH = '';
    if (this.bus) this.bus.position.x = this.busHomeX;
  }
  busAway() { this.busMoving = true; }
  cheer() { this.setPose('Idle', 'ThumbsUp'); }
}

/* ============================================================
 *  状态
 * ============================================================ */
const G = {
  phase: 'cover',
  t: 0,
  vR: CFG.vMing,
  playing: false,
  caught: false,
  cheer: false,
  rate: 1,
  prediction: null,
  officialDone: false,
  runCount: 0,
  runs: [],
  badges: new Set(),
  usedScrub: false,
  muted: false,
  reframeStarted: false,
  eggDone: false,
};

let lab = null;
let lastRemaining = CFG.segCount;

/* ---------- DOM ---------- */
const el = {};
function cacheDom() {
  ['gl', 'tagMing', 'tagHong', 'tagGap', 'hud', 'panel', 'vTime', 'vGap', 'vSeg', 'vSpeed',
    'rope', 'btnMinus', 'btnPlus', 'btnRun', 'btnLog', 'btnRate', 'btnMute', 'statThird',
    'hint', 'banner', 'bannerSwitch', 'bannerClose', 'scrCover', 'scrPredict', 'scrEnd',
    'sheetResult', 'sheetProof', 'sheetLog', 'loading', 'loadTxt', 'fx', 'rotate',
    'optWrap', 'btnStart', 'resultCard', 'proofCard', 'logCard', 'endTitle', 'endLead',
    'badgeWrap', 'eggOpts', 'eggAns', 'btnAgain', 'btnFinish', 'rulerTicks', 'rlMing', 'rlHong', 'rfbar', 'rfGap'].forEach(id => {
      const node = document.getElementById(id);
      if (node) el[id] = node;
    });
  el.segs = [];
  el.tagMingM = el.tagMing && el.tagMing.querySelector('.m');
  el.tagHongM = el.tagHong && el.tagHong.querySelector('.m');
  el.tagGapM = el.tagGap && el.tagGap.querySelector('.m');
}

/* ---------- 文本节流 ---------- */
const _txt = new WeakMap();
function setText(node, str) {
  if (!node) return;
  if (_txt.get(node) === str) return;
  _txt.set(node, str);
  node.textContent = str;
}
function setHTML(node, str) {
  if (!node) return;
  if (_txt.get(node) === str) return;
  _txt.set(node, str);
  node.innerHTML = str;
}

/* ============================================================
 *  模拟
 * ============================================================ */
function catchTime(vR) { return vR > CFG.vMing ? CFG.startX / (vR - CFG.vMing) : Infinity; }
function isCatchable(vR) { return catchTime(vR) <= RUN_END_T + 1e-9; }
function endTime(vR) { return Math.min(catchTime(vR), RUN_END_T); }
function simAt(t, vR) {
  const xM = Math.min(CFG.startX + CFG.vMing * t, CFG.finishX);
  const xR = Math.min(vR * t, CFG.finishX);
  return { xM, xR, gap: Math.max(0, xM - xR) };
}

/* ============================================================
 *  HUD / 追赶绳 / 标签
 * ============================================================ */
function buildRuler() {
  if (!el.rulerTicks) return;
  el.rulerTicks.innerHTML = '';
  for (let m = 0; m <= 100; m += 10) {
    const big = document.createElement('i');
    big.className = 'big'; big.style.left = m + '%';
    el.rulerTicks.appendChild(big);
    const sp = document.createElement('span');
    sp.textContent = m; sp.style.left = m + '%';
    el.rulerTicks.appendChild(sp);
    if (m < 100) {
      for (let k = 1; k < 5; k++) {
        const j = document.createElement('i');
        j.style.left = (m + k * 2) + '%';
        el.rulerTicks.appendChild(j);
      }
    }
  }
}

function buildRope() {
  el.rope.innerHTML = '';
  el.segs = [];
  for (let i = 0; i < CFG.segCount; i++) {
    const d = document.createElement('div');
    d.className = 'seg';
    const f = document.createElement('i');
    d.appendChild(f);
    el.rope.appendChild(d);
    el.segs.push(f);
  }
}
function updateRope(gap) {
  const remaining = clamp(gap / CFG.segM, 0, CFG.segCount);
  for (let i = 0; i < el.segs.length; i++) {
    const k = clamp(remaining - (CFG.segCount - 1 - i), 0, 1);
    const f = el.segs[i];
    const prev = ROPE_K[i];
    if (Math.abs(prev - k) < 0.004) continue;
    ROPE_K[i] = k;
    f.style.transform = k > 0.001 ? `scaleX(${k.toFixed(3)})` : 'scaleX(0)';
  }
  const n = Math.ceil(remaining - 1e-6);
  setText(el.vSeg, String(n));
}
const ROPE_K = new Array(CFG.segCount).fill(-1);

function updateHUD() {
  const p = simAt(G.t, G.vR);
  setText(el.vTime, fmt(G.t));
  setText(el.vGap, fmt(p.gap));
  updateRope(p.gap);
  if (el.rlMing) el.rlMing.style.left = p.xM + '%';
  if (el.rlHong) el.rlHong.style.left = p.xR + '%';
  if (G.phase === 'reframe') setText(el.rfGap, fmt(p.gap));
  // 第三次统计
  if (lab && lab.camMode === 'xiaoming') {
    setHTML(el.statThird, `<span class="lb">靠近</span><b>${fmt(G.vR - CFG.vMing)}</b><span class="u">米/秒</span>`);
  } else {
    setHTML(el.statThird, `<span class="lb">小明</span><b>4</b><span class="u">米/秒</span>`);
  }
}

function placeTag(node, pt, show = true) {
  if (!node) return;
  if (!show || pt.z > 1) { node.style.opacity = '0'; return; }
  node.style.opacity = '1';
  node.style.transform = `translate3d(${pt.x.toFixed(1)}px,${pt.y.toFixed(1)}px,0) translate(-50%,-100%)`;
}

function updateLabels() {
  if (!lab) return;
  const active = (G.phase === 'lab' || G.phase === 'reframe');
  if (!active) {
    el.tagMing.style.opacity = '0';
    el.tagHong.style.opacity = '0';
    el.tagGap.style.display = 'none';
    return;
  }
  const p = simAt(G.t, G.vR);
  const pm = lab.project(p.xM, 3.45, CFG.laneMing);
  const ph = lab.project(p.xR, 3.45, CFG.laneHong);
  placeTag(el.tagMing, pm);
  placeTag(el.tagHong, ph);
  setText(el.tagMingM, `${fmt(p.xM)} 米`);
  setText(el.tagHongM, `${fmt(p.xR)} 米`);

  const mid = (p.xM + p.xR) / 2;
  const pg = lab.project(mid, 1.75, 0);
  const showGap = p.gap > 0.6;
  el.tagGap.style.display = showGap ? 'flex' : 'none';
  if (showGap) {
    setText(el.tagGapM, `${fmt(p.gap)} 米`);
    el.tagGap.style.opacity = '1';
    el.tagGap.style.transform = `translate3d(${pg.x.toFixed(1)}px,${pg.y.toFixed(1)}px,0) translate(-50%,-50%)`;
  }
}

/* ============================================================
 *  流程控制
 * ============================================================ */
function hideScreens() {
  $$('.screen').forEach(s => s.classList.add('hidden'));
}
function showScreen(id) {
  hideScreens();
  const n = document.getElementById(id);
  if (n) { n.classList.remove('hidden'); n.classList.remove('fade-out'); }
}
function hideSheets() {
  ['sheetResult', 'sheetProof', 'sheetLog'].forEach(id => el[id] && el[id].classList.add('hidden'));
  G.sheetLift = false;
  if (G.phase === 'lab') el.panel.classList.remove('hidden');
  if (G.phase === 'reframe' && el.rfbar) el.rfbar.classList.remove('hidden');
}
function showSheet(id) {
  hideSheets();
  el[id].classList.remove('hidden');
  G.sheetLift = true;
  el.panel.classList.add('hidden');
  if (el.rfbar) el.rfbar.classList.add('hidden');
}

let hintTimer = 0;
function toast(msg, ms = 2600) {
  if (!el.hint) return;
  el.hint.textContent = msg;
  el.hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.hint.classList.remove('show'), ms);
}

function setPhase(phase) {
  G.phase = phase;
  const inLab = phase === 'lab' || phase === 'reframe';
  el.hud.classList.toggle('hidden', !inLab);
  el.panel.classList.toggle('hidden', phase !== 'lab');
  if (el.rfbar) el.rfbar.classList.toggle('hidden', phase !== 'reframe');
  el.tagMing.style.opacity = inLab ? '1' : '0';
  el.tagHong.style.opacity = inLab ? '1' : '0';
  if (!inLab) el.tagGap.style.display = 'none';
}

function startGame() {
  Sfx.init();
  Sfx.click();
  el.scrCover.classList.add('fade-out');
  setTimeout(() => {
    hideScreens();
    showScreen('scrPredict');
  }, 220);
}

function choosePrediction(v) {
  G.prediction = v;
  Sfx.click();
  $$('#optWrap .opt').forEach(b => b.classList.toggle('chosen', Number(b.dataset.v) === v));
  setTimeout(() => {
    hideScreens();
    enterLab();
    toast(`先把小红调到 6 米/秒，起跑看看`, 3400);
  }, 260);
}

function enterLab() {
  hideScreens();
  hideSheets();
  setPhase('lab');
  G.t = 0; G.playing = false; G.caught = false; G.cheer = false;
  G.vR = 4;
  el.vSpeed.textContent = '4';
  lab.resetRun();
  lab.camMode = 'follow';
  lab.updateCamera(0, true, G);
  updateHUD();
}

function setSpeed(v) {
  if (G.playing) return;
  G.vR = clamp(v, CFG.minV, CFG.maxV);
  setText(el.vSpeed, String(G.vR));
  setText(el.vGap, fmt(simAt(G.t, G.vR).gap));
  Sfx.click();
  if (G.vR <= CFG.vMing) toast('小红和小明一样快（或更慢）… 这样追得上吗？', 2600);
}

function startRun() {
  if (G.playing) return;
  Sfx.init();
  G.t = 0; G.playing = true; G.caught = false; G.cheer = false;
  G.phase = (lab.camMode === 'xiaoming') ? 'reframe' : 'lab';
  lab.resetRun();
  el.btnRun.textContent = '⏸ 暂停';
  lastRemaining = CFG.segCount;
  Sfx.start();
}

function pauseRun() {
  G.playing = false;
  el.btnRun.textContent = '▶ 继续';
}

function resumeRun() {
  G.playing = true;
  el.btnRun.textContent = '⏸ 暂停';
}

function finishRun() {
  G.playing = false;
  const ct = catchTime(G.vR);
  const caught = isCatchable(G.vR);
  G.caught = caught;
  G.t = endTime(G.vR);
  el.btnRun.textContent = '▶ 起跑';

  const p = simAt(G.t, G.vR);
  if (caught) {
    G.cheer = true;
    Sfx.win();
    const pt = lab.project(p.xM, 1.25, 0);
    burst(pt.x, pt.y);
  } else {
    Sfx.fail();
    lab.busAway();
  }

  // 记录
  G.runs.push({ vR: G.vR, caught, t: G.t, gap: p.gap });
  G.runCount++;
  if (G.runCount >= 3) G.badges.add('lab');
  if (caught && G.vR === CFG.official) {
    G.officialDone = true;
    G.badges.add('guess2');
  }

  if (G.phase === 'reframe') {
    setTimeout(showReframeDone, caught ? 1500 : 900);
  } else {
    setTimeout(() => showResult(caught), caught ? 1250 : 900);
  }
}

/* ---------- 结果 ---------- */
function showResult(caught) {
  const p = simAt(G.t, G.vR);
  const dv = G.vR - CFG.vMing;
  const tEnd = G.t;

  let icon, title, cls, sub;
  if (caught) {
    icon = '🎉'; title = '追上了！'; cls = 'good';
    sub = `小红跑了 <b>${fmt(tEnd)}</b> 秒，在 <b>${fmt(p.xM)}</b> 米处追上小明。`;
  } else {
    icon = '😮'; title = '没追上'; cls = 'bad';
    if (dv <= 0) sub = `小红的速度不比小明快，差距一点都不会变小。`;
    else sub = `小红每秒只追近 <b>${fmt(dv)}</b> 米，${fmt(RUN_END_T)} 秒只追近 <b>${fmt(dv * RUN_END_T)}</b> 米，还差 <b>${fmt(p.gap)}</b> 米。`;
  }

  const stat1 = `<div><span>速度差</span><b>${fmt(Math.max(dv, 0))} 米/秒</b></div>`;
  const stat2 = caught
    ? `<div><span>一共追近</span><b>30 米</b></div>`
    : `<div><span>还差</span><b>${fmt(p.gap)} 米</b></div>`;
  const stat3 = `<div class="accent"><span>用时</span><b>${fmt(tEnd)} 秒</b></div>`;

  let actions = '';
  if (caught && G.vR === CFG.official) {
    actions = `<button class="btn ghost" id="rAgain">再换个速度</button>
               <button class="btn primary" id="rNext">继续 →</button>`;
  } else if (caught) {
    actions = `<button class="btn ghost" id="rAgain">再试一个</button>
               <button class="btn primary" id="rOfficial">按题目 6 米/秒 →</button>`;
  } else {
    actions = `<button class="btn ghost" id="rAgain">再试一次</button>
               <button class="btn primary" id="rOfficial">按题目 6 米/秒 →</button>`;
  }

  el.resultCard.innerHTML = `
    <div class="res-head">
      <div class="res-icon">${icon}</div>
      <div><h3 class="${cls}">${title}</h3><p>${sub}</p></div>
    </div>
    <div class="res-stats">${stat1}${stat2}${stat3}</div>
    <div class="scrub-wrap">
      <div class="scrub-label"><span>拖一拖，看看每一秒</span><b id="scrubVal">第 ${fmt(tEnd)} 秒</b></div>
      <input class="scrub" id="scrub" type="range" min="0" max="${tEnd.toFixed(2)}" step="0.1" value="${tEnd.toFixed(2)}">
    </div>
    <div class="res-actions">${actions}</div>`;

  showSheet('sheetResult');

  const scrub = $('#scrub');
  const scrubVal = $('#scrubVal');
  const paintScrub = () => {
    if (!scrub) return;
    const p = (Number(scrub.value) - Number(scrub.min)) / (Number(scrub.max) - Number(scrub.min)) * 100;
    scrub.style.backgroundSize = `${p}% 12px,100% 12px`;
  };
  paintScrub();
  if (scrub) {
    scrub.addEventListener('input', () => {
      paintScrub();
      const v = parseFloat(scrub.value);
      G.t = v;
      G.playing = false;
      G.cheer = false;
      lab.resetRun();
      G.badges.add('scrub');
      G.usedScrub = true;
      const sp = simAt(v, G.vR);
      scrubVal.textContent = `第 ${fmt(v)} 秒 · 还差 ${fmt(sp.gap)} 米`;
      updateHUD();
    });
  }
  const again = $('#rAgain');
  if (again) again.addEventListener('click', () => {
    Sfx.click(); hideSheets();
    G.t = 0; G.cheer = false; lab.resetRun(); updateHUD();
  });
  const official = $('#rOfficial');
  if (official) official.addEventListener('click', () => {
    Sfx.click(); hideSheets();
    G.vR = CFG.official;
    setText(el.vSpeed, String(G.vR));
    G.t = 0; G.cheer = false; lab.resetRun();
    startRun();
  });
  const next = $('#rNext');
  if (next) next.addEventListener('click', () => { Sfx.click(); nextStep(); });
}

function nextStep() {
  hideSheets();
  if (G.prediction && G.prediction !== 15) showTheater();
  else showReframeIntro();
}

/* ---------- 错误剧场 ---------- */
function showTheater() {
  const t = G.prediction;
  G.t = t; G.playing = false; G.cheer = false;
  lab.resetRun();
  updateHUD();
  const p = simAt(t, CFG.official);

  el.resultCard = $('#resultCard');
  el.resultCard.innerHTML = `
    <div class="res-head">
      <div class="res-icon">🔍</div>
      <div><h3>你猜的是 ${t} 秒</h3>
      <p>那我们看看第 <b>${t}</b> 秒：小红在 <b>${fmt(p.xR)}</b> 米，小明已经到 <b>${fmt(p.xM)}</b> 米了，还差 <b>${fmt(p.gap)}</b> 米。</p></div>
    </div>
    <div class="res-stats">
      <div><span>小红</span><b>${fmt(p.xR)} 米</b></div>
      <div><span>小明</span><b>${fmt(p.xM)} 米</b></div>
      <div class="accent"><span>还差</span><b>${fmt(p.gap)} 米</b></div>
    </div>
    <p style="font-size:15px;color:var(--ink2);margin:0 0 4px">要真正追上，两个人都得跑到 <b style="color:var(--ink)">90 米</b>。第 ${t} 秒还差得远呢。</p>
    <div class="res-actions"><button class="btn primary" id="thNext">原来如此，继续 →</button></div>`;
  showSheet('sheetResult');
  $('#thNext').addEventListener('click', () => { Sfx.click(); showReframeIntro(); });
}

/* ---------- 小明视角 ---------- */
function showReframeIntro() {
  el.proofCard.innerHTML = `
    <div class="res-head">
      <div class="res-icon">🎥</div>
      <div><h3>最后一件事：坐上小明的肩膀</h3>
      <p>换成小明的视角，小明看起来一动不动，只有小红在靠近。<br>猜猜：这样看，追上还会是 15 秒吗？</p></div>
    </div>
    <div class="res-actions"><button class="btn blue" id="rfGo">出发 →</button></div>`;
  showSheet('sheetProof');

  $('#rfGo').addEventListener('click', () => {
    Sfx.click();
    hideSheets();
    startReframe();
  });
}

function startReframe() {
  setPhase('reframe');
  lab.camMode = 'xiaoming';
  lab.updateCamera(0, true, { t: 0, vR: CFG.official });
  G.t = 0; G.vR = CFG.official; G.playing = true; G.caught = false; G.cheer = false;
  G.reframeStarted = true;
  G.badges.add('cam');
  lab.resetRun();
  el.banner.classList.remove('hidden');
  el.banner.querySelector('.t').innerHTML = '🎥 你坐在小明的肩膀上：小明看起来不动，<em>小红每秒靠近 2 米</em>';
  el.bannerSwitch.textContent = '切回正常视角';
  updateHUD();
  Sfx.start();
}

function toggleBannerCam() {
  Sfx.click();
  if (lab.camMode === 'xiaoming') {
    lab.camMode = 'follow';
    el.banner.querySelector('.t').innerHTML = '👀 正常视角：两个人都跑得好快，<em>差距每秒缩小 2 米</em>';
    el.bannerSwitch.textContent = '回到小明视角';
  } else {
    lab.camMode = 'xiaoming';
    el.banner.querySelector('.t').innerHTML = '🎥 你坐在小明的肩膀上：小明看起来不动，<em>小红每秒靠近 2 米</em>';
    el.bannerSwitch.textContent = '切回正常视角';
  }
  G.badges.add('cam');
}

function showReframeDone() {
  el.banner.classList.add('hidden');
  setPhase('reframe');
  const p = simAt(G.t, CFG.official);
  el.proofCard.innerHTML = `
    <div class="res-head">
      <div class="res-icon">⏱️</div>
      <div><h3 class="good">还是 15 秒</h3>
      <p>换了个视角，秒数一点没变。<br>因为 30 米里正好有 <b>15 个 2 米</b>，每个 2 米要花 1 秒。</p></div>
    </div>
    <div class="res-stats">
      <div><span>每秒靠近</span><b>2 米</b></div>
      <div><span>要靠近</span><b>30 米</b></div>
      <div class="accent"><span>需要</span><b>15 秒</b></div>
    </div>
    <div class="res-actions"><button class="btn primary" id="pfGo">看看为什么 →</button></div>`;
  showSheet('sheetProof');
  $('#pfGo').addEventListener('click', () => { Sfx.click(); showProof(); });
}

/* ---------- 证明 ---------- */
function showProof() {
  lab.camMode = 'proof';
  lab.updateCamera(0, true, { t: G.t, vR: CFG.official });
  G.t = 15; G.cheer = true;
  el.banner.classList.add('hidden');
  updateHUD();
  const pt = lab.project(90, 1.25, 0);
  burst(pt.x, pt.y);
  setTimeout(() => {
    el.tagMing.classList.add('pulse');
    el.tagHong.classList.add('pulse');
    Sfx.reveal();
    setTimeout(() => { el.tagMing.classList.remove('pulse'); el.tagHong.classList.remove('pulse'); }, 700);
  }, 300);

  el.proofCard.innerHTML = `
    <div class="res-head">
      <div class="res-icon">🧮</div>
      <div><h3>两个 90</h3><p>第 15 秒，两个人站在同一个位置。</p></div>
    </div>
    <div class="eqs">
      <div class="eq ming"><span class="who">小明</span><span>30 + 4 × 15 = <b>90</b> 米</span></div>
      <div class="eq hong"><span class="who">小红</span><span>6 × 15 = <b>90</b> 米</span></div>
      <div class="eq done"><span class="who">所以</span><span>两个 90 米，追上了！</span></div>
    </div>
    <div class="formula">30 ÷ (6 − 4) = <b>15</b> 秒</div>
    <div class="res-actions"><button class="btn primary" id="prEnd">我发现了 →</button></div>`;
  showSheet('sheetProof');
  $('#prEnd').addEventListener('click', () => { Sfx.click(); showEnd(); });
}

/* ---------- 结课 ---------- */
function showEnd() {
  hideSheets();
  setPhase('end');
  lab.camMode = 'wide';
  lab.updateCamera(0, true, G);
  const correct = G.prediction === 15;
  if (correct) G.badges.add('guess');
  el.endTitle.textContent = correct ? '你一开始就猜对了！' : '你发现了追及的秘密';
  el.endLead.innerHTML = correct
    ? '但更重要的是：现在你能说出<b>为什么</b>是 15 秒了。'
    : `你一开始猜的是 <b>${G.prediction}</b> 秒，正确答案是 <b>15</b> 秒。<br>差别就在“每秒追近 2 米”这件事上。`;

  $$('#badgeWrap .badge').forEach(b => {
    b.classList.toggle('on', G.badges.has(b.dataset.b));
  });
  el.eggAns.classList.add('hidden');
  $$('#eggOpts button').forEach(b => { b.className = ''; b.disabled = false; });
  showScreen('scrEnd');
}

/* ---------- 特效 ---------- */
function burst(sx, sy) {
  if (!el.fx) return;
  const ring = document.createElement('div');
  ring.className = 'ring';
  ring.style.left = sx + 'px';
  ring.style.top = sy + 'px';
  el.fx.appendChild(ring);
  const colors = ['#ffb01f', '#ff6a35', '#2f7cf6', '#10a97b', '#ffffff'];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const a = Math.PI * 2 * i / 14 + Math.random() * 0.4;
    const d = 60 + Math.random() * 90;
    s.style.left = sx + 'px';
    s.style.top = sy + 'px';
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
    s.style.setProperty('--dy', (Math.sin(a) * d - 30).toFixed(0) + 'px');
    el.fx.appendChild(s);
  }
  const w = document.createElement('div');
  w.className = 'popword';
  w.textContent = '追上了！';
  w.style.left = sx + 'px';
  w.style.top = (sy - 30) + 'px';
  el.fx.appendChild(w);
  setTimeout(() => { el.fx.innerHTML = ''; }, 1300);
}

/* ============================================================
 *  主循环
 * ============================================================ */
let lastTs = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!lastTs) lastTs = now;
  let dt = (now - lastTs) / 1000;
  lastTs = now;
  dt = Math.min(dt, 0.05);

  if (G.playing) {
    const end = endTime(G.vR);
    let rate = G.rate;
    if (isCatchable(G.vR) && end - G.t < 0.45) rate *= 0.34;
    G.t += dt * rate;
    if (G.t >= end - 0.0005) {
      G.t = end;
      finishRun();
    }
    // 追赶绳格子消失时的“咔”
    const rem = Math.ceil(simAt(G.t, G.vR).gap / CFG.segM - 1e-6);
    if (rem < lastRemaining) { Sfx.tick(); lastRemaining = rem; }
  }

  if (lab) {
    lab.update(dt, G);
    lab.render();
    updateHUD();
    updateLabels();
  }
}

/* ============================================================
 *  事件绑定 & 启动
 * ============================================================ */
function bindEvents() {
  $('#btnStart').addEventListener('click', startGame);
  $$('#optWrap .opt').forEach(b => b.addEventListener('click', () => choosePrediction(Number(b.dataset.v))));

  $('#btnMinus').addEventListener('click', () => setSpeed(G.vR - 1));
  $('#btnPlus').addEventListener('click', () => setSpeed(G.vR + 1));

  el.btnRun.addEventListener('click', () => {
    if (G.playing) pauseRun();
    else if (G.t > 0.05) { G.t = 0; G.cheer = false; lab.resetRun(); startRun(); }
    else startRun();
  });

  $('#btnLog').addEventListener('click', () => {
    Sfx.click();
    const rows = G.runs.length
      ? G.runs.map(r => `<tr><td><b>${r.vR}</b> 米/秒</td><td>${r.caught ? `<span class="ok">追上了</span>` : `<span class="no">没追上</span>`}</td><td>${r.caught ? `<b>${fmt(r.t)}</b> 秒` : '—'}</td></tr>`).join('')
      : `<tr><td colspan="3" class="empty">还没有做过实验，先去起跑吧</td></tr>`;
    el.logCard.innerHTML = `
      <h3>实验记录</h3>
      <table><tr><th>小红速度</th><th>结果</th><th>追上用时</th></tr>${rows}</table>
      <p style="font-size:14px;color:var(--ink2);margin:14px 0 0;line-height:1.6">观察一下：速度差越大，追上的时间越短。</p>
      <div class="res-actions"><button class="btn ghost" id="logClose">关闭</button></div>`;
    showSheet('sheetLog');
    $('#logClose').addEventListener('click', () => { Sfx.click(); el.sheetLog.classList.add('hidden'); });
  });

  el.btnRate.addEventListener('click', () => {
    G.rate = G.rate === 1 ? 2 : 1;
    el.btnRate.textContent = G.rate + '×';
    Sfx.click();
  });
  el.btnMute.addEventListener('click', () => {
    Sfx.on = !Sfx.on;
    el.btnMute.textContent = Sfx.on ? '🔊' : '🔇';
    if (Sfx.on) Sfx.click();
  });

  el.bannerSwitch.addEventListener('click', toggleBannerCam);
  el.bannerClose.addEventListener('click', () => { Sfx.click(); el.banner.classList.add('hidden'); });

  // 彩蛋
  $$('#eggOpts button').forEach(b => b.addEventListener('click', () => {
    if (G.eggDone) return;
    G.eggDone = true;
    const v = Number(b.dataset.v);
    const ok = v === 7;
    b.classList.add(ok ? 'good' : 'bad');
    if (!ok) {
      const right = Array.from($$('#eggOpts button')).find(x => Number(x.dataset.v) === 7);
      if (right) right.classList.add('good');
    }
    Sfx.tone(ok ? 880 : 240, 0.2, 'sine', 0.1);
    el.eggAns.classList.remove('hidden');
    el.eggAns.innerHTML = `10 秒时，小明跑到 30 + 4 × 10 = <b>70 米</b>。<br>小红也要 10 秒到 70 米，所以 <b>70 ÷ 10 = 7 米/秒</b>。`;
  }));

  el.btnAgain.addEventListener('click', () => {
    Sfx.click();
    Object.assign(G, {
      t: 0, vR: CFG.vMing, playing: false, caught: false, cheer: false,
      prediction: null, officialDone: false, runCount: 0, runs: [],
      badges: new Set(), reframeStarted: false, eggDone: false,
    });
    lab.resetRun();
    lab.camMode = 'follow';
    el.banner.classList.add('hidden');
    el.btnRun.textContent = '▶ 起跑';
    setText(el.vSpeed, '4');
    hideSheets();
    showScreen('scrCover');
    setPhase('cover');
    updateHUD();
  });

  el.btnFinish.addEventListener('click', () => {
    Sfx.click();
    hideScreens();
    setPhase('lab');
    showProof();
  });

  window.addEventListener('resize', () => lab && lab.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.playing) pauseRun();
  });
}

/* ============================================================
 *  调试接口（供截图与验收）
 * ============================================================ */
function debugApi() {
  window.__lab = {
    G, CFG,
    get lab() { return lab; },
    go(p) {
      if (p === 'cover') { setPhase('cover'); showScreen('scrCover'); }
      if (p === 'predict') { setPhase('cover'); showScreen('scrPredict'); }
      if (p === 'lab') { enterLab(); }
      if (p === 'end') { showEnd(); }
      updateHUD();
    },
    speed(v) { setSpeed(v); },
    run() { startRun(); },
    setT(t) { G.t = t; G.playing = false; lab.resetRun(); updateHUD(); },
    result(caught) {
      enterLab();
      G.vR = caught ? CFG.official : 5;
      G.t = caught ? 15 : RUN_END_T;
      G.caught = caught;
      G.cheer = caught;
      lab.resetRun();
      lab.update(0.016, G); lab.updateCamera(0, true, G);
      updateHUD(); updateLabels();
      showResult(caught);
    },
    theater() { enterLab(); G.prediction = 5; showTheater(); },
    reframe() { showReframeIntro(); },
    reframeDone() { G.t = 15; G.vR = 6; G.cheer = true; showReframeDone(); },
    proof() {
      enterLab(); G.t = 15; G.vR = 6; G.cheer = true;
      lab.update(0.016, G); lab.updateCamera(0, true, G);
      updateHUD(); updateLabels(); showProof();
    },
    end() { G.prediction = 5; G.officialDone = true; G.badges = new Set(['lab', 'scrub', 'cam']); showEnd(); },
    toLabel() { G.t = 5; updateHUD(); updateLabels(); },
  };
}

async function main() {
  window.__booted = true;
  cacheDom();
  buildRope();
  buildRuler();
  bindEvents();
  debugApi();
  lab = new Lab(el.gl);
  try {
    await lab.init();
  } catch (e) {
    console.error(e);
    $('#loadTxt').textContent = '3D 加载失败，请检查网络后刷新';
    const p = document.createElement('p');
    p.className = 'err';
    p.textContent = '需要联网加载 three.js 与角色模型（首次加载约 1MB）。';
    $('#loading').appendChild(p);
    return;
  }
  const hash = new URLSearchParams(location.search);
  if (hash.get('shot')) {
    const s = hash.get('shot');
    setTimeout(() => {
      if (s === 'cover') { setPhase('cover'); showScreen('scrCover'); }
      else if (s === 'predict') { setPhase('cover'); showScreen('scrPredict'); }
      else if (s === 'lab') {
        enterLab();
        const tv = parseFloat(hash.get('t') || '0');
        const vv = parseInt(hash.get('v') || '4', 10);
        G.vR = vv; setText(el.vSpeed, String(vv));
        G.t = tv; lab.resetRun();
        lab.update(0.016, G); lab.updateCamera(0, true, G);
        updateHUD(); updateLabels();
      }
      else if (s === 'result') { window.__lab.result(true); }
      else if (s === 'fail') { window.__lab.result(false); }
      else if (s === 'theater') { window.__lab.theater(); }
      else if (s === 'reframeDone') { window.__lab.reframeDone(); }
      else if (s === 'proof') { window.__lab.proof(); }
      else if (s === 'end') { window.__lab.end(); }
      else if (s === 'reframe') { startReframe(); }
    }, 60);
  }
  el.loading.classList.add('gone');
  setPhase('cover');
  requestAnimationFrame(loop);
}

main();

/// <reference types="vite/client" />
import { COLS, MAX_COMBO, bounce, circleRect, clamp, isCleared, paddleBounce, parseLevel, pointsFor, steer, type Brick } from "./physics";
import { LEVELS, levelAt } from "./levels";
import { MAX_NAME, insertScore, parseScores, qualifies, type ScoreEntry } from "./scores";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("game");
const ctx = canvas.getContext("2d")!;
const scoreEl = $("score"), bestEl = $("best"), livesEl = $("lives"), levelEl = $("level"), statusEl = $("status");
const startBtn = $<HTMLButtonElement>("start");
const pauseBtn = $<HTMLButtonElement>("pause");
const muteBtn = $<HTMLButtonElement>("mute");
const diffSel = $<HTMLSelectElement>("difficulty");
const topList = $<HTMLOListElement>("top");
const nameDialog = $<HTMLDialogElement>("nameDialog");
const nameInput = $<HTMLInputElement>("nameInput");

// ---------- constants ----------
const W = 640, H = 480;
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * dpr; canvas.height = H * dpr;
ctx.scale(dpr, dpr);

const GAP = 6, TOP = 56, BRICK_H = 20;
const BRICK_W = (W - GAP * (COLS + 1)) / COLS;
const GRID = { gap: GAP, top: TOP, brickW: BRICK_W, brickH: BRICK_H };
const PADDLE_Y = H - 30, PADDLE_H = 12, PADDLE_W = 100, PADDLE_W_WIDE = 160, PADDLE_SPEED = 620;
const R = 7;
const MAX_BALLS = 12;
const STEP = 1 / 120; // fixed physics step: same speed on 60Hz and 144Hz screens
const ROW_COLORS = ["#ff5c7a", "#ff9f43", "#feca57", "#1dd1a1", "#48dbfb", "#7c5cff", "#f368e0", "#ff5c7a"];

const DIFF = {
  easy: { speed: 300, lives: 5 },
  normal: { speed: 360, lives: 3 },
  hard: { speed: 430, lives: 2 },
} as const;
type Diff = keyof typeof DIFF;

type PowerType = "wide" | "multi" | "slow" | "life" | "laser" | "fire";
const POWER: Record<PowerType, { color: string; label: string; msg: string }> = {
  wide: { color: "#1dd1a1", label: "W", msg: "WIDE!" },
  multi: { color: "#48dbfb", label: "M", msg: "MULTIBALL!" },
  slow: { color: "#feca57", label: "S", msg: "SLOW!" },
  life: { color: "#ff5c7a", label: "♥", msg: "+1 LIFE" },
  laser: { color: "#f368e0", label: "L", msg: "LASERS!" },
  fire: { color: "#ff9f43", label: "F", msg: "FIREBALL!" },
};
// weighted: helpful-but-common first, extra life rare
const DROPS: PowerType[] = ["wide", "wide", "multi", "multi", "slow", "laser", "laser", "fire", "life"];

type Ball = { x: number; y: number; vx: number; vy: number; stuck: boolean; trail: { x: number; y: number }[] };
type Power = { x: number; y: number; type: PowerType };
type Bolt = { x: number; y: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };
type Floater = { x: number; y: number; text: string; life: number };
type State = "menu" | "playing" | "paused" | "clear" | "over";

// ---------- state ----------
let state: State = "menu";
let diff: Diff = "normal";
let bricks: Brick[] = [], balls: Ball[] = [], powers: Power[] = [], bolts: Bolt[] = [];
let particles: Particle[] = [], floaters: Floater[] = [];
let score = 0, lives = 3, level = 0, combo = 0, boost = 1;
let paddleX = (W - PADDLE_W) / 2, paddleW = PADDLE_W;
let wideT = 0, slowT = 0, laserT = 0, fireT = 0, laserCd = 0;
let shake = 0, clearT = 0, clearBonus = 0;
let newBest = false;
let pending: Omit<ScoreEntry, "name"> | null = null;
let lastRank = -1;
const keys = { left: false, right: false };

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
let top = parseScores(store.get("bb-top"));
let best = Math.max(Number(store.get("bb-best")) || 0, top[0]?.score ?? 0);
let muted = store.get("bb-muted") === "1";

// ---------- sound (synthesized, no assets) ----------
let audio: AudioContext | null = null;
function beep(freq: number, dur = 0.08, type: OscillatorType = "square", vol = 0.04) {
  if (muted) return;
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch { /* audio unavailable */ }
}
const arpeggio = (notes: number[], gap = 90) => notes.forEach((n, i) => setTimeout(() => beep(n, 0.12, "triangle", 0.06), i * gap));

// ---------- setup ----------
function setState(s: State) {
  state = s;
  canvas.classList.toggle("playing", s === "playing");
  pauseBtn.disabled = s !== "playing" && s !== "paused";
  pauseBtn.textContent = s === "paused" ? "Resume" : "Pause";
  diffSel.disabled = s === "playing" || s === "paused" || s === "clear";
}

const announce = (msg: string) => { statusEl.textContent = msg; };

function buildLevel(n: number): Brick[] {
  const { def, loop } = levelAt(n);
  const out = parseLevel(def.rows, GRID);
  if (def.boss) {
    const hp = 20 + 10 * loop;
    out.push({ x: (W - 160) / 2, y: TOP - 6, w: 160, h: 40, hp, maxHp: hp, row: 0, solid: false, flash: 0, boss: true, vx: 90 + 30 * loop });
  }
  return out;
}

function stuckBall(): Ball {
  return { x: paddleX + paddleW / 2, y: PADDLE_Y - R, vx: 0, vy: -1, stuck: true, trail: [] };
}

function resetEffects() {
  wideT = slowT = laserT = fireT = 0;
  powers = []; bolts = [];
  combo = 0; boost = 1;
}

function startLevel(n: number) {
  level = n;
  bricks = buildLevel(n);
  balls = [stuckBall()];
  resetEffects();
  setState("playing");
  updateHud();
  announce(`Level ${n + 1}: ${levelAt(n).def.name}`);
}

function newGame() {
  if (nameDialog.open) nameDialog.close();
  diff = diffSel.value as Diff;
  score = 0; lives = DIFF[diff].lives; newBest = false; lastRank = -1;
  paddleX = (W - PADDLE_W) / 2; paddleW = PADDLE_W;
  particles = []; floaters = [];
  startLevel(0);
  startBtn.textContent = "Restart";
  renderTop();
}

function updateHud() {
  scoreEl.textContent = score.toLocaleString();
  livesEl.textContent = lives > 0 ? "♥".repeat(Math.min(lives, 8)) : "—";
  livesEl.setAttribute("aria-label", `${lives} lives`);
  levelEl.textContent = String(level + 1);
  if (score > best) {
    best = score; newBest = true;
    store.set("bb-best", String(best));
  }
  bestEl.textContent = best.toLocaleString();
}

function renderTop() {
  if (!top.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No scores yet. Be the first.";
    topList.replaceChildren(li);
    return;
  }
  topList.replaceChildren(...top.map((e, i) => {
    const li = document.createElement("li");
    if (i === lastRank) li.className = "you";
    const name = document.createElement("span"), meta = document.createElement("small"), pts = document.createElement("b");
    name.textContent = e.name; // textContent, never innerHTML: names come from user input
    meta.textContent = `Lv ${e.level} · ${e.diff}`;
    pts.textContent = e.score.toLocaleString();
    li.append(name, meta, pts);
    return li;
  }));
}

function speed() {
  const s = DIFF[diff].speed * (1 + 0.07 * level) * boost * (slowT > 0 ? 0.7 : 1);
  return Math.min(s, 760);
}

// ---------- gameplay ----------
function launch() {
  if (state !== "playing") return;
  for (const b of balls) if (b.stuck) {
    const a = (Math.random() - 0.5) * 0.8; // up to ~23° off vertical
    b.vx = Math.sin(a); b.vy = -Math.cos(a); b.stuck = false;
    beep(520, 0.06);
  }
}

function burst(x: number, y: number, color: string, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 220;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + Math.random() * 0.4, color });
  }
}

/** Stack floaters that spawn on top of each other instead of drawing them in one spot. */
function addFloater(x: number, y: number, text: string) {
  const near = floaters.filter(f => f.life > 0.5 && Math.abs(f.x - x) < 70 && Math.abs(f.y - y) < 60).length;
  floaters.push({ x, y: y - near * 18, text, life: 0.9 });
}

const brickColor = (br: Brick) => ROW_COLORS[br.row % ROW_COLORS.length];

function dropPower(x: number, y: number) {
  powers.push({ x, y, type: DROPS[Math.floor(Math.random() * DROPS.length)] });
}

function damage(br: Brick, amount = 1) {
  br.flash = 1;
  if (br.solid) { beep(110, 0.05, "square", 0.03); return; }
  br.hp = Math.max(0, br.hp - amount);
  const cx = br.x + br.w / 2, cy = br.y + br.h / 2;

  if (br.hp > 0) {
    if (br.boss) {
      score += 25 * (level + 1);
      shake = Math.max(shake, 4);
      beep(180, 0.08, "sawtooth", 0.04);
      if (Math.random() < 0.2) dropPower(cx, br.y + br.h);
    } else {
      score += 5;
      beep(300, 0.05);
    }
    updateHud();
    return;
  }

  combo++;
  const pts = br.boss ? 1500 * (level + 1) : pointsFor(br.maxHp, level, combo);
  score += pts;
  burst(cx, cy, br.boss ? "#b18cff" : brickColor(br), br.boss ? 90 : 14);
  addFloater(cx, cy, br.boss ? `BOSS DOWN +${pts.toLocaleString()}` : combo > 1 ? `+${pts} ×${Math.min(combo, MAX_COMBO)}` : `+${pts}`);
  shake = Math.max(shake, br.boss ? 18 : 3);
  beep(400 + Math.min(combo, 12) * 45, 0.07, "square", 0.045);
  if (br.boss) arpeggio([262, 330, 392, 523, 659], 70);
  boost = Math.min(boost * 1.008, 1.35);
  if (!br.boss && Math.random() < 0.16) dropPower(cx, cy);
  updateHud();

  if (isCleared(bricks)) levelClear();
}

function levelClear() {
  clearBonus = 250 * (level + 1) + lives * 100;
  score += clearBonus;
  bolts = [];
  updateHud();
  setState("clear");
  clearT = 2;
  arpeggio([523, 659, 784, 1047]);
  announce(`Level ${level + 1} cleared. Bonus ${clearBonus}.`);
}

function applyPower(type: PowerType) {
  arpeggio([660, 880], 60);
  if (type === "wide") wideT = 12;
  else if (type === "slow") slowT = 9;
  else if (type === "laser") laserT = 8;
  else if (type === "fire") fireT = 6;
  else if (type === "life") { lives++; updateHud(); }
  else if (type === "multi") {
    launch();
    const extra: Ball[] = [];
    for (const b of balls) for (const d of [-0.45, 0.45]) {
      const c = Math.cos(d), s = Math.sin(d);
      extra.push({ x: b.x, y: b.y, vx: b.vx * c - b.vy * s, vy: b.vx * s + b.vy * c, stuck: false, trail: [] });
    }
    balls.push(...extra.slice(0, Math.max(0, MAX_BALLS - balls.length)));
  }
  addFloater(paddleX + paddleW / 2, PADDLE_Y - 14, POWER[type].msg);
}

function loseLife() {
  lives--;
  resetEffects();
  shake = 10;
  beep(150, 0.35, "sawtooth", 0.05);
  updateHud();
  if (lives > 0) { balls = [stuckBall()]; return; }

  setState("over");
  startBtn.textContent = "Play again";
  setTimeout(() => arpeggio([392, 330, 262], 140), 200);
  announce(`Game over. Score ${score}.`);
  if (qualifies(top, score)) {
    pending = { score, level: level + 1, diff };
    nameInput.value = store.get("bb-name") ?? "";
    nameDialog.showModal();
    nameInput.select();
  }
}

function step(dt: number) {
  // paddle
  if (keys.left) paddleX -= PADDLE_SPEED * dt;
  if (keys.right) paddleX += PADDLE_SPEED * dt;
  const targetW = wideT > 0 ? PADDLE_W_WIDE : PADDLE_W;
  const center = paddleX + paddleW / 2;
  paddleW += (targetW - paddleW) * Math.min(1, dt * 10);
  paddleX = clamp(center - paddleW / 2, 0, W - paddleW);
  wideT = Math.max(0, wideT - dt);
  slowT = Math.max(0, slowT - dt);
  laserT = Math.max(0, laserT - dt);
  fireT = Math.max(0, fireT - dt);

  // boss patrols side to side
  for (const br of bricks) if (br.vx && br.hp > 0) {
    br.x += br.vx * dt;
    if (br.x < GAP || br.x + br.w > W - GAP) { br.vx = -br.vx; br.x = clamp(br.x, GAP, W - GAP - br.w); }
  }

  const v = speed();
  for (const b of balls) {
    if (b.stuck) { b.x = paddleX + paddleW / 2; b.y = PADDLE_Y - R; continue; }

    const d = steer({ x: b.vx, y: b.vy });
    b.vx = d.x; b.vy = d.y;
    b.x += b.vx * v * dt;
    b.y += b.vy * v * dt;

    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); beep(250, 0.03, "sine"); }
    if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); beep(250, 0.03, "sine"); }
    if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy); beep(250, 0.03, "sine"); }

    if (b.vy > 0 && b.y + R >= PADDLE_Y && b.y - R <= PADDLE_Y + PADDLE_H &&
        b.x >= paddleX - R && b.x <= paddleX + paddleW + R) {
      const nv = paddleBounce(b.x, paddleX, paddleW);
      b.vx = nv.x; b.vy = nv.y;
      b.y = PADDLE_Y - R;
      combo = 0;
      beep(220, 0.05, "triangle", 0.05);
    }

    for (const br of bricks) {
      if (br.hp <= 0) continue;
      const hit = circleRect(b.x, b.y, R, br);
      if (!hit) continue;
      if (fireT > 0 && !br.solid && !br.boss) { damage(br, Infinity); continue; } // fireball plows through
      b.x = hit.x; b.y = hit.y;
      const nv = bounce({ x: b.vx, y: b.vy }, hit);
      b.vx = nv.x; b.vy = nv.y;
      damage(br);
      break; // one bounce per ball per step
    }
    if (state !== "playing") return;

    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 10) b.trail.shift();
  }

  balls = balls.filter(b => b.y < H + R * 2);
  if (balls.length === 0) { loseLife(); return; }

  // lasers
  if (laserT > 0 && (laserCd -= dt) <= 0) {
    laserCd = 0.35;
    bolts.push({ x: paddleX + 8, y: PADDLE_Y }, { x: paddleX + paddleW - 8, y: PADDLE_Y });
    beep(900, 0.04, "square", 0.02);
  }
  for (const bo of bolts) bo.y -= 720 * dt;
  bolts = bolts.filter(bo => {
    if (bo.y < 0) return false;
    const br = bricks.find(k => k.hp > 0 && bo.x >= k.x && bo.x <= k.x + k.w && bo.y >= k.y && bo.y <= k.y + k.h);
    if (!br) return true;
    damage(br);
    return false;
  });
  if (state !== "playing") return;

  for (const p of powers) p.y += 150 * dt;
  powers = powers.filter(p => {
    if (p.y > PADDLE_Y - 8 && p.y < PADDLE_Y + PADDLE_H + 8 && p.x > paddleX - 14 && p.x < paddleX + paddleW + 14) {
      applyPower(p.type);
      return false;
    }
    return p.y < H + 20;
  });
}

function updateFx(dt: number) {
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  for (const f of floaters) { f.y -= 40 * dt; f.life -= dt; }
  floaters = floaters.filter(f => f.life > 0);
  for (const br of bricks) br.flash = Math.max(0, br.flash - dt * 6);
  shake = Math.max(0, shake - dt * 30);
}

// ---------- rendering ----------
const bg = ctx.createLinearGradient(0, 0, 0, H);
bg.addColorStop(0, "#1d1e3d"); bg.addColorStop(1, "#12132a");
let ui = 1; // text scale: the canvas is drawn at 640px wide, so on a phone text needs to be bigger to stay readable

function rr(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}

function circle(x: number, y: number, r: number) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function text(s: string, x: number, y: number, size: number, color = "#e8e8f5", weight = "700", align: CanvasTextAlign = "center") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${Math.round(size * ui)}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

function drawBrick(br: Brick) {
  if (br.boss) return drawBoss(br);
  if (br.solid) {
    ctx.fillStyle = "#4a4d70"; rr(br.x, br.y, br.w, br.h, 4);
    ctx.fillStyle = "rgba(255,255,255,.12)";
    for (let i = 6; i < br.w; i += 10) ctx.fillRect(br.x + i, br.y + 3, 2, br.h - 6);
  } else {
    ctx.globalAlpha = 0.55 + 0.45 * (br.hp / br.maxHp);
    ctx.fillStyle = brickColor(br); rr(br.x, br.y, br.w, br.h, 4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(br.x + 3, br.y + 2, br.w - 6, 3);
    // pips show remaining hits on tough bricks
    if (br.maxHp > 1) {
      ctx.fillStyle = "rgba(15,16,32,.7)";
      for (let i = 0; i < br.hp; i++) circle(br.x + br.w / 2 + (i - (br.hp - 1) / 2) * 9, br.y + br.h / 2 + 2, 2.5);
    }
  }
  if (br.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${br.flash * 0.7})`; rr(br.x, br.y, br.w, br.h, 4); }
}

function drawBoss(br: Brick) {
  const g = ctx.createLinearGradient(0, br.y, 0, br.y + br.h);
  g.addColorStop(0, "#b18cff"); g.addColorStop(1, "#5a3dff");
  ctx.shadowColor = "#9b6bff"; ctx.shadowBlur = 22;
  ctx.fillStyle = g; rr(br.x, br.y, br.w, br.h, 12);
  ctx.shadowBlur = 0;
  // eyes follow the lowest ball, which is the one about to matter
  const target = [...balls].sort((a, b) => b.y - a.y)[0] ?? { x: W / 2, y: H };
  for (const ex of [br.x + br.w * 0.33, br.x + br.w * 0.67]) {
    const ey = br.y + br.h * 0.45;
    ctx.fillStyle = "#fff"; circle(ex, ey, 8);
    const a = Math.atan2(target.y - ey, target.x - ex);
    ctx.fillStyle = "#12132a"; circle(ex + Math.cos(a) * 3.5, ey + Math.sin(a) * 3.5, 4);
  }
  if (br.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${br.flash * 0.6})`; rr(br.x, br.y, br.w, br.h, 12); }
}

function overlay(title: string, lines: string[] = []) {
  ctx.fillStyle = "rgba(12,13,30,.72)";
  ctx.fillRect(0, 0, W, H);
  text(title, W / 2, H / 2 - 10 * ui, 44, "#ffffff", "800");
  lines.forEach((l, i) => text(l, W / 2, H / 2 + (30 + i * 28) * ui, 18, "#c9c9e6", "500"));
}

function draw() {
  ui = clamp(W / (canvas.clientWidth || W), 1, 1.8);
  ctx.save();
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  for (const br of bricks) if (br.hp > 0) drawBrick(br);

  for (const p of powers) {
    const c = POWER[p.type];
    ctx.shadowColor = c.color; ctx.shadowBlur = 12;
    ctx.fillStyle = c.color; rr(p.x - 14, p.y - 8, 28, 16, 8);
    ctx.shadowBlur = 0;
    text(c.label, p.x, p.y + 5, 13 / ui, "#12132a", "800");
  }

  ctx.fillStyle = "#ff8af0";
  for (const bo of bolts) ctx.fillRect(bo.x - 1.5, bo.y - 10, 3, 12);

  // paddle
  const pg = ctx.createLinearGradient(paddleX, 0, paddleX + paddleW, 0);
  pg.addColorStop(0, "#9b82ff"); pg.addColorStop(1, "#5a3dff");
  ctx.shadowColor = "#7c5cff"; ctx.shadowBlur = 18;
  ctx.fillStyle = pg; rr(paddleX, PADDLE_Y, paddleW, PADDLE_H, 6);
  ctx.shadowBlur = 0;
  if (laserT > 0) {
    ctx.fillStyle = "#f368e0";
    ctx.fillRect(paddleX + 5, PADDLE_Y - 6, 6, 8);
    ctx.fillRect(paddleX + paddleW - 11, PADDLE_Y - 6, 6, 8);
  }

  // balls
  const fire = fireT > 0;
  for (const b of balls) {
    b.trail.forEach((t, i) => {
      const k = i / b.trail.length;
      ctx.fillStyle = fire ? `rgba(255,159,67,${k * 0.6})` : `rgba(200,190,255,${k * 0.35})`;
      circle(t.x, t.y, R * k * (fire ? 1.3 : 1));
    });
    ctx.shadowColor = fire ? "#ff9f43" : "#fff"; ctx.shadowBlur = fire ? 22 : 14;
    ctx.fillStyle = fire ? "#ffd29a" : "#fff";
    circle(b.x, b.y, R);
    ctx.shadowBlur = 0;
  }

  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color; ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  for (const f of floaters) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    text(f.text, f.x, f.y, 14, "#ffffff", "800");
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // status strip (outside the shake)
  const fx: string[] = [];
  if (wideT > 0) fx.push(`WIDE ${Math.ceil(wideT)}`);
  if (slowT > 0) fx.push(`SLOW ${Math.ceil(slowT)}`);
  if (laserT > 0) fx.push(`LASER ${Math.ceil(laserT)}`);
  if (fireT > 0) fx.push(`FIRE ${Math.ceil(fireT)}`);
  if (fx.length) text(fx.join("  "), 12, 26, 12, "#9d9dc4", "700", "left");
  if (combo > 1) text(`Combo ×${Math.min(combo, MAX_COMBO)}`, W - 12, 26, 15, "#feca57", "800", "right");

  const boss = bricks.find(b => b.boss && b.hp > 0);
  if (boss) {
    const bw = 220, bx = (W - bw) / 2;
    ctx.fillStyle = "rgba(255,255,255,.1)"; rr(bx, 12, bw, 8, 4);
    ctx.fillStyle = "#b18cff"; rr(bx, 12, bw * (boss.hp / boss.maxHp), 8, 4);
    text("BOSS", W / 2, 36, 10, "#c9c9e6", "800");
  }

  if (state === "playing" && balls.some(b => b.stuck)) {
    text(`Level ${level + 1} · ${levelAt(level).def.name}`, W / 2, PADDLE_Y - 70 * ui, 22, "#ffffff", "800");
    text("Click, tap or Space to launch", W / 2, PADDLE_Y - 40 * ui, 16, "#c9c9e6", "500");
  }
  if (state === "menu") overlay("Brick Breaker", ["Pick a difficulty and press Start", `${LEVELS.length} levels, then a boss. Then it loops, faster.`]);
  if (state === "paused") overlay("Paused", ["Press P or Esc to resume"]);
  if (state === "clear") overlay(`Level ${level + 1} cleared!`, [`Bonus +${clearBonus.toLocaleString()}`, `Next: ${levelAt(level + 1).def.name}`]);
  if (state === "over") overlay("Game Over", [`Score ${score.toLocaleString()} · reached level ${level + 1}`, newBest ? "New best score!" : `Best ${best.toLocaleString()}`]);
}

// ---------- loop ----------
let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1); // clamp so a background tab doesn't teleport the ball
  last = now;
  if (state === "playing") {
    acc += dt;
    while (acc >= STEP && state === "playing") { step(STEP); acc -= STEP; }
  } else {
    acc = 0;
    if (state === "clear" && (clearT -= dt) <= 0) startLevel(level + 1);
  }
  updateFx(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- input ----------
function togglePause() {
  if (state === "playing") setState("paused");
  else if (state === "paused") setState("playing");
}

function syncMute() {
  muteBtn.textContent = muted ? "Sound: off" : "Sound: on";
  muteBtn.setAttribute("aria-pressed", String(!muted));
}

function pointerTo(clientX: number) {
  if (state !== "playing") return;
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (W / rect.width);
  paddleX = clamp(x - paddleW / 2, 0, W - paddleW);
}

startBtn.addEventListener("click", () => { newGame(); startBtn.blur(); });
pauseBtn.addEventListener("click", () => { togglePause(); pauseBtn.blur(); });
muteBtn.addEventListener("click", () => { muted = !muted; store.set("bb-muted", muted ? "1" : "0"); syncMute(); muteBtn.blur(); });

nameInput.maxLength = MAX_NAME;
nameDialog.addEventListener("close", () => {
  if (nameDialog.returnValue === "save" && pending) {
    const name = nameInput.value.trim().slice(0, MAX_NAME) || "Player";
    store.set("bb-name", name);
    const r = insertScore(top, { name, ...pending });
    top = r.list; lastRank = r.rank;
    store.set("bb-top", JSON.stringify(top));
    renderTop();
  }
  pending = null;
  nameDialog.returnValue = "";
});

canvas.addEventListener("mousemove", e => pointerTo(e.clientX));
canvas.addEventListener("click", launch);
canvas.addEventListener("touchstart", e => { pointerTo(e.touches[0].clientX); launch(); e.preventDefault(); }, { passive: false });
canvas.addEventListener("touchmove", e => { pointerTo(e.touches[0].clientX); e.preventDefault(); }, { passive: false });

addEventListener("keydown", e => {
  if (nameDialog.open || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === "ArrowLeft" || e.key === "a") keys.left = true;
  else if (e.key === "ArrowRight" || e.key === "d") keys.right = true;
  else if (e.key === " ") launch();
  else if (e.key === "p" || e.key === "P" || e.key === "Escape") togglePause();
  else if (e.key === "Enter" && (state === "menu" || state === "over")) newGame();
  else if (e.key === "m" || e.key === "M") muteBtn.click();
  else return;
  e.preventDefault();
});
addEventListener("keyup", e => {
  if (e.key === "ArrowLeft" || e.key === "a") keys.left = false;
  if (e.key === "ArrowRight" || e.key === "d") keys.right = false;
});
// releasing a key while the window is unfocused never fires keyup, so the paddle would drift forever
addEventListener("blur", () => { keys.left = keys.right = false; });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "playing") togglePause(); });

// dev-only handle for browser tests; import.meta.env.DEV is false in `vite build`, so this is stripped from production
if (import.meta.env.DEV) Object.assign(window, {
  __bb: {
    get state() { return state; }, get score() { return score; }, get level() { return level; }, get lives() { return lives; },
    get balls() { return balls; }, get bricks() { return bricks; }, get paddleW() { return paddleW; }, get top() { return top; },
    setPaddle(x: number) { paddleX = clamp(x, 0, W - paddleW); },
    launch, applyPower, startLevel,
    dropAll() { lives = 1; for (const b of balls) { b.stuck = false; b.y = H + 50; } },
  },
});

bricks = buildLevel(0);
balls = [stuckBall()];
setState("menu");
updateHud();
renderTop();
syncMute();
requestAnimationFrame(frame);

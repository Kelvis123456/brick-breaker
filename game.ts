const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const $ = (id: string) => document.getElementById(id)!;
const scoreEl = $("score"), bestEl = $("best"), livesEl = $("lives"), levelEl = $("level");
const startBtn = $("start") as HTMLButtonElement;
const pauseBtn = $("pause") as HTMLButtonElement;
const muteBtn = $("mute") as HTMLButtonElement;
const diffSel = $("difficulty") as HTMLSelectElement;

// ---------- constants ----------
const W = 640, H = 480;
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * dpr; canvas.height = H * dpr;
ctx.scale(dpr, dpr);

const COLS = 10, GAP = 6, TOP = 56, BRICK_H = 20;
const BRICK_W = (W - GAP * (COLS + 1)) / COLS;
const PADDLE_Y = H - 30, PADDLE_H = 12, PADDLE_W = 100, PADDLE_W_WIDE = 160, PADDLE_SPEED = 620;
const R = 7;
const STEP = 1 / 120; // fixed physics step: same speed on 60Hz and 144Hz screens
const ROW_COLORS = ["#ff5c7a", "#ff9f43", "#feca57", "#1dd1a1", "#48dbfb", "#7c5cff", "#f368e0", "#ff5c7a"];

// '.' empty, '1'-'3' hit points, '#' unbreakable
const LEVELS: string[][] = [
  ["1111111111", "1111111111", "1111111111", "1111111111"],
  ["....22....", "...2112...", "..211112..", ".21111112.", "2111111112"],
  ["2.2.2.2.2.", ".1.1.1.1.1", "2.2.2.2.2.", ".1.1.1.1.1", "##..##..##"],
  ["..2....2..", "...2..2...", "..222222..", ".22322322.", "2222222222", "2.222222.2", "2.2....2.2", "...22.22.."],
  ["##########", "#32222223#", "#21111112#", "#21111112#", "#32222223#", "....##...."],
];

const DIFF = {
  easy: { speed: 300, lives: 5 },
  normal: { speed: 360, lives: 3 },
  hard: { speed: 430, lives: 2 },
} as const;
type Diff = keyof typeof DIFF;

type PowerType = "wide" | "multi" | "slow" | "life";
const POWER: Record<PowerType, { color: string; label: string }> = {
  wide: { color: "#1dd1a1", label: "W" },
  multi: { color: "#48dbfb", label: "M" },
  slow: { color: "#feca57", label: "S" },
  life: { color: "#ff5c7a", label: "♥" },
};

type Brick = { x: number; y: number; hp: number; maxHp: number; row: number; solid: boolean; flash: number };
type Ball = { x: number; y: number; vx: number; vy: number; stuck: boolean; trail: { x: number; y: number }[] };
type Power = { x: number; y: number; type: PowerType };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };
type Floater = { x: number; y: number; text: string; life: number };
type State = "menu" | "playing" | "paused" | "clear" | "over";

// ---------- state ----------
let state: State = "menu";
let diff: Diff = "normal";
let bricks: Brick[] = [], balls: Ball[] = [], powers: Power[] = [];
let particles: Particle[] = [], floaters: Floater[] = [];
let score = 0, lives = 3, level = 0, combo = 0, boost = 1;
let paddleX = (W - PADDLE_W) / 2, paddleW = PADDLE_W;
let wideT = 0, slowT = 0, shake = 0, clearT = 0, clearBonus = 0;
let newBest = false;
const keys = { left: false, right: false };

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
let best = Number(store.get("bb-best")) || 0;
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
function loadLevel(n: number) {
  const layout = LEVELS[n % LEVELS.length];
  bricks = [];
  layout.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ".") return;
    const solid = ch === "#", hp = solid ? Infinity : Number(ch);
    bricks.push({ x: GAP + c * (BRICK_W + GAP), y: TOP + r * (BRICK_H + GAP), hp, maxHp: hp, row: r, solid, flash: 0 });
  }));
}

function stuckBall(): Ball {
  return { x: paddleX + paddleW / 2, y: PADDLE_Y - R, vx: 0, vy: -1, stuck: true, trail: [] };
}

function startLevel(n: number) {
  level = n;
  loadLevel(n);
  balls = [stuckBall()];
  powers = [];
  combo = 0; boost = 1; wideT = 0; slowT = 0;
  state = "playing";
  updateHud();
}

function newGame() {
  diff = diffSel.value as Diff;
  score = 0; lives = DIFF[diff].lives; newBest = false;
  paddleX = (W - PADDLE_W) / 2; paddleW = PADDLE_W;
  particles = []; floaters = [];
  startLevel(0);
  startBtn.textContent = "Restart";
  pauseBtn.disabled = false;
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

function hitBrick(br: Brick) {
  br.flash = 1;
  if (br.solid) { beep(110, 0.05, "square", 0.03); return; }
  br.hp--;
  if (br.hp > 0) { score += 5; beep(300, 0.05); updateHud(); return; }

  combo++;
  const mult = Math.min(combo, 8);
  const pts = 10 * br.maxHp * (level + 1) * mult;
  score += pts;
  const cx = br.x + BRICK_W / 2, cy = br.y + BRICK_H / 2;
  burst(cx, cy, ROW_COLORS[br.row % ROW_COLORS.length]);
  floaters.push({ x: cx, y: cy, text: mult > 1 ? `+${pts} ×${mult}` : `+${pts}`, life: 0.8 });
  shake = Math.max(shake, 3);
  beep(400 + Math.min(combo, 12) * 45, 0.07, "square", 0.045);
  boost = Math.min(boost * 1.008, 1.35);

  if (Math.random() < 0.16) {
    const types: PowerType[] = ["wide", "multi", "slow", "wide", "multi", "life"];
    powers.push({ x: cx, y: cy, type: types[Math.floor(Math.random() * types.length)] });
  }
  updateHud();

  if (bricks.every(b => b.solid || b.hp <= 0)) {
    clearBonus = 250 * (level + 1) + lives * 100;
    score += clearBonus;
    updateHud();
    state = "clear"; clearT = 2;
    arpeggio([523, 659, 784, 1047]);
  }
}

function applyPower(type: PowerType) {
  arpeggio([660, 880], 60);
  if (type === "wide") wideT = 12;
  else if (type === "slow") slowT = 9;
  else if (type === "life") { lives++; updateHud(); }
  else if (type === "multi") {
    launch();
    const extra: Ball[] = [];
    for (const b of balls) for (const d of [-0.45, 0.45]) {
      const c = Math.cos(d), s = Math.sin(d);
      extra.push({ x: b.x, y: b.y, vx: b.vx * c - b.vy * s, vy: b.vx * s + b.vy * c, stuck: false, trail: [] });
    }
    balls.push(...extra.slice(0, Math.max(0, 12 - balls.length)));
  }
  floaters.push({ x: paddleX + paddleW / 2, y: PADDLE_Y - 14, text: { wide: "WIDE!", multi: "MULTIBALL!", slow: "SLOW!", life: "+1 LIFE" }[type], life: 1 });
}

function loseLife() {
  lives--;
  combo = 0; wideT = 0; slowT = 0; powers = [];
  shake = 10;
  beep(150, 0.35, "sawtooth", 0.05);
  updateHud();
  if (lives <= 0) {
    state = "over";
    startBtn.textContent = "Play again";
    pauseBtn.disabled = true;
    setTimeout(() => arpeggio([392, 330, 262], 140), 200);
  } else balls = [stuckBall()];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

  const v = speed();
  for (const b of balls) {
    if (b.stuck) { b.x = paddleX + paddleW / 2; b.y = PADDLE_Y - R; continue; }

    // keep a constant speed and never go near-horizontal (endless side-to-side bounces)
    let len = Math.hypot(b.vx, b.vy) || 1;
    b.vx /= len; b.vy /= len;
    if (Math.abs(b.vy) < 0.3) { b.vy = 0.3 * Math.sign(b.vy || -1); b.vx = Math.sign(b.vx) * Math.sqrt(1 - 0.09); }
    b.x += b.vx * v * dt;
    b.y += b.vy * v * dt;

    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); beep(250, 0.03, "sine"); }
    if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); beep(250, 0.03, "sine"); }
    if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy); beep(250, 0.03, "sine"); }

    // paddle: where it hits decides the angle, so the player can aim
    if (b.vy > 0 && b.y + R >= PADDLE_Y && b.y - R <= PADDLE_Y + PADDLE_H &&
        b.x >= paddleX - R && b.x <= paddleX + paddleW + R) {
      const hit = clamp((b.x - (paddleX + paddleW / 2)) / (paddleW / 2), -1, 1);
      const a = hit * (Math.PI / 3);
      b.vx = Math.sin(a); b.vy = -Math.cos(a);
      b.y = PADDLE_Y - R;
      combo = 0;
      beep(220, 0.05, "triangle", 0.05);
    }

    // bricks: circle vs rect, bounce off the side we penetrated least
    for (const br of bricks) {
      if (br.hp <= 0) continue;
      const cx = clamp(b.x, br.x, br.x + BRICK_W), cy = clamp(b.y, br.y, br.y + BRICK_H);
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy >= R * R) continue;
      if (Math.abs(dx) > Math.abs(dy)) { b.vx = Math.sign(dx) * Math.abs(b.vx); b.x = cx + Math.sign(dx) * R; }
      else { const s = dy === 0 ? -Math.sign(b.vy) : Math.sign(dy); b.vy = s * Math.abs(b.vy); b.y = cy + s * R; }
      hitBrick(br);
      break; // one brick per ball per step
    }
    if (state !== "playing") return;

    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 10) b.trail.shift();
  }

  balls = balls.filter(b => b.y < H + R * 2);
  if (balls.length === 0) { loseLife(); return; }

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

function rr(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}

function text(s: string, x: number, y: number, size: number, color = "#e8e8f5", weight = "700") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(s, x, y);
}

function drawBrick(br: Brick) {
  if (br.solid) {
    ctx.fillStyle = "#4a4d70"; rr(br.x, br.y, BRICK_W, BRICK_H, 4);
    ctx.fillStyle = "rgba(255,255,255,.12)";
    for (let i = 6; i < BRICK_W; i += 10) ctx.fillRect(br.x + i, br.y + 3, 2, BRICK_H - 6);
  } else {
    ctx.globalAlpha = 0.55 + 0.45 * (br.hp / br.maxHp);
    ctx.fillStyle = ROW_COLORS[br.row % ROW_COLORS.length]; rr(br.x, br.y, BRICK_W, BRICK_H, 4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(br.x + 3, br.y + 2, BRICK_W - 6, 3);
    // pips show remaining hits on tough bricks
    if (br.maxHp > 1) {
      ctx.fillStyle = "rgba(15,16,32,.7)";
      for (let i = 0; i < br.hp; i++) {
        ctx.beginPath(); ctx.arc(br.x + BRICK_W / 2 + (i - (br.hp - 1) / 2) * 9, br.y + BRICK_H / 2 + 2, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  if (br.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${br.flash * 0.7})`; rr(br.x, br.y, BRICK_W, BRICK_H, 4); }
}

function overlay(title: string, lines: string[] = []) {
  ctx.fillStyle = "rgba(12,13,30,.72)";
  ctx.fillRect(0, 0, W, H);
  text(title, W / 2, H / 2 - 10, 44, "#ffffff", "800");
  lines.forEach((l, i) => text(l, W / 2, H / 2 + 30 + i * 28, 18, "#c9c9e6", "500"));
}

function draw() {
  ctx.save();
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  for (const br of bricks) if (br.hp > 0) drawBrick(br);

  for (const p of powers) {
    const c = POWER[p.type];
    ctx.shadowColor = c.color; ctx.shadowBlur = 12;
    ctx.fillStyle = c.color; rr(p.x - 14, p.y - 8, 28, 16, 8);
    ctx.shadowBlur = 0;
    text(c.label, p.x, p.y + 5, 13, "#12132a", "800");
  }

  // paddle
  const pg = ctx.createLinearGradient(paddleX, 0, paddleX + paddleW, 0);
  pg.addColorStop(0, "#9b82ff"); pg.addColorStop(1, "#5a3dff");
  ctx.shadowColor = "#7c5cff"; ctx.shadowBlur = 18;
  ctx.fillStyle = pg; rr(paddleX, PADDLE_Y, paddleW, PADDLE_H, 6);
  ctx.shadowBlur = 0;

  // balls
  for (const b of balls) {
    b.trail.forEach((t, i) => {
      ctx.fillStyle = `rgba(200,190,255,${(i / b.trail.length) * 0.35})`;
      ctx.beginPath(); ctx.arc(t.x, t.y, R * (i / b.trail.length), 0, Math.PI * 2); ctx.fill();
    });
    ctx.shadowColor = "#fff"; ctx.shadowBlur = 14; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2); ctx.fill();
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

  // in-canvas status line
  ctx.textAlign = "left"; ctx.font = "600 13px system-ui, sans-serif"; ctx.fillStyle = "#9d9dc4";
  const fx: string[] = [];
  if (wideT > 0) fx.push(`WIDE ${Math.ceil(wideT)}s`);
  if (slowT > 0) fx.push(`SLOW ${Math.ceil(slowT)}s`);
  ctx.fillText(fx.join("   "), 12, 28);
  if (combo > 1) text(`Combo ×${Math.min(combo, 8)}`, W - 60, 30, 16, "#feca57", "800");

  if (state === "playing" && balls.some(b => b.stuck))
    text("Click, tap or Space to launch", W / 2, PADDLE_Y - 40, 16, "#c9c9e6", "500");
  if (state === "menu") overlay("Brick Breaker", ["Pick a difficulty and press Start", "Aim with the edge of the paddle"]);
  if (state === "paused") overlay("Paused", ["Press P or Esc to resume"]);
  if (state === "clear") overlay(`Level ${level + 1} cleared!`, [`Bonus +${clearBonus.toLocaleString()}`, `Next: level ${level + 2}`]);
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
  if (state === "playing") state = "paused";
  else if (state === "paused") state = "playing";
  pauseBtn.textContent = state === "paused" ? "Resume" : "Pause";
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

canvas.addEventListener("mousemove", e => pointerTo(e.clientX));
canvas.addEventListener("click", launch);
canvas.addEventListener("touchstart", e => { pointerTo(e.touches[0].clientX); launch(); e.preventDefault(); }, { passive: false });
canvas.addEventListener("touchmove", e => { pointerTo(e.touches[0].clientX); e.preventDefault(); }, { passive: false });

addEventListener("keydown", e => {
  if (e.target instanceof HTMLSelectElement) return;
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
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "playing") togglePause(); });

loadLevel(0);
balls = [stuckBall()];
updateHud();
syncMute();
pauseBtn.disabled = true;
requestAnimationFrame(frame);

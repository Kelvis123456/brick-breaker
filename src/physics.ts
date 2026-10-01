export type Vec = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Brick = Rect & {
  hp: number;
  maxHp: number;
  row: number;
  solid: boolean;
  flash: number;
  boss?: boolean;
  vx?: number;
};
/** Where a circle touched a rect: the side's normal and the corrected circle center. */
export type Hit = { nx: number; ny: number; x: number; y: number };

export const COLS = 10;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * `v` (the ball's velocity) settles corner hits: a side normal is only used if
 * the ball is actually moving into that side. Without it, a fast ball rising
 * into the 6px seam between two bricks was read as a side hit on each in turn,
 * ping-ponging between them and damaging both several times in one touch.
 */
export function circleRect(cx: number, cy: number, r: number, b: Rect, v?: Vec): Hit | null {
  const px = clamp(cx, b.x, b.x + b.w), py = clamp(cy, b.y, b.y + b.h);
  const dx = cx - px, dy = cy - py;

  if (dx === 0 && dy === 0) {
    // center ended up inside (fast ball, or a moving boss ran into it): leave through the nearest side
    const d = [cx - b.x, b.x + b.w - cx, cy - b.y, b.y + b.h - cy];
    const i = d.indexOf(Math.min(...d));
    if (i === 0) return { nx: -1, ny: 0, x: b.x - r, y: cy };
    if (i === 1) return { nx: 1, ny: 0, x: b.x + b.w + r, y: cy };
    if (i === 2) return { nx: 0, ny: -1, x: cx, y: b.y - r };
    return { nx: 0, ny: 1, x: cx, y: b.y + b.h + r };
  }

  if (dx * dx + dy * dy >= r * r) return null;
  if (Math.abs(dx) > Math.abs(dy)) {
    const nx = Math.sign(dx);
    const leavingSide = v !== undefined && v.x * nx >= 0;
    if (!(leavingSide && dy !== 0)) return { nx, ny: 0, x: px + nx * r, y: cy };
  }
  const ny = Math.sign(dy);
  return { nx: 0, ny, x: cx, y: py + ny * r };
}

/** Point the velocity away from the surface that was hit (abs keeps a ball already leaving from being flipped back in). */
export function bounce(v: Vec, h: Hit): Vec {
  return {
    x: h.nx ? h.nx * Math.abs(v.x) : v.x,
    y: h.ny ? h.ny * Math.abs(v.y) : v.y,
  };
}

/** Hitting the paddle's edge sends the ball out at up to `maxAngle` from vertical, so the player can aim. */
export function paddleBounce(ballX: number, paddleX: number, paddleW: number, maxAngle = Math.PI / 3): Vec {
  const hit = clamp((ballX - (paddleX + paddleW / 2)) / (paddleW / 2), -1, 1);
  const a = hit * maxAngle;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** Unit vector with at least `minVy` of vertical motion, so a ball can't bounce side to side forever. */
export function steer(v: Vec, minVy = 0.3): Vec {
  const len = Math.hypot(v.x, v.y);
  let x = len ? v.x / len : 0;
  let y = len ? v.y / len : -1;
  if (Math.abs(y) < minVy) {
    y = y > 0 ? minVy : -minVy;
    x = (x < 0 ? -1 : 1) * Math.sqrt(1 - minVy * minVy);
  }
  return { x, y };
}

export const MAX_COMBO = 8;

export function pointsFor(maxHp: number, level: number, combo: number): number {
  return 10 * maxHp * (level + 1) * clamp(combo, 1, MAX_COMBO);
}

export type Grid = { gap: number; top: number; brickW: number; brickH: number };

/** Layout rows: '.' empty, '1'-'3' hit points, '#' unbreakable. */
export function parseLevel(rows: string[], g: Grid): Brick[] {
  const out: Brick[] = [];
  rows.forEach((row, r) => {
    if (row.length !== COLS) throw new Error(`row ${r} has ${row.length} columns, expected ${COLS}`);
    [...row].forEach((ch, c) => {
      if (ch === ".") return;
      if (ch !== "#" && ch !== "1" && ch !== "2" && ch !== "3") throw new Error(`unknown brick '${ch}' at row ${r}`);
      const solid = ch === "#", hp = solid ? Infinity : Number(ch);
      out.push({
        x: g.gap + c * (g.brickW + g.gap), y: g.top + r * (g.brickH + g.gap),
        w: g.brickW, h: g.brickH, hp, maxHp: hp, row: r, solid, flash: 0,
      });
    });
  });
  return out;
}

export const isCleared = (bricks: Brick[]) => bricks.every(b => b.solid || b.hp <= 0);

export const MAX_SPEED = 760;

/**
 * Ball speed for a level. The cap applies before Slow: capping after it meant
 * that once the base speed passed the cap (late laps), Slow showed its timer
 * but changed nothing.
 */
export function ballSpeed(base: number, level: number, boost: number, slowed: boolean): number {
  return Math.min(base * (1 + 0.07 * level) * boost, MAX_SPEED) * (slowed ? 0.7 : 1);
}

/**
 * Move a patrolling block between `lo` and `hi` (its left edge), bouncing at the ends.
 * Callers keep `lo`/`hi` a ball's width away from the walls: a boss that touched
 * the wall pinned a ball against it and took a hit every physics step.
 */
export function patrol(x: number, vx: number, w: number, dt: number, lo: number, hi: number): { x: number; vx: number } {
  const nx = x + vx * dt;
  if (nx < lo) return { x: lo, vx: Math.abs(vx) };
  if (nx + w > hi) return { x: hi - w, vx: -Math.abs(vx) };
  return { x: nx, vx };
}

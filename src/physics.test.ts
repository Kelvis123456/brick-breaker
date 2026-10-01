import { describe, expect, it } from "vitest";
import { ballSpeed, bounce, circleRect, clamp, isCleared, paddleBounce, parseLevel, patrol, pointsFor, steer, MAX_COMBO, MAX_SPEED, type Brick } from "./physics";
import { LEVELS, levelAt } from "./levels";

const box = { x: 100, y: 100, w: 60, h: 20 };
const R = 7;
const grid = { gap: 6, top: 56, brickW: 57.4, brickH: 20 };

describe("circleRect", () => {
  it("misses when the circle is clear of the rect", () => {
    expect(circleRect(50, 50, R, box)).toBeNull();
  });

  it("misses when exactly touching (no overlap)", () => {
    expect(circleRect(100 - R, 110, R, box)).toBeNull();
  });

  it("hits the top and pushes the ball out above", () => {
    const h = circleRect(130, 95, R, box)!;
    expect(h).toMatchObject({ nx: 0, ny: -1 });
    expect(h.y).toBe(100 - R);
  });

  it("hits the bottom", () => {
    expect(circleRect(130, 124, R, box)).toMatchObject({ nx: 0, ny: 1, y: 120 + R });
  });

  it("hits the left and right sides", () => {
    expect(circleRect(96, 110, R, box)).toMatchObject({ nx: -1, ny: 0, x: 100 - R });
    expect(circleRect(164, 110, R, box)).toMatchObject({ nx: 1, ny: 0, x: 160 + R });
  });

  it("resolves a corner hit along the axis with more penetration room", () => {
    // 4px left of the corner, 2px above it: mostly a side hit
    expect(circleRect(96, 98, R, box)).toMatchObject({ nx: -1, ny: 0 });
    expect(circleRect(98, 96, R, box)).toMatchObject({ nx: 0, ny: -1 });
  });

  it("with a velocity, treats a corner touch as vertical when the ball moves away from that side", () => {
    // 3px right of the bottom-right corner, 1px below it: geometrically a side hit,
    // but the ball is rising and drifting right, i.e. away from the right face
    expect(circleRect(163, 121, R, box, { x: 0.3, y: -1 })).toMatchObject({ nx: 0, ny: 1, y: 120 + R });
  });

  it("with a velocity, keeps the side hit when the ball moves into that side", () => {
    expect(circleRect(163, 121, R, box, { x: -0.5, y: -1 })).toMatchObject({ nx: 1, ny: 0 });
    // dead-center side contact has no vertical component to fall back to
    expect(circleRect(164, 110, R, box, { x: 0.5, y: -1 })).toMatchObject({ nx: 1, ny: 0 });
  });

  it("damages a seam pair once, not back and forth, for a fast ball rising into the gap", () => {
    // two bricks 6px apart, ball rising at the 760px/s cap (6.3px per 1/120s step)
    const a = { x: 0, y: 0, w: 57, h: 20 }, b = { x: 63, y: 0, w: 57, h: 20 };
    for (const into of [1, 3]) {
      let x = 60 + into, y = 30, vx = 0.15, vy = -1;
      const hits: string[] = [];
      for (let i = 0; i < 20; i++) {
        x += vx * 6.3; y += vy * 6.3;
        for (const [name, br] of [["A", a], ["B", b]] as const) {
          const h = circleRect(x, y, R, br, { x: vx, y: vy });
          if (!h) continue;
          x = h.x; y = h.y;
          ({ x: vx, y: vy } = bounce({ x: vx, y: vy }, h));
          hits.push(name);
          break;
        }
      }
      expect(hits.length).toBe(1);
      expect(vy).toBeGreaterThan(0); // bounced back down instead of sliding up the seam
    }
  });

  it("pushes a ball whose center is inside out through the nearest side", () => {
    expect(circleRect(102, 110, R, box)).toMatchObject({ nx: -1, x: 100 - R });
    expect(circleRect(158, 110, R, box)).toMatchObject({ nx: 1, x: 160 + R });
    expect(circleRect(130, 101, R, box)).toMatchObject({ ny: -1, y: 100 - R });
    expect(circleRect(130, 119, R, box)).toMatchObject({ ny: 1, y: 120 + R });
  });

  it("never leaves the corrected circle overlapping the rect", () => {
    for (let x = 85; x <= 175; x += 3) for (let y = 85; y <= 135; y += 3) {
      const h = circleRect(x, y, R, box);
      if (h) expect(circleRect(h.x, h.y, R, box)).toBeNull();
    }
  });
});

describe("bounce", () => {
  it("flips vertical velocity on a top hit", () => {
    expect(bounce({ x: 0.5, y: 0.8 }, { nx: 0, ny: -1, x: 0, y: 0 })).toEqual({ x: 0.5, y: -0.8 });
  });

  it("doesn't send a ball that's already leaving back into the brick", () => {
    // already moving up, touching the top: must keep moving up
    expect(bounce({ x: 0.5, y: -0.8 }, { nx: 0, ny: -1, x: 0, y: 0 }).y).toBe(-0.8);
  });

  it("flips horizontal velocity on a side hit", () => {
    expect(bounce({ x: 0.6, y: -0.8 }, { nx: -1, ny: 0, x: 0, y: 0 })).toEqual({ x: -0.6, y: -0.8 });
  });
});

describe("paddleBounce", () => {
  it("goes straight up from the center", () => {
    const v = paddleBounce(150, 100, 100);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(-1);
  });

  it("angles left and right from the edges, capped at 60°", () => {
    const l = paddleBounce(100, 100, 100), r = paddleBounce(200, 100, 100);
    expect(l.x).toBeCloseTo(-Math.sin(Math.PI / 3));
    expect(r.x).toBeCloseTo(Math.sin(Math.PI / 3));
    expect(l.y).toBeLessThan(0);
  });

  it("clamps hits past the paddle edge (ball radius overhang)", () => {
    expect(paddleBounce(250, 100, 100)).toEqual(paddleBounce(200, 100, 100));
  });

  it("always returns a unit vector going up", () => {
    for (let x = 90; x <= 210; x += 5) {
      const v = paddleBounce(x, 100, 100);
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
      expect(v.y).toBeLessThan(0);
    }
  });
});

describe("steer", () => {
  it("normalizes", () => {
    const v = steer({ x: 3, y: -4 });
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(-0.8);
  });

  it("forces some vertical motion on a near-horizontal ball, keeping direction", () => {
    const v = steer({ x: -1, y: 0.01 });
    expect(v.y).toBeCloseTo(0.3);
    expect(v.x).toBeLessThan(0);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
  });

  it("handles a perfectly horizontal ball (vy = 0) by sending it up", () => {
    const v = steer({ x: 1, y: 0 });
    expect(v.y).toBeCloseTo(-0.3);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
  });

  it("handles a zero vector without NaN", () => {
    const v = steer({ x: 0, y: 0 });
    expect(Number.isNaN(v.x) || Number.isNaN(v.y)).toBe(false);
    expect(v.y).toBe(-1);
  });
});

describe("pointsFor", () => {
  it("scales with hit points, level and combo", () => {
    expect(pointsFor(1, 0, 1)).toBe(10);
    expect(pointsFor(3, 0, 1)).toBe(30);
    expect(pointsFor(1, 2, 1)).toBe(30);
    expect(pointsFor(1, 0, 4)).toBe(40);
  });

  it("caps the combo multiplier", () => {
    expect(pointsFor(1, 0, 50)).toBe(10 * MAX_COMBO);
  });

  it("treats combo 0 as ×1", () => {
    expect(pointsFor(1, 0, 0)).toBe(10);
  });
});

describe("parseLevel", () => {
  it("places bricks on the grid and skips empty cells", () => {
    const b = parseLevel(["1.........", ".2........"], grid);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ x: 6, y: 56, hp: 1, row: 0, solid: false });
    expect(b[1]).toMatchObject({ x: 6 + 57.4 + 6, y: 56 + 26, hp: 2, maxHp: 2, row: 1 });
  });

  it("makes '#' bricks unbreakable", () => {
    const [b] = parseLevel(["#........."], grid);
    expect(b.solid).toBe(true);
    expect(b.hp).toBe(Infinity);
  });

  it("rejects rows with the wrong width", () => {
    expect(() => parseLevel(["111"], grid)).toThrow(/3 columns/);
  });

  it("rejects unknown characters", () => {
    expect(() => parseLevel(["1111x11111"], grid)).toThrow(/unknown brick 'x'/);
  });

  it("parses every shipped level", () => {
    for (const l of LEVELS) expect(() => parseLevel(l.rows, grid)).not.toThrow();
  });

  it("every shipped level has something to break", () => {
    for (const l of LEVELS) expect(isCleared(parseLevel(l.rows, grid))).toBe(false);
  });
});

describe("isCleared", () => {
  const mk = (hp: number, solid = false) => ({ hp, solid } as Brick);
  it("ignores unbreakable bricks", () => expect(isCleared([mk(Infinity, true), mk(0)])).toBe(true));
  it("is false while anything breakable remains", () => expect(isCleared([mk(0), mk(1)])).toBe(false));
  it("is true for an empty board", () => expect(isCleared([])).toBe(true));
});

describe("levelAt", () => {
  it("cycles through levels and counts laps", () => {
    expect(levelAt(0)).toMatchObject({ def: LEVELS[0], loop: 0 });
    expect(levelAt(LEVELS.length - 1).def.boss).toBe(true);
    expect(levelAt(LEVELS.length)).toMatchObject({ def: LEVELS[0], loop: 1 });
  });
});

describe("clamp", () => {
  it("clamps both ends", () => {
    expect(clamp(-1, 0, 5)).toBe(0);
    expect(clamp(9, 0, 5)).toBe(5);
    expect(clamp(3, 0, 5)).toBe(3);
  });
});

describe("ballSpeed", () => {
  it("scales with level and boost below the cap", () => {
    expect(ballSpeed(360, 0, 1, false)).toBe(360);
    expect(ballSpeed(360, 10, 1, false)).toBeCloseTo(360 * 1.7);
  });

  it("caps at MAX_SPEED", () => {
    expect(ballSpeed(430, 30, 1.35, false)).toBe(MAX_SPEED);
  });

  it("still slows the ball after the cap kicks in (late laps)", () => {
    expect(ballSpeed(430, 30, 1.35, true)).toBeCloseTo(MAX_SPEED * 0.7);
    expect(ballSpeed(430, 30, 1.35, true)).toBeLessThan(ballSpeed(430, 30, 1.35, false));
  });
});

describe("patrol", () => {
  it("moves freely inside the lane", () => {
    expect(patrol(100, 90, 160, 0.1, 20, 620)).toEqual({ x: 109, vx: 90 });
  });

  it("bounces off the left bound without crossing it", () => {
    expect(patrol(21, -90, 160, 0.1, 20, 620)).toEqual({ x: 20, vx: 90 });
  });

  it("bounces off the right bound with its right edge on it", () => {
    expect(patrol(459, 90, 160, 0.1, 20, 620)).toEqual({ x: 460, vx: -90 });
  });

  it("leaves room for a ball against the wall: lane starts a ball-width in", () => {
    const GAP = 6, R = 7, W = 640;
    let x = 200, vx = -300, minX = Infinity, maxRight = 0;
    for (let i = 0; i < 2000; i++) {
      ({ x, vx } = patrol(x, vx, 160, 1 / 120, GAP + 2 * R, W - GAP - 2 * R));
      minX = Math.min(minX, x); maxRight = Math.max(maxRight, x + 160);
    }
    // a ball hugging a wall spans 2R from it; the boss never reaches into that lane
    expect(minX).toBeGreaterThanOrEqual(2 * R);
    expect(maxRight).toBeLessThanOrEqual(W - 2 * R);
  });
});

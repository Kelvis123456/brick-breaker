import { describe, expect, it } from "vitest";
import { bounce, circleRect, clamp, isCleared, paddleBounce, parseLevel, pointsFor, steer, MAX_COMBO, type Brick } from "./physics";
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

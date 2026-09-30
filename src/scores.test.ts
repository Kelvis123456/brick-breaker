import { describe, expect, it } from "vitest";
import { insertScore, parseScores, qualifies, MAX_SCORES, type ScoreEntry } from "./scores";

const e = (score: number, name = "A"): ScoreEntry => ({ name, score, level: 1, diff: "normal" });
const full = [e(500), e(400), e(300), e(200), e(100)];

describe("parseScores", () => {
  it("returns [] for missing, corrupt or non-array data", () => {
    expect(parseScores(null)).toEqual([]);
    expect(parseScores("")).toEqual([]);
    expect(parseScores("{not json")).toEqual([]);
    expect(parseScores('{"name":"x"}')).toEqual([]);
  });

  it("drops malformed entries", () => {
    const raw = JSON.stringify([
      e(100), null, 5, { name: 7, score: 1, level: 1, diff: "x" },
      { name: "neg", score: -5, level: 1, diff: "x" },
      { name: "nan", score: "999", level: 1, diff: "x" },
      { name: "lvl", score: 5, level: 0, diff: "x" },
      { name: "frac", score: 5, level: 1.5, diff: "x" },
    ]);
    expect(parseScores(raw)).toEqual([e(100)]);
  });

  it("sorts, truncates long names and keeps only the top entries", () => {
    const raw = JSON.stringify([e(1), e(9, "x".repeat(40)), e(5), e(3), e(7), e(8), e(2)]);
    const s = parseScores(raw);
    expect(s.map(x => x.score)).toEqual([9, 8, 7, 5, 3]);
    expect(s[0].name).toHaveLength(12);
  });
});

describe("qualifies", () => {
  it("never for zero", () => expect(qualifies([], 0)).toBe(false));
  it("always while the list has room", () => expect(qualifies([e(500)], 1)).toBe(true));
  it("only above the lowest score when full", () => {
    expect(qualifies(full, 100)).toBe(false);
    expect(qualifies(full, 101)).toBe(true);
  });
});

describe("insertScore", () => {
  it("inserts in order and reports the rank", () => {
    const r = insertScore(full, e(350, "new"));
    expect(r.rank).toBe(2);
    expect(r.list.map(x => x.score)).toEqual([500, 400, 350, 300, 200]);
    expect(r.list).toHaveLength(MAX_SCORES);
  });

  it("places ties below the existing entry", () => {
    const r = insertScore([e(300, "old")], e(300, "new"));
    expect(r.rank).toBe(1);
    expect(r.list.map(x => x.name)).toEqual(["old", "new"]);
  });

  it("returns rank -1 when the score doesn't fit", () => {
    expect(insertScore(full, e(50)).rank).toBe(-1);
  });

  it("works on an empty list", () => {
    expect(insertScore([], e(10))).toEqual({ list: [e(10)], rank: 0 });
  });

  it("doesn't mutate the input", () => {
    const copy = [...full];
    insertScore(full, e(999));
    expect(full).toEqual(copy);
  });
});

export type ScoreEntry = { name: string; score: number; level: number; diff: string };

export const MAX_SCORES = 5;
export const MAX_NAME = 12;

/** localStorage can hold anything (old versions, hand edits), so only keep entries that look right. */
export function parseScores(raw: string | null): ScoreEntry[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  return data
    .filter(e => e && typeof e.name === "string" && Number.isFinite(e.score) && e.score >= 0 &&
      Number.isInteger(e.level) && e.level >= 1 && typeof e.diff === "string")
    .map((e): ScoreEntry => ({ name: e.name.slice(0, MAX_NAME), score: e.score, level: e.level, diff: e.diff }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SCORES);
}

export function qualifies(list: ScoreEntry[], score: number): boolean {
  return score > 0 && (list.length < MAX_SCORES || score > list[list.length - 1].score);
}

/** Ties go below the existing entry: whoever got there first keeps the spot. rank is -1 if it didn't make the list. */
export function insertScore(list: ScoreEntry[], entry: ScoreEntry): { list: ScoreEntry[]; rank: number } {
  let i = list.findIndex(e => entry.score > e.score);
  if (i === -1) i = list.length;
  const next = [...list];
  next.splice(i, 0, entry);
  return { list: next.slice(0, MAX_SCORES), rank: i < MAX_SCORES ? i : -1 };
}

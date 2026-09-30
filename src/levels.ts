export type LevelDef = { name: string; rows: string[]; boss?: boolean };

export const LEVELS: LevelDef[] = [
  { name: "Warm-up", rows: ["1111111111", "1111111111", "1111111111", "1111111111"] },
  { name: "Pyramid", rows: ["....22....", "...2112...", "..211112..", ".21111112.", "2111111112"] },
  { name: "Checkers", rows: ["2.2.2.2.2.", ".1.1.1.1.1", "2.2.2.2.2.", ".1.1.1.1.1", "##..##..##"] },
  { name: "Invader", rows: ["..2....2..", "...2..2...", "..222222..", ".22322322.", "2222222222", "2.222222.2", "2.2....2.2", "...22.22.."] },
  { name: "Fortress", rows: ["##########", "#32222223#", "#21111112#", "#21111112#", "#32222223#", "....##...."] },
  // the boss itself is spawned in main.ts; these are its guards
  { name: "Boss", rows: ["..........", "..........", "11..##..11", ".1......1."], boss: true },
];

/** Levels repeat after the boss; `loop` counts how many times, and makes each lap harder. */
export function levelAt(n: number) {
  return { def: LEVELS[n % LEVELS.length], loop: Math.floor(n / LEVELS.length) };
}

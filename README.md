# Brick Breaker

**Play it:** https://brick-breaker-kelvis.vercel.app

A brick breaker in TypeScript and a plain `<canvas>`, with no game engine or framework. It started as a 30-minute technical assessment, and I kept going afterwards to finish it properly.

## What's in it

- **6 levels**: five layouts and a boss. The boss is a moving block with 20 HP, eyes that follow the ball and an HP bar. After the boss the levels loop, and each lap is faster and the boss tougher.
- **Special bricks**: some take 2 or 3 hits (the dots show how many are left) and the grey metal ones never break.
- **Power-ups** drop from broken bricks: wide paddle, multiball (up to 12 balls), slow ball, lasers, fireball (plows through bricks without bouncing) and an extra life.
- **Combos**: breaking bricks in a row without touching the paddle multiplies points up to ×8. Tougher bricks and later levels are worth more.
- **3 difficulties** (Easy has 5 lives, Normal 3, Hard 2 with a faster ball).
- **Top 5 scores** saved in the browser, with a name.
- Sound effects are synthesized with the Web Audio API, so there are no audio files.
- Mouse, touch and keyboard controls. It pauses on its own when you switch tabs.

## A few decisions worth explaining

**Fixed-step physics.** The first version moved the ball a fixed amount each frame, so on a 144Hz monitor the game ran more than twice as fast as on a 60Hz one. Physics now runs at a fixed 120 steps per second, whatever the frame rate. That's also small enough per step that the ball can't tunnel through a brick at top speed.

**Collision is its own tested module.** `src/physics.ts` has no DOM or canvas in it, just circle-vs-rect hits, bounces, paddle angles and level parsing. That's the part that's easy to get subtly wrong: a ball stuck inside a brick, a ball flipped back into a brick it was already leaving, or a ball bouncing sideways forever. So it has the tests. One of them sweeps a grid of positions around a brick and checks that the corrected position never still overlaps.

**Saved scores are treated as untrusted.** Anything in localStorage could be from an old version or edited by hand, so `parseScores` validates every entry and drops the bad ones. Names are rendered with `textContent`, never `innerHTML`.

**Unbreakable bricks don't count toward clearing a level**, and every shipped level is checked in a test to make sure it's actually clearable.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest, physics + scoreboard logic
npm run build    # typecheck + production build in dist/
```

## Controls

Mouse, touch, ← → or A/D to move · Space or click to launch · P or Esc to pause · M to mute · Enter to start

## Structure

```
src/
├─ main.ts      game loop, rendering, input, sound, UI
├─ physics.ts   collision, bounces, scoring, level parsing (pure, tested)
├─ levels.ts    level layouts as strings: '.' empty, '1'-'3' hits, '#' metal
└─ scores.ts    top-5 scoreboard: parse, qualify, insert (pure, tested)
```

## Not done

The scoreboard is per browser. An online one would need a backend, and I didn't want one for a single-page game.

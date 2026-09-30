import { expect, test, type Page } from "@playwright/test";

// window.__bb is a dev-only handle exposed by main.ts
type BB = {
  state: string; score: number; level: number; lives: number; paddleW: number;
  balls: { x: number; y: number; stuck: boolean }[];
  bricks: { x: number; w: number; hp: number; solid: boolean; boss?: boolean }[];
  top: unknown[];
  setPaddle(x: number): void; launch(): void; applyPower(t: string): void; startLevel(n: number): void; dropAll(): void;
};
declare global { interface Window { __bb: BB; __auto?: number } }

// runs fn in the page with the game handle; fn must be self-contained (it's serialized)
const bb = <T>(page: Page, fn: (b: BB) => T) => page.evaluate(`(${fn.toString()})(window.__bb)`) as Promise<T>;

async function autopilot(page: Page) {
  await page.evaluate(() => {
    window.__auto = window.setInterval(() => {
      const g = window.__bb;
      const ball = g.balls.filter(x => !x.stuck).sort((a, c) => c.y - a.y)[0];
      if (ball) g.setPaddle(ball.x - g.paddleW / 2 + (Math.random() - 0.5) * 40);
      if (g.state === "playing" && g.balls.some(x => x.stuck)) g.launch();
    }, 4);
  });
}
const stopAutopilot = (page: Page) => page.evaluate(() => clearInterval(window.__auto));

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto("/");
  await page.waitForFunction(() => window.__bb);
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { errors: string[] }).errors).toEqual([]);
});

test("menu: cursor visible, pause disabled, empty scoreboard", async ({ page }) => {
  await expect(page.locator("#game")).toHaveCSS("cursor", "auto");
  await expect(page.locator("#pause")).toBeDisabled();
  await expect(page.locator("#top")).toContainText("No scores yet");
});

test("playing: cursor hidden, difficulty locked, scores go up", async ({ page }) => {
  await page.click("#start");
  await expect(page.locator("#game")).toHaveCSS("cursor", "none");
  await expect(page.locator("#difficulty")).toBeDisabled();
  await autopilot(page);
  await expect.poll(() => bb(page, b => b.score), { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.locator("#score")).not.toHaveText("0");
});

test("clearing a level advances to the next one", async ({ page }) => {
  await page.click("#start");
  await autopilot(page);
  await bb(page, b => b.bricks.filter(k => !k.solid && k.hp > 0).slice(1).forEach(k => { k.hp = 0; }));
  await expect.poll(() => bb(page, b => b.level), { timeout: 40000 }).toBe(1);
  await expect(page.locator("#level")).toHaveText("2");
});

test("boss patrols and lasers damage it through the gaps", async ({ page }) => {
  await page.click("#start");
  await bb(page, b => b.startLevel(5));
  const start = await bb(page, b => { const k = b.bricks.find(x => x.boss)!; return { hp: k.hp, x: k.x }; });
  await bb(page, b => b.applyPower("laser"));
  // track the boss so bolts go past the metal guards; ball stays on the paddle
  await page.evaluate(() => {
    window.__auto = window.setInterval(() => {
      const k = window.__bb.bricks.find(x => x.boss)!;
      window.__bb.setPaddle(k.x + k.w / 2 - window.__bb.paddleW / 2);
    }, 16);
  });
  await expect.poll(() => bb(page, b => b.bricks.find(x => x.boss)!.hp), { timeout: 8000 }).toBeLessThan(start.hp);
  expect(await bb(page, b => b.bricks.find(x => x.boss)!.x)).not.toBe(start.x);
  await stopAutopilot(page);
});

test("fireball plows through several bricks; multiball adds balls", async ({ page }) => {
  await page.click("#start");
  await bb(page, b => { b.launch(); b.applyPower("fire"); });
  const before = await bb(page, b => b.bricks.filter(k => k.hp > 0).length);
  await autopilot(page);
  await expect.poll(async () => before - await bb(page, b => b.bricks.filter(k => k.hp > 0).length), { timeout: 8000 }).toBeGreaterThanOrEqual(4);
  await bb(page, b => b.applyPower("multi"));
  expect(await bb(page, b => b.balls.length)).toBeGreaterThanOrEqual(3);
  await stopAutopilot(page);
});

test("game over -> save name with Enter -> scoreboard persists and escapes HTML", async ({ page }) => {
  await page.click("#start");
  await autopilot(page);
  await expect.poll(() => bb(page, b => b.score), { timeout: 15000 }).toBeGreaterThan(0);
  await stopAutopilot(page);
  await bb(page, b => b.dropAll());
  await expect.poll(() => bb(page, b => b.state)).toBe("over");

  const dialog = page.locator("#nameDialog");
  await expect(dialog).toBeVisible();
  await page.fill("#nameInput", "<b>Kel</b>");
  await page.keyboard.press("Enter"); // Enter must save, not skip
  await expect(dialog).toBeHidden();

  const first = page.locator("#top li").first();
  await expect(first).toHaveClass(/you/);
  await expect(first.locator("span")).toHaveText("<b>Kel</b>"); // shown literally, not parsed as markup
  expect(await first.locator("b").count()).toBe(1); // only the score's own <b>

  await page.reload();
  await page.waitForFunction(() => window.__bb);
  expect(await bb(page, b => b.top.length)).toBe(1);
  await expect(page.locator("#top li span").first()).toHaveText("<b>Kel</b>");
});

test("skip in the name dialog doesn't save", async ({ page }) => {
  await page.click("#start");
  await autopilot(page);
  await expect.poll(() => bb(page, b => b.score), { timeout: 15000 }).toBeGreaterThan(0);
  await stopAutopilot(page);
  await bb(page, b => b.dropAll());
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.locator("#nameDialog")).toBeHidden();
  expect(await bb(page, b => b.top.length)).toBe(0);
});

test("corrupt saved scores don't break startup", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("bb-top", "{garbage"));
  await page.reload();
  await page.waitForFunction(() => window.__bb);
  expect(await bb(page, b => b.top.length)).toBe(0);
  await expect(page.locator("#top")).toContainText("No scores yet");
});

test("P pauses, Esc resumes", async ({ page }) => {
  await page.click("#start");
  await page.keyboard.press("p");
  expect(await bb(page, b => b.state)).toBe("paused");
  await expect(page.locator("#pause")).toHaveText("Resume");
  await page.keyboard.press("Escape");
  expect(await bb(page, b => b.state)).toBe("playing");
});

test("no horizontal scroll", async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

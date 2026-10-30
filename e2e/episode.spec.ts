import { expect, test } from "@playwright/test";
import { PAPER, tinyPdf } from "./pdf";

// Demo mode: placeholder scripts and silent audio, so every step runs without keys or spend.
// Every surface is shown (Settings → show everything), so the research map is there after one episode.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("evocast-settings", JSON.stringify({ keys: { llmProvider: "mock" }, uiLang: "en", ttsOverride: {}, ttsMultiplier: 1, voiceOverrides: {}, onboarded: true, analytics: false, showAll: true }));
  });
});

test("a dropped PDF plays within seconds, arrives chapter by chapter, takes a question, and joins the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({ name: "attention.pdf", mimeType: "application/pdf", buffer: tinyPdf(PAPER) });
  await expect(page.locator(".recipe")).toBeVisible();
  await expect(page.locator(".recipe")).toContainText("English");

  const t0 = Date.now();
  await page.getByRole("main").getByRole("button", { name: "Create" }).click();

  // The player opens by itself on the cold open, and the transcript fills in.
  const player = page.getByRole("dialog", { name: "Now playing" });
  await expect(player).toBeVisible();
  const firstSound = Date.now() - t0;
  expect(firstSound).toBeLessThan(10_000);
  await expect(player.locator(".t-line").first()).toBeVisible();
  // Every chapter is listed, and the episode ends up saved in full.
  await expect(player.locator(".chapters li")).toHaveCount(3);
  await expect(player.getByText(/Checks \d+\/\d+/)).toBeVisible({ timeout: 30_000 });

  // Raise hand by typing (hold the button), and the hosts answer where it was asked.
  const hand = player.getByRole("button", { name: /Raise hand/ });
  await hand.dispatchEvent("pointerdown");
  await page.waitForTimeout(500);
  await hand.dispatchEvent("pointerup");
  await player.getByPlaceholder("Ask the hosts a question").fill("Why can it train in parallel?");
  await player.getByRole("button", { name: "Ask", exact: true }).click();
  const ask = player.locator("[data-ask]");
  await expect(ask).toContainText("Why can it train in parallel?");
  await expect(ask.locator(".t-line")).toHaveCount(2);

  // Close the player: the episode is in the library, and the research map shows it.
  await player.getByRole("button", { name: "Close" }).click();
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("button", { name: "Listen" }).click();
  await expect(page.locator(".ep-card")).toHaveCount(1);
  await nav.getByRole("button", { name: "You" }).click();
  await expect(page.getByRole("img", { name: /Research map/ })).toBeVisible();

  expect(errors).toEqual([]);
});

test("without streaming playback (older iPhones), the episode still plays while it is made", async ({ page }) => {
  await page.addInitScript(() => {
    // As on iOS before 17.1: no MediaSource of either kind.
    Object.defineProperty(window, "MediaSource", { value: undefined, configurable: true });
    Object.defineProperty(window, "ManagedMediaSource", { value: undefined, configurable: true });
  });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({ name: "attention.pdf", mimeType: "application/pdf", buffer: tinyPdf(PAPER) });
  await page.getByRole("main").getByRole("button", { name: "Create" }).click();
  const player = page.getByRole("dialog", { name: "Now playing" });
  await expect(player).toBeVisible();
  // It plays from a growing file: time moves, and the whole episode arrives.
  await expect.poll(() => page.evaluate(() => (document.querySelector("audio[preload=metadata]") as HTMLAudioElement | null)?.currentTime ?? 0), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await expect(player.getByText(/Checks \d+\/\d+/)).toBeVisible({ timeout: 30_000 });
});

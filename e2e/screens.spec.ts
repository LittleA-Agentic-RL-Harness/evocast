import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { bottomClear, layoutIssues } from "./layout";
import { PAPER, tinyPdf } from "./pdf";

// Every screen at the sizes people really use, on each engine: nothing scrolls sideways, runs off
// the screen, hides under something else or gets cut off; the player always fits; on touch screens
// targets are big enough and fields don't make Safari zoom. AUDIT=1 sweeps every size (slow);
// AUDIT_DIR=path also keeps a screenshot of each screen.

const PHONES: [number, number][] = [[320, 568], [360, 740], [375, 667], [390, 844], [430, 932], [844, 390]];
const DESKTOPS: [number, number][] = [[768, 1024], [820, 1180], [1024, 768], [1180, 820], [900, 700], [1280, 640], [1280, 800], [1440, 900], [1512, 982], [1728, 1117], [1920, 1080], [2560, 1440]];
const QUICK: Record<string, [number, number][]> = { phone: [[360, 740]], iphone: [[390, 844]] };
const full = Boolean(process.env.AUDIT);

const settings = (uiLang: "zh" | "en") => JSON.stringify({ keys: { llmProvider: "mock" }, uiLang, ttsOverride: {}, ttsMultiplier: 1, voiceOverrides: {}, onboarded: true, analytics: false, showAll: true });

for (const lang of ["zh", "en"] as const) {
  test.describe(`screens (${lang})`, () => {
    for (const size of [...PHONES, ...DESKTOPS]) {
      test(`${size[0]}×${size[1]}`, async ({ page }, info) => {
        const touch = Boolean(info.project.use.hasTouch);
        const mine = touch ? PHONES : DESKTOPS;
        const quick = QUICK[info.project.name] ?? [[1280, 800]];
        test.skip(!mine.some((s) => s[0] === size[0] && s[1] === size[1]), "not this device's size");
        test.skip(!full && !quick.some((s) => s[0] === size[0] && s[1] === size[1]), "AUDIT=1 for every size");
        test.skip(!full && lang === "en" && !touch, "English on phones only unless AUDIT=1");
        test.setTimeout(120_000);
        await page.setViewportSize({ width: size[0], height: size[1] });
        const issues: string[] = [];
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const dir = process.env.AUDIT_DIR ? `${process.env.AUDIT_DIR}/${info.project.name}-${lang}-${size[0]}x${size[1]}` : null;
        if (dir) mkdirSync(dir, { recursive: true });
        let n = 0;
        const look = async (screen: string, page_ = false) => {
          await page.waitForTimeout(350);
          for (const i of await layoutIssues(page, touch)) issues.push(`${screen}: ${i}`);
          if (page_) for (const i of await bottomClear(page)) issues.push(`${screen}: ${i}`);
          if (dir) await page.screenshot({ path: `${dir}/${String(++n).padStart(2, "0")}-${screen}.png` });
        };

        // Welcome, before keys.
        await page.goto("/");
        await look("welcome");
        // Onboarding's key step: two fields and a link per key.
        await page.locator(".btn.primary").first().click();
        await look("keys");

        await page.evaluate((s) => localStorage.setItem("evocast-settings", s), settings(lang));
        // Slow the reading down so the waiting screens can be seen.
        await page.route("**/api/brief", async (r) => {
          await new Promise((x) => setTimeout(x, 5000));
          await r.continue();
        });
        await page.reload();
        await look("home");

        await page.locator("input[type=file]").setInputFiles({ name: "attention.pdf", mimeType: "application/pdf", buffer: tinyPdf(PAPER) });
        await expect(page.locator(".recipe")).toBeVisible();
        await look("recipe");
        await page.locator(".recipe button").nth(2).click();
        await look("language-menu");
        await page.keyboard.press("Escape");

        await page.locator("[data-track=create]").click();
        await look("steps");
        const player = page.locator(".sheet.player");
        await expect(player).toBeVisible({ timeout: 15_000 });
        await look("player-cold-open");

        const hand = player.locator(".np-hand");
        await hand.dispatchEvent("pointerdown");
        await page.waitForTimeout(500);
        await hand.dispatchEvent("pointerup");
        await expect(player.locator(".ask-input")).toBeVisible();
        await look("player-typing");
        await player.locator(".ask-input").fill(lang === "zh" ? "为什么能并行训练？" : "Why can it train in parallel?");
        await player.locator(".ask-input").press("Enter");
        await expect(player.locator("[data-ask] .t-line")).toHaveCount(2, { timeout: 20_000 });
        await look("player-answer");

        await expect(player.locator(".chapters li, .np-title .caption").first()).toBeVisible();
        await expect(player.getByText(/校验|Checks/).first()).toBeVisible({ timeout: 40_000 });
        await look("player-done");

        await player.locator(".np-head button").last().click();
        const nav = page.getByRole("navigation", { name: lang === "zh" ? "主导航" : "Main" }).or(page.locator("nav").first());
        await nav.getByRole("button").nth(1).click();
        await look("listen", true);
        await nav.getByRole("button").nth(2).click();
        await look("you", true);
        await page.locator("header button").last().click();
        await look("settings", true);

        if (dir) writeFileSync(`${dir}/issues.json`, JSON.stringify({ errors, issues }, null, 1));
        expect(errors, "page errors").toEqual([]);
        expect(issues, "layout issues").toEqual([]);
      });
    }
  });
}

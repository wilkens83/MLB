/* Playwright smoke + screenshots for the AI Data Chat (/chat).
   Drives a real conversation against the running dev server:
   opens /chat, submits a question, waits for the structured response,
   asks a follow-up, and captures desktop + mobile screenshots. */

import { chromium } from "playwright";

const dir = process.env.SHOT_DIR || "/tmp/claude-0/-home-user-MLB/b675d821-8f26-5f43-9508-1ca8d55ae816/scratchpad";
const B = process.env.CHAT_BASE || "http://localhost:3000";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: exe });

async function run() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`${B}/chat`, { waitUntil: "networkidle", timeout: 30000 });

  // Empty state visible?
  await page.waitForSelector("text=AI Data Chat", { timeout: 15000 });
  await page.screenshot({ path: `${dir}/chat-empty.png`, fullPage: false });
  console.log("shot chat-empty");

  // Click a suggestion (empty-state chip).
  await page.click("text=Which pitchers have the best strikeout projections today?");
  // Wait for the assistant response table to render.
  await page.waitForSelector("table", { timeout: 40000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/chat-response.png`, fullPage: true });
  console.log("shot chat-response");

  // Follow-up via composer.
  const ta = await page.waitForSelector("textarea");
  await ta.fill("Only show players with a probability above 60%");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${dir}/chat-followup.png`, fullPage: true });
  console.log("shot chat-followup");

  await ctx.close();

  // Mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const mp = await m.newPage();
  await mp.goto(`${B}/chat`, { waitUntil: "networkidle", timeout: 30000 });
  await mp.waitForSelector("text=AI Data Chat", { timeout: 15000 });
  await mp.screenshot({ path: `${dir}/chat-mobile.png`, fullPage: false });
  console.log("shot chat-mobile");
  await m.close();
}

try {
  await run();
  console.log("CHAT SMOKE OK");
} catch (e) {
  console.error("CHAT SMOKE FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

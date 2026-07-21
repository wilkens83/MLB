import { chromium } from "playwright";

const dir = "/tmp/claude-0/-home-user-MLB/738e9ca2-c43b-5020-adf8-fa59c970cda0/scratchpad";
const B = "http://localhost:3100";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function ctx(theme = "dark", w = 1440, h = 1024) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  return c;
}

// 1) Slate with a hitter selected + Overview
{
  const c = await ctx();
  const page = await c.newPage();
  await page.goto(B + "/slate", { waitUntil: "networkidle", timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(3000);
  // Click the 3rd player row (skip pitchers) — index tuned to land on a hitter
  const rows = await page.locator("aside .border-l button").all();
  if (rows.length > 2) await rows[2].click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${dir}/p3-slate-overview.png`, fullPage: true });
  console.log("shot p3-slate-overview.png");

  // Switch to Statcast tab
  await page.getByRole("button", { name: "Statcast", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/p3-slate-statcast.png`, fullPage: true });
  console.log("shot p3-slate-statcast.png");

  // Switch to Game Logs tab
  await page.getByRole("button", { name: "Game Logs" }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/p3-slate-gamelogs.png`, fullPage: true });
  console.log("shot p3-slate-gamelogs.png");

  // Splits tab
  await page.getByRole("button", { name: "Splits" }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/p3-slate-splits.png`, fullPage: true });
  console.log("shot p3-slate-splits.png");
  await c.close();
}

// 2) Mobile slate (sidebar)
{
  const c = await ctx("dark", 390, 844);
  const page = await c.newPage();
  await page.goto(B + "/slate", { waitUntil: "networkidle", timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${dir}/p3-slate-mobile.png`, fullPage: true });
  console.log("shot p3-slate-mobile.png");
  await c.close();
}

await browser.close();
console.log("done");

import { chromium } from "playwright";

const dir = "/tmp/claude-0/-home-user-MLB/738e9ca2-c43b-5020-adf8-fa59c970cda0/scratchpad";
const B = "http://localhost:3100";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function newCtx(theme = "dark", w = 1440, h = 1024) {
  return browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
}

// 1) /analyze with two players added to workspace
{
  const c = await newCtx();
  const page = await c.newPage();
  await page.goto(B + "/analyze?market=hits", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4500);
  // add two Over selections from the first game's cards
  const overs = await page.getByRole("button", { name: /^Over$/ }).all();
  if (overs[0]) await overs[0].click();
  await page.waitForTimeout(800);
  if (overs[2]) await overs[2].click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${dir}/p4-analyze.png`, fullPage: true });
  console.log("shot p4-analyze.png");
  await c.close();
}

// 2) Player detail -> Pitch Mix tab (Skenes)
{
  const c = await newCtx();
  const page = await c.newPage();
  await page.goto(B + "/players/694973/analysis", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "Pitch Mix" }).first().click().catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${dir}/p4-pitchmix.png`, fullPage: true });
  console.log("shot p4-pitchmix.png");
  await c.close();
}

// 3) Mobile /analyze
{
  const c = await newCtx("dark", 390, 844);
  const page = await c.newPage();
  await page.goto(B + "/analyze?market=hits", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${dir}/p4-analyze-mobile.png`, fullPage: true });
  console.log("shot p4-analyze-mobile.png");
  await c.close();
}

await browser.close();
console.log("done");

import { chromium } from "playwright";

const dir = process.env.SHOT_DIR || "/tmp/claude-0/-home-user-MLB/738e9ca2-c43b-5020-adf8-fa59c970cda0/scratchpad";
const B = "http://localhost:3100";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function shoot(path, file, { wait = 1500, theme = "dark", w = 1440, h = 1024 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.goto(B + path, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${dir}/${file}`, fullPage: true });
  console.log("shot", file);
  await ctx.close();
}

await shoot("/players/592450", "p2-player-batter.png", { wait: 4000 });
await shoot("/players/694973", "p2-player-pitcher.png", { wait: 4000 });
await shoot("/health", "p2-health.png", { wait: 2000 });
await shoot("/players/592450", "p2-player-mobile.png", { wait: 4000, w: 390, h: 844 });

await browser.close();
console.log("done");

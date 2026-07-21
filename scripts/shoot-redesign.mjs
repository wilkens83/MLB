import { chromium } from "playwright";

const dir = "/tmp/claude-0/-home-user-MLB/738e9ca2-c43b-5020-adf8-fa59c970cda0/scratchpad";
const B = "http://localhost:3100";
const PROXY = process.env.HTTPS_PROXY;

// Images are served same-origin via /api/headshot and /api/team-logo, so the
// browser needs no external proxy — everything is localhost.
void PROXY;
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

async function shoot(path, file, { wait = 4000, theme = "dark", w = 1440, h = 1024, clickTab } = {}) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, ignoreHTTPSErrors: true });
  const page = await c.newPage();
  await page.goto(B + path, { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(wait);
  if (clickTab) { await page.getByRole("button", { name: clickTab }).first().click().catch(() => {}); await page.waitForTimeout(2500); }
  // Wait for headshot images to actually decode
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = r; }))));
  }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/${file}`, fullPage: true });
  const loaded = await page.evaluate(() => Array.from(document.images).filter((i) => i.naturalWidth > 0 && (i.src.includes("/api/headshot") || i.src.includes("/api/team-logo"))).length);
  console.log("shot", file, "mlb images loaded:", loaded);
  await c.close();
}

const target = process.argv[2] || "all";
if (target === "player" || target === "all") await shoot("/players/694973/analysis", "p5-player-analysis.png", { wait: 5000 });
if (target === "analyze" || target === "all") await shoot("/analyze?market=hits", "p5-analyze.png", { wait: 5500 });
if (target === "games" || target === "all") await shoot("/games", "p5-games.png", { wait: 4000 });
if (target === "mobile" || target === "all") await shoot("/players/694973/analysis", "p5-mobile-player.png", { wait: 5000, w: 390, h: 844 });

await browser.close();
console.log("done");

import { chromium } from "playwright";

const dir = "/tmp/claude-0/-home-user-MLB/738e9ca2-c43b-5020-adf8-fa59c970cda0/scratchpad";
const B = "http://localhost:3100";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const today = new Date().toISOString().slice(0, 10);
const nowIso = new Date().toISOString();
const CSV = [
  "board_date,captured_at,player,team,opponent,market,line,projection_type,notes",
  `${today},${nowIso},Paul Skenes,PIT,CIN,Pitcher Strikeouts,6.5,standard,`,
  `${today},${nowIso},Aaron Judge,NYY,BOS,Total Bases,1.5,demon,`,
  `${today},${nowIso},Shohei Ohtani,LAD,SF,Home Runs,0.5,standard,`,
  `${today},${nowIso},Bobby Witt Jr.,KC,DET,Hits,0.5,goblin,`,
  `${today},${nowIso},Tarik Skubal,DET,KC,Pitcher Strikeouts,7.5,standard,`,
  `${today},${nowIso},Gunnar Henderson,BAL,TB,Total Bases,1.5,standard,`,
].join("\n");

async function shoot(file, w, h) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark" });
  const page = await c.newPage();
  await page.goto(`${B}/prizepicks-board?date=${today}`, { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.evaluate((d) => localStorage.removeItem(`dp-prizepicks-board-${d}`), today);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Import board|Import/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "CSV import" }).click().catch(() => {});
  await page.waitForTimeout(250);
  await page.locator("textarea").fill(CSV);
  await page.getByRole("button", { name: "Preview" }).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Import \d+/ }).click().catch(() => {});
  await page.waitForTimeout(11000); // resolve + analyze
  // force any errored headshots to reload now that the server is idle
  await page.evaluate(() => {
    for (const i of Array.from(document.images)) {
      if (i.src.includes("/api/headshot") && i.naturalWidth === 0) i.src = i.src.split("&r=")[0] + "&r=" + Date.now();
    }
  });
  await page.waitForTimeout(4000);
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images).map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${dir}/${file}`, fullPage: true });
  const loaded = await page.evaluate(() => Array.from(document.images).filter((i) => i.naturalWidth > 0 && i.src.includes("/api/headshot")).length);
  console.log("shot", file, "headshots:", loaded);
  await c.close();
}

await shoot("p6-board.png", 1440, 1024);
await shoot("p6-board-mobile.png", 390, 844);
await browser.close();
console.log("done");

import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist", "public");
const LOG = "/tmp/diag2.log";
const log = async (m) => { await appendFile(LOG, m + "\n"); };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  let fp = path.join(DIST, p);
  if (!existsSync(fp)) fp = path.join(DIST, "index.html");
  const data = await readFile(fp);
  const ext = path.extname(fp);
  const ct = ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : ext === ".html" ? "text/html" : "application/octet-stream";
  res.writeHead(200, { "content-type": ct }).end(data);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
await log(`server on ${port}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const lang = process.argv[2] || "es";
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("console", async (m) => { if (m.type() === "error") await log("CONSOLE ERROR: " + m.text()); });
page.on("pageerror", async (e) => await log("PAGE ERROR: " + e.message + "\n" + (e.stack||"")));
let started = false, stopped = false;
await page.exposeFunction("startRecording", async () => { started = true; await log(`startRecording @ +${Date.now()-t0}ms`); });
await page.exposeFunction("stopRecording", async () => { stopped = true; await log(`stopRecording @ +${Date.now()-t0}ms`); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/?lang=${lang}`, { waitUntil: "load" });
while (!stopped && Date.now() - t0 < 56000) {
  await page.waitForTimeout(2000);
  const scene = await page.evaluate(() => document.body.innerText.slice(0, 60)).catch(() => "(eval failed)");
  await log(`  +${((Date.now()-t0)/1000).toFixed(0)}s started=${started} stopped=${stopped} text="${scene.replace(/\n/g,' ')}"`);
}
await log(`DONE ${lang}: started=${started} stopped=${stopped}`);
await ctx.close();
await browser.close();
server.close();

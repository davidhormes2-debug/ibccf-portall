import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const CLEAR_SCRIPT = [
  "const pg=require('pg');",
  "const pool=new pg.Pool({connectionString:process.env.PG_CONN});",
  "pool.connect()",
  ".then(()=>pool.query('DELETE FROM admin_login_attempts'))",
  ".catch(()=>{})",
  ".finally(()=>process.exit(0));",
].join("");

async function clearLoginAttempts() {
  if (!DATABASE_URL) return;
  await new Promise<void>((resolve) => {
    const child = spawn("node", ["-e", CLEAR_SCRIPT], {
      env: { ...process.env, PG_CONN: DATABASE_URL },
      stdio: "ignore",
    });
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8_000);
    child.on("close", () => { clearTimeout(timer); resolve(); });
    child.on("error", () => { clearTimeout(timer); resolve(); });
  });
}

test("diagnose tab-cases clickability", async ({ page }) => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("needs creds");
    }
  });
  test.setTimeout(60_000);

  await clearLoginAttempts();

  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-admin-username").fill(ADMIN_USERNAME);
  await page.getByTestId("input-admin-password").fill(ADMIN_PASSWORD);
  await page.getByTestId("button-admin-login").click();

  // Use the SAME login signal as the actual tests
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({ timeout: 25_000 });
  console.log("Logged in - case-finder trigger visible");

  await page.waitForTimeout(1000);

  const el = page.locator('[data-testid="tab-cases"]');
  const count = await el.count();
  console.log("tab-cases count:", count);

  if (count > 0) {
    const visible = await el.isVisible();
    const enabled = await el.isEnabled();
    const box = await el.boundingBox();
    console.log("visible:", visible, "enabled:", enabled, "box:", JSON.stringify(box));

    if (box) {
      const result = await page.evaluate(({ bx, by, bw, bh }) => {
        const cx = bx + bw / 2;
        const cy = by + bh / 2;
        const topEl = document.elementFromPoint(cx, cy) as HTMLElement | null;
        const all = document.querySelectorAll("[data-testid]");
        const overlaps: string[] = [];
        all.forEach((e) => {
          const r = e.getBoundingClientRect();
          const testid = (e as HTMLElement).dataset?.testid ?? "";
          if (r.left < bx + bw && r.right > bx && r.top < by + bh && r.bottom > by && testid !== "tab-cases") {
            const style = window.getComputedStyle(e);
            overlaps.push(
              `${testid} z=${style.zIndex} pos=${style.position} rect=${Math.round(r.top)},${Math.round(r.bottom)},${Math.round(r.left)},${Math.round(r.right)}`
            );
          }
        });
        return {
          topEl: topEl ? { tag: topEl.tagName, testid: topEl.dataset?.testid, text: topEl.textContent?.slice(0, 40) } : null,
          overlaps,
          bodyScrollTop: document.documentElement.scrollTop,
        };
      }, { bx: box.x, by: box.y, bw: box.width, bh: box.height });
      console.log("Top element at tab-cases center:", JSON.stringify(result.topEl));
      console.log("Body scrollTop:", result.bodyScrollTop);
      console.log("Overlapping elements:\n" + result.overlaps.join("\n"));
    }
  }

  // Check banners
  const pageInfo = await page.evaluate(() => {
    const ids = ["banner-email-delivery-failed", "admin-stale-build-banner"];
    return ids.map(id => {
      const e = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      if (!e) return `${id}: NOT IN DOM`;
      const r = e.getBoundingClientRect();
      return `${id}: w=${r.width} h=${r.height} top=${Math.round(r.top)}`;
    });
  });
  console.log("Banners:", pageInfo.join("; "));

  // Take screenshot before click attempt
  await page.screenshot({ path: "/tmp/before-tab-click.png" });
  console.log("Screenshot saved");

  // Try regular click first
  console.log("Attempting regular click...");
  try {
    await el.click({ timeout: 3_000 });
    console.log("Regular click SUCCEEDED!");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.log("Regular click FAILED:", msg);

    // Try force click
    console.log("Attempting force click...");
    try {
      await el.click({ force: true, timeout: 3_000 });
      console.log("Force click SUCCEEDED!");
    } catch (e2: unknown) {
      const msg2 = e2 instanceof Error ? e2.message.slice(0, 200) : String(e2);
      console.log("Force click FAILED:", msg2);
    }
  }
});

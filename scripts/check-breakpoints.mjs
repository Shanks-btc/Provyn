/**
 * `node scripts/check-breakpoints.mjs <url> [outDir]`
 *
 * 7-breakpoint layout check using the locally installed Chrome over its debugging protocol (no extra dependencies).
 * For each width in 375, 390, 768, 1024, 1280, 1440, 1920 it loads the page, measures horizontal overflow
 * (document scrollWidth vs viewport width, and any element poking past the right edge), and saves a full-page screenshot.
 * Exit code 1 if any width overflows.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const url = process.argv[2];
const outDir = process.argv[3] ?? ".";
if (!url) throw new Error("usage: node scripts/check-breakpoints.mjs <url> [outDir]");
mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333 + Math.floor(Math.random() * 500);
const WIDTHS = [375, 390, 768, 1024, 1280, 1440, 1920];

const profile = path.join(outDir, `.chrome-profile-${PORT}`);
const chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("Chrome did not start");
}

let failed = 0;
try {
  const ws = new WebSocket(await target());
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Page.enable");

  for (const w of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
    await send("Page.navigate", { url });
    await sleep(6000); // dev server may still be compiling on first load
    const m = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => { const vw = document.documentElement.clientWidth; const over = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !e.closest('[class*="overflow-x-auto"]') && getComputedStyle(e).position !== 'fixed'; }).slice(0, 5).map(e => e.tagName + '.' + String(e.className).slice(0, 50)); return { vw, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, over, title: document.title, fontsOk: document.fonts.check('16px Fraunces') }; })()`,
    });
    const v = m.result.result.value;
    const ok = v.scrollWidth <= v.vw + 1 && v.over.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${String(w).padStart(4)}px  viewport ${v.vw}  scrollWidth ${v.scrollWidth}  overflowing outside scroll containers: ${v.over.length ? v.over.join(", ") : "none"}  fonts:${v.fontsOk}`);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(path.join(outDir, `bp-${w}.png`), Buffer.from(shot.result.data, "base64"));
  }
  ws.close();
} finally {
  chrome.kill();
}
process.exit(failed ? 1 : 0);

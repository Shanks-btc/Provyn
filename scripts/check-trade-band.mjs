/**
 * `node scripts/check-trade-band.mjs [url]`
 *
 * Loads the Trade page in the installed Chrome (debugging protocol, no extra dependencies), waits, then reports whether the
 * live-price band is in the page and whether the browser made ANY request to /api/trade/quote. Run it with FINNHUB_ENABLED
 * unset (expect: no band, no request) and with FINNHUB_ENABLED=true on the dev server (expect: band, requests).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.argv[2] ?? "http://localhost:3000/trade";
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(os.tmpdir(), "chrome-band-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let wsUrl;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(500);
  }
  const ws = new WebSocket(wsUrl);
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(14000);
  const r = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => { const band = document.querySelector('[data-testid="real-quote"]'); const reqs = performance.getEntriesByType('resource').filter(e => e.name.includes('/api/trade/quote')).map(e => e.name.replace(location.origin, '')); const text = document.body.innerText; return { bandPresent: !!band, bandText: band ? band.innerText.slice(0, 160) : null, quoteRequests: reqs.length, quoteRequestUrls: reqs.slice(0, 3), mentionsFinnhub: /finnhub/i.test(text), mentionsUnavailable: /unavailable|retrying|not configured/i.test(text), title: document.title }; })()`,
  });
  console.log(JSON.stringify(r.result.result.value, null, 2));
  ws.close();
} finally {
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

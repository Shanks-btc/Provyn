/**
 * `node scripts/check-pages.mjs <baseUrl> <path> [path ...]`
 *
 * Opens each page in the installed Chrome (debugging protocol, no extra dependencies) and reports:
 *   - console errors, uncaught exceptions and failed requests (Log/Runtime events),
 *   - any occurrence of "finnhub" in the page's text (all text, including collapsed FAQ answers),
 *   - every use of the word "agent", with the nearest FAQ question or heading, so exceptions can be judged.
 * Exit code 1 if there is a console error or any "finnhub" text.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base, ...paths] = process.argv.slice(2);
if (!base || paths.length === 0) throw new Error("usage: node scripts/check-pages.mjs <baseUrl> <path> [path ...]");
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(os.tmpdir(), "chrome-pages-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;

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
  let events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const p of paths) {
    events = [];
    await send("Page.navigate", { url: base + p });
    await sleep(12000);
    if (process.env.CLICK) {
      await send('Runtime.evaluate', { expression: `(() => { const t = ${JSON.stringify(process.env.CLICK)}.toLowerCase(); const el = [...document.querySelectorAll('button, a')].find((e) => (e.textContent || '').trim().toLowerCase().includes(t)); if (el) el.click(); return !!el; })()` });
      await sleep(3000);
    }
    const r = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach((e) => e.remove());
        const text = clone.textContent.replace(/\\s+/g, ' ');
        const finnhub = (text.match(/finnhub/gi) || []).length;
        const needle = ${JSON.stringify(process.env.CONTAINS ?? "")};
        const parity = (text.match(/parity/gi) || []).length;
        const provyn = (text.match(/provyn/gi) || []).length;
        const aria = [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).filter((a) => /parity|provyn/i.test(a));
        const navText = (document.querySelector('header, nav')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 90);
        const footerText = (document.querySelector('footer')?.innerText || '').replace(/\\s+/g, ' ').slice(-90);
        const dialog = (document.querySelector('[role=dialog]')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 140);
        const contains = needle ? text.toLowerCase().includes(needle.toLowerCase()) : null;
        const agents = [];
        const re = /\\bagents?\\b/gi; let m;
        while ((m = re.exec(text)) && agents.length < 20) {
          // nearest preceding question-like heading/summary for context
          agents.push(text.slice(Math.max(0, m.index - 70), m.index + 60));
        }
        // which FAQ question each agent mention belongs to (details/summary or a heading-like element containing the match)
        const faq = [...document.querySelectorAll('details, [data-faq], section')].filter(e => /\\bagents?\\b/i.test(e.textContent)).slice(0, 8).map(e => (e.querySelector('summary, h2, h3, button')?.textContent || '').trim().slice(0, 80));
        return { parity, provyn, aria, navText, footerText, dialog, contains, title: document.title, description: document.querySelector('meta[name=description]')?.content ?? null, finnhub, agentCount: agents.length, agents, faqHeadings: faq };
      })()`,
    });
    const v = r.result.result.value;
    const consoleErrors = events
      .filter((e) => (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") || e.method === "Runtime.exceptionThrown" || (e.method === "Log.entryAdded" && e.params.entry.level === "error"))
      .map((e) => (e.method === "Runtime.exceptionThrown" ? e.params.exceptionDetails.text + " " + (e.params.exceptionDetails.exception?.description ?? "").slice(0, 160) : e.method === "Log.entryAdded" ? `${e.params.entry.text} ${e.params.entry.url ?? ""}` : e.params.args.map((a) => a.value ?? a.description ?? "").join(" ")).slice(0, 240));
    const failed = events.filter((e) => e.method === "Network.loadingFailed" && !e.params.canceled).map((e) => e.params.errorText + " " + (e.params.type ?? ""));
    console.log(`\n=== ${p}`);
    console.log(`title: ${v.title}`);
    console.log(`description: ${v.description}`);
    console.log(`console errors: ${consoleErrors.length}${consoleErrors.length ? "\n  - " + consoleErrors.join("\n  - ") : ""}`);
    console.log(`failed requests: ${failed.length}${failed.length ? " (" + failed.slice(0, 4).join("; ") + ")" : ""}`);
    console.log(`"finnhub" in page text: ${v.finnhub}`);
    console.log(`"Parity" in page text: ${v.parity} | "Provyn": ${v.provyn} | aria-labels with the brand: ${JSON.stringify(v.aria)}`);
    console.log(`nav: ${v.navText}`);
    console.log(`footer: ...${v.footerText}`);
    if (v.dialog) console.log(`dialog: ${v.dialog}`);
    if (v.contains !== null) console.log(`contains "${process.env.CONTAINS}": ${v.contains}`);
    console.log(`"agent" in page text: ${v.agentCount}${v.agentCount ? "\n  - ..." + v.agents.join("...\n  - ...") + "..." : ""}`);
    if (v.agentCount) console.log(`  enclosing blocks: ${JSON.stringify(v.faqHeadings)}`);
    if (consoleErrors.length || v.finnhub || v.parity) bad++;
  }
  ws.close();
} finally {
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(bad ? 1 : 0);

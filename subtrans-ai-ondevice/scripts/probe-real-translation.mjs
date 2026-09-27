import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const executablePath = process.env.SUBTRANS_BROWSER;
if (!executablePath) throw Error("Set SUBTRANS_BROWSER to a Chrome for Testing executable");
const results = join(root, "test-results"); await mkdir(results, { recursive: true });
const native = process.env.SUBTRANS_NATIVE_FLAGS === "1";
const profile = join(root, native ? ".real-model-profile-native" : ".real-model-profile");
const context = await chromium.launchPersistentContext(profile, {
  executablePath, headless: process.env.SUBTRANS_HEADFUL !== "1",
  ignoreDefaultArgs: native ? true : ["--disable-component-update", "--disable-background-networking"],
  args: [
    `--disable-extensions-except=${join(root, "dist")}`, `--load-extension=${join(root, "dist")}`, "--start-minimized",
    ...(native ? [`--user-data-dir=${profile}`, "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check"] : [])
  ]
});
try {
  const worker = context.serviceWorkers().find(item => item.url().endsWith("/background.js")) ||
    await context.waitForEvent("serviceworker", { timeout: 15000, predicate: item => item.url().endsWith("/background.js") });
  const id = new URL(worker.url()).host;
  const page = await context.newPage(); await page.goto(`chrome-extension://${id}/popup.html`);
  await page.locator("#source").selectOption("en");
  await page.locator(".live-test summary").click();
  await page.locator("#testTranslate").click();
  const started = Date.now(); let output = "", previous = "";
  while (Date.now() - started < 150000) {
    output = (await page.locator("#testOutput").textContent())?.trim() || "";
    if (output !== previous) { console.log(output); previous = output; }
    if (!(await page.locator("#testTranslate").isDisabled())) break;
    await page.waitForTimeout(1000);
  }
  const result = { chrome: await page.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1]),
    source: "Hello, this is an on-device translation test.", output, completed: !(await page.locator("#testTranslate").isDisabled()),
    elapsedMs: Date.now() - started,
    note: `Real Chrome Translator API in a temporary ${process.env.SUBTRANS_HEADFUL === "1" ? "windowed" : "headless"} Chrome for Testing profile; no mock implementation or paid API.` };
  await writeFile(join(results, "real-translation.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await context.close(); }

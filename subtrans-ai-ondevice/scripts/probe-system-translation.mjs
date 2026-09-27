import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html;charset=utf-8");
  response.end(`<!doctype html><html><meta charset="utf-8"><button id="run">Translate</button><output id="answer">Idle</output><script>
    document.getElementById('run').onclick = async () => {
      const answer = document.getElementById('answer'); answer.textContent='Preparing';
      let translator;
      try { translator = await Translator.create({ sourceLanguage:'en', targetLanguage:'ko', monitor(m) {
        m.addEventListener('downloadprogress',e=>answer.textContent='Downloading '+Math.round(e.loaded*100)+'%');
      } }); answer.textContent = await translator.translate('Good morning.'); }
      catch(error){ answer.textContent='ERROR '+error.name+': '+error.message; }
      finally {translator?.destroy();document.getElementById('run').disabled=false;}
    };
  </script></html>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const results = join(root, "test-results"); await mkdir(results, { recursive: true });
let context;
const native = process.env.SUBTRANS_NATIVE_FLAGS === "1";
const profile = join(root, native ? ".native-model-profile" : ".system-model-profile");
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath, headless: process.env.SUBTRANS_HEADFUL !== "1",
    args: native ? ["--start-minimized", `--user-data-dir=${profile}`, "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check"] : ["--start-minimized"],
    ignoreDefaultArgs: native ? true : ["--disable-component-update", "--disable-background-networking"]
  });
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const availability = await page.evaluate(async () => ({ present: typeof Translator !== "undefined",
    status: typeof Translator === "undefined" ? null : await Translator.availability({ sourceLanguage:"en", targetLanguage:"ko" }) }));
  console.log(JSON.stringify({ availability }));
  await page.locator("#run").click();
  let answer = "", previous = ""; const started = Date.now();
  while (Date.now() - started < 125000) {
    answer = (await page.locator("#answer").textContent())?.trim() || "";
    if (answer !== previous) { console.log(answer); previous = answer; }
    if (answer !== "Preparing" && !answer.startsWith("Downloading") && answer !== "Idle") break;
    await page.waitForTimeout(1000);
  }
  const result = { chrome: await page.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1]), availability, answer,
    elapsedMs: Date.now() - started, mode: process.env.SUBTRANS_HEADFUL === "1" ? "windowed" : "headless",
    note: "Branded system Chrome 153 on a local secure context, real Translator API and no mock." };
  await writeFile(join(results, "system-real-translation.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { if (context) await context.close(); await new Promise(done => server.close(done)); }

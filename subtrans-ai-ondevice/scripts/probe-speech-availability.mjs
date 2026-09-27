import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const chrome = process.env.SUBTRANS_SYSTEM_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = join(root, ".native-model-profile");
const server = createServer((_, response) => { response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><meta charset="utf-8"><title>Speech recognition availability probe</title>
  <button id="install">Install Korean speech pack</button><output id="installResult">idle</output>
  <button id="translate">Translate Korean to English</button><output id="translationResult">idle</output>
  <button id="prepareNano">Prepare Nano audio</button><output id="nanoResult">idle</output><script>
  document.getElementById('install').onclick = async () => {
    const result = document.getElementById('installResult'); result.textContent = 'installing';
    try { result.textContent = String(await SpeechRecognition.install({ langs: ['ko-KR'], processLocally: true })); }
    catch(error) { result.textContent = error.name + ': ' + error.message; }
  };
  document.getElementById('translate').onclick = async () => {
    const result = document.getElementById('translationResult'); result.textContent = 'preparing';
    let translator;
    try {
      translator = await Translator.create({sourceLanguage:'ko',targetLanguage:'en',monitor(m) {
        m.addEventListener('downloadprogress', e => result.textContent='downloading '+Math.round(e.loaded*100)+'%');
      }});
      result.textContent = await translator.translate('안녕하세요. 오늘은 좋은 날입니다.');
    } catch(error) { result.textContent = error.name + ': ' + error.message; }
    finally { translator?.destroy(); }
  };
  document.getElementById('prepareNano').onclick = async () => {
    const result = document.getElementById('nanoResult'); result.textContent = 'preparing';
    let model;
    try {
      model = await LanguageModel.create({
        expectedInputs:[{type:'text',languages:['en']},{type:'audio'}],
        expectedOutputs:[{type:'text',languages:['en']}],
        monitor(m) { m.addEventListener('downloadprogress',e=>result.textContent='downloading '+Math.round(e.loaded*100)+'%'); }
      });
      result.textContent = 'ready';
    } catch(error) { result.textContent = error.name + ': ' + error.message; }
    finally { model?.destroy(); }
  };</script>`); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: false,
    ignoreDefaultArgs: true, args: [`--user-data-dir=${profile}`, "--remote-debugging-pipe", "--no-first-run",
      "--no-default-browser-check", "--start-minimized"] });
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  page.on("crash", () => console.error("Probe page crashed"));
  page.on("close", () => console.error("Probe page closed"));
  context.browser().on("disconnected", () => console.error("Probe Chrome disconnected"));
  const result = await page.evaluate(async () => {
    const Speech = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    const result = { chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1],
      speechRecognition: typeof Speech, localAvailabilityMethod: typeof Speech?.available,
      trackInputArity: Speech?.prototype?.start?.length ?? null };
    if (typeof Speech?.available === "function") {
      for (const language of ["ko-KR", "en-US", "ja-JP"]) {
        try { result[language] = await Speech.available({ langs: [language], processLocally: true }); }
        catch (error) { result[language] = `${error.name}: ${error.message}`; }
      }
    }
    result.audioPrompt = {};
    if (typeof globalThis.LanguageModel?.availability === "function") {
      for (const language of ["en", "ja"]) {
        try { result.audioPrompt[language] = await LanguageModel.availability({
          expectedInputs: [{ type: "text", languages: language === "ja" ? ["en", "ja"] : ["en"] }, { type: "audio" }],
          expectedOutputs: [{ type: "text", languages: [language] }]
        }); } catch (error) { result.audioPrompt[language] = `${error.name}: ${error.message}`; }
      }
    } else result.audioPrompt = "API absent";
    result.translationAvailability = {};
    if (typeof globalThis.Translator?.availability === "function") {
      for (const language of ["en", "ja"]) {
        try { result.translationAvailability[language] = await Translator.availability({sourceLanguage: language,targetLanguage:"ko"}); }
        catch (error) { result.translationAvailability[language] = `${error.name}: ${error.message}`; }
      }
    }
    return result;
  });
  if (process.env.SUBTRANS_INSTALL_SPEECH === "1" && result["ko-KR"] !== "unavailable") {
    await page.locator("#install").click();
    try {
      await page.waitForFunction(() => !["idle", "installing"].includes(document.querySelector("#installResult")?.textContent),
        undefined, { timeout: 120000 });
      result.installResult = await page.locator("#installResult").textContent();
      result.afterInstall = await page.evaluate(() => SpeechRecognition.available({ langs: ["ko-KR"], processLocally: true }));
    } catch (error) { result.installResult = String(error?.message || error); }
  }
  if (process.env.SUBTRANS_TRANSLATE_KO === "1") {
    await page.locator("#translate").click();
    try {
      await page.waitForFunction(() => !/^(idle|preparing|downloading)/.test(document.querySelector("#translationResult")?.textContent),
        undefined, { timeout: 120000 });
      result.translation = await page.locator("#translationResult").textContent();
    } catch (error) { result.translation = String(error?.message || error); }
  }
  if (process.env.SUBTRANS_PREPARE_NANO === "1") {
    await page.locator("#prepareNano").click();
    const started = Date.now(); let previous = "";
    try {
      while (Date.now() - started < 1200000) {
        const message = await page.locator("#nanoResult").textContent();
        if (message !== previous) { console.log(`Nano: ${message}`); previous = message; }
        if (message === "ready" || (!/^(idle|preparing|downloading)/.test(message))) break;
        await page.waitForTimeout(1000);
      }
      result.nanoPreparation = { message: await page.locator("#nanoResult").textContent(), elapsedMs: Date.now() - started };
    } catch (error) {
      result.nanoPreparation = { error: String(error?.message || error), elapsedMs: Date.now() - started,
        browserConnected: context.browser().isConnected() };
    }
  }
  console.log(JSON.stringify(result, null, 2));
  await mkdir(join(root, "test-results"), { recursive: true });
  await writeFile(join(root, "test-results", "speech-availability.json"), JSON.stringify(result, null, 2));
} finally { if (context) await context.close(); await new Promise(resolve => server.close(resolve)); }

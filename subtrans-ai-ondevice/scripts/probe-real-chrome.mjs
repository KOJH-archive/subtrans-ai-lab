import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const executablePath = process.env.SUBTRANS_BROWSER;
if (!executablePath) throw Error("Set SUBTRANS_BROWSER to a Chrome for Testing executable");
const results = join(root, "test-results"); await mkdir(results, { recursive: true });
const context = await chromium.launchPersistentContext(join(root, `.probe-profile-${Date.now()}`), {
  executablePath, headless: true, args: [`--disable-extensions-except=${join(root, "dist")}`, `--load-extension=${join(root, "dist")}`]
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const page = await context.newPage(); await page.goto(`chrome-extension://${id}/popup.html`);
  const result = await page.evaluate(async () => {
    const data = { chromeVersion: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown",
      translatorPresent: typeof Translator !== "undefined", promptPresent: typeof LanguageModel !== "undefined",
      pairs: {}, audio: {} };
    if (data.translatorPresent) for (const language of ["en", "ja", "zh"]) {
      try { data.pairs[language] = await Translator.availability({ sourceLanguage: language, targetLanguage: "ko" }); }
      catch (error) { data.pairs[language] = `${error.name}: ${error.message}`; }
    }
    if (data.promptPresent) for (const language of ["en", "ja"]) {
      try { data.audio[language] = await LanguageModel.availability({
        expectedInputs: [{ type: "text", languages: language === "ja" ? ["en", "ja"] : ["en"] }, { type: "audio" }],
        expectedOutputs: [{ type: "text", languages: [language] }]
      }); } catch (error) { data.audio[language] = `${error.name}: ${error.message}`; }
    }
    return data;
  });
  await writeFile(join(results, "real-chrome-availability.json"), JSON.stringify({
    ...result, note: "Fresh temporary profile in headless Chrome; GPU availability may differ from the user's visible Chrome profile. No model was downloaded."
  }, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await context.close(); }

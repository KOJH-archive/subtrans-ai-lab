import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const chrome = process.env.SUBTRANS_SYSTEM_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = join(root, ".native-model-profile");
let context;
const result = { chrome: "system", extensionLoaded: false };
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: false,
    ignoreDefaultArgs: true, args: [`--user-data-dir=${profile}`, "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check", "--start-minimized"] });
  const cdp = await context.browser().newBrowserCDPSession();
  const loaded = await cdp.send("Extensions.loadUnpacked", { path: join(root, "dist") });
  result.extensionLoaded = true; result.extensionId = loaded.id;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${loaded.id}/popup.html`);
  result.popupTitle = await popup.title();
  await popup.locator("#capabilities span").first().waitFor({ timeout: 20000 });
  result.capabilities = await popup.locator("#capabilities").innerText();
  if (process.env.SUBTRANS_PREPARE_AUDIO === "1") {
    result.preparation = {};
    for (const language of ["en", "ja"]) {
      await popup.locator("#mode").selectOption("audio");
      await popup.locator("#source").selectOption(language);
      await popup.locator("#prepare").click();
      const started = Date.now(); let previous = "";
      while (Date.now() - started < 305000) {
        const message = await popup.locator("#state").innerText();
        if (message !== previous) { console.log(`${language}: ${message}`); previous = message; }
        if (await popup.locator("#prepare").isEnabled()) break;
        await popup.waitForTimeout(1000);
      }
      result.preparation[language] = { message: await popup.locator("#state").innerText(), elapsedMs: Date.now() - started };
      if (!result.preparation[language].message.includes("준비가 끝났습니다")) break;
    }
  }
} catch (error) { result.error = String(error?.message || error); }
finally {
  await mkdir(join(root, "test-results"), { recursive: true });
  await writeFile(join(root, "test-results", "cdp-extension.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (context) await context.close();
}

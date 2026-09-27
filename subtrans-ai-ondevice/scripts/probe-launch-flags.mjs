import { createRequire } from "node:module";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const context = await chromium.launchPersistentContext(join(root, `.flags-profile-${Date.now()}`), {
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true,
  ignoreDefaultArgs: ["--disable-component-update", "--disable-background-networking"]
});
try { const page = await context.newPage(); await page.goto("chrome://version");
  const line = await page.locator("#command_line").innerText(); console.log(line);
} finally { await context.close(); }

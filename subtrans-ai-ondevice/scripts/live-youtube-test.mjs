import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const chrome = process.env.SUBTRANS_SYSTEM_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = join(root, ".native-model-profile");
const resultsDir = join(root, "test-results");
await mkdir(resultsDir, { recursive: true });
const videos = [
  { language: "en", url: "https://www.youtube.com/watch?v=QbYBRjOaGOo&t=13s" },
  { language: "ja", url: "https://www.youtube.com/watch?v=p6kpxWGa8AM" }
];
const result = { chrome: "system", model: "real", tests: [] };
let context;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: false,
    ignoreDefaultArgs: true, args: [`--user-data-dir=${profile}`, "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required", "--start-minimized"] });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: join(root, "dist") });
  result.extensionId = id;
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("#capabilities span").first().waitFor({ timeout: 20000 });
  result.capabilities = await popup.locator("#capabilities").innerText();
  const call = (type, data = {}) => popup.evaluate(({ type, data }) =>
    chrome.runtime.sendMessage({ target: "ondevice-ui", type, ...data }), { type, data });
  for (const item of videos) {
    const trial = { ...item, events: [] }; result.tests.push(trial);
    let page;
    try {
      page = await context.newPage(); await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator("video").first().waitFor({ timeout: 30000 });
      trial.title = await page.title();
      trial.initial = await page.evaluate(() => { const video = document.querySelector("video");
        return { time: video.currentTime, duration: video.duration, tracks: video.textTracks.length,
          captions: document.querySelector(".ytp-subtitles-button")?.getAttribute("aria-label") }; });
      const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
      const tabTarget = targetInfos.find(target => target.type === "tab" && target.url.includes(`watch?v=${new URL(item.url).searchParams.get("v")}`));
      if (!tabTarget) throw Error(`YouTube tab target not found: ${targetInfos.map(target => `${target.type}:${target.url}`).join(", ")}`);
      await cdp.send("Extensions.triggerAction", { id, targetId: tabTarget.targetId });
      await page.bringToFront();
      const started = await call("START", { mode: "audio", source: item.language, output: "ko" });
      trial.start = started; console.log(`${item.language} START ${JSON.stringify(started)}`);
      if (!started?.ok) continue;
      await page.evaluate(() => document.querySelector("video")?.play());
      const startedAt = Date.now(); let lastStatus = "", lastTranslated = 0;
      while (Date.now() - startedAt < 42000) {
        const state = await call("STATE");
        const playback = await page.evaluate(() => { const video = document.querySelector("video");
          return { time: video?.currentTime, paused: video?.paused, readyState: video?.readyState,
            tracks: video?.textTracks?.length ?? 0,
            captions: document.querySelector(".ytp-subtitles-button")?.getAttribute("aria-label"),
            overlay: Boolean(document.querySelector("#subtrans-ondevice-overlay")) }; });
        const key = `${state?.state?.phase}:${state?.state?.message}`;
        if (key !== lastStatus || state?.state?.translated !== lastTranslated) {
          trial.events.push({ elapsedMs: Date.now() - startedAt, state: state?.state, playback });
          console.log(`${item.language} ${Math.round((Date.now() - startedAt) / 1000)}s ${JSON.stringify({state:state?.state,playback})}`);
          lastStatus = key; lastTranslated = state?.state?.translated || 0;
          if (lastTranslated > 0) await page.screenshot({ path: join(resultsDir, `live-youtube-${item.language}-cue.png`) });
        }
        if (!state?.state?.running) break;
        if ((playback.time || 0) - (trial.initial.time || 0) >= 40) break;
        await page.waitForTimeout(1000);
      }
      trial.final = { state: (await call("STATE")).state,
        playback: await page.evaluate(() => { const video = document.querySelector("video");
          return { time: video?.currentTime, paused: video?.paused, tracks: video?.textTracks?.length ?? 0 }; }) };
      await page.screenshot({ path: join(resultsDir, `live-youtube-${item.language}-end.png`) });
      await call("STOP");
    } catch (error) { trial.error = String(error?.message || error); console.log(`${item.language} ERROR ${trial.error}`);
      try { await call("STOP"); } catch {} }
    finally { if (page) await page.close(); }
  }
} catch (error) { result.error = String(error?.message || error); }
finally {
  await writeFile(join(resultsDir, "live-youtube-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (context) await context.close();
}

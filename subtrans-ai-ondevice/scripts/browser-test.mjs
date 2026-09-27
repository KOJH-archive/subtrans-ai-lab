import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { generateKeyPairSync, createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const executablePath = process.env.SUBTRANS_BROWSER;
if (!executablePath) throw Error("Set SUBTRANS_BROWSER to Chrome for Testing executable");
const testExtension = join(root, ".test-extension"), results = join(root, "test-results");
await mkdir(results, { recursive: true }); await cp(join(root, "extension"), testExtension, { recursive: true, force: true });
const manifest = JSON.parse(await readFile(join(testExtension, "manifest.json"), "utf8"));
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicBytes = publicKey.export({ type: "spki", format: "der" }); manifest.key = publicBytes.toString("base64");
manifest.host_permissions = ["http://127.0.0.1/*"]; // Test fixture only; never shipped.
await writeFile(join(testExtension, "manifest.json"), JSON.stringify(manifest));
const extensionId = createHash("sha256").update(publicBytes).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
const prelude = `
globalThis.__mockAI = { translations: 0, prompts: 0, languages: [], targets: [], audioBytes: 0, speechStarts: 0 };
globalThis.Translator = class {
  static async availability() { return 'available'; }
  static async create(options) { globalThis.__mockAI.languages.push(options.sourceLanguage); globalThis.__mockAI.targets.push(options.targetLanguage); return {
    async translate(text) { globalThis.__mockAI.translations++; return options.sourceLanguage === 'ko'
      ? options.targetLanguage === 'ja' ? 'こんにちは。' : 'Hello.' : '번역: ' + text; }, destroy() {}
  }; }
};
globalThis.SpeechRecognition = class {
  static async available() { return 'available'; }
  static async install() { return true; }
  start(track) {
    if (track.kind !== 'audio' || track.readyState !== 'live' || !this.processLocally || this.lang !== 'ko-KR')
      throw Error('Invalid local Korean speech recognition setup');
    globalThis.__mockAI.speechStarts++;
    this.timer = setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '안녕하세요.' } }] }), 300);
  }
  abort() { clearTimeout(this.timer); }
};
globalThis.LanguageModel = class {
  static async availability() { return 'available'; }
  static async create() { return { async prompt(messages) {
    const blob = messages[0].content.find(item => item.type === 'audio').value;
    globalThis.__mockAI.audioBytes = blob.size; globalThis.__mockAI.prompts++;
    return 'A new perspective.';
  }, destroy() {} }; }
};
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target === 'test-ai-state' && location.pathname === '/offscreen.html') respond(globalThis.__mockAI);
});`;
await writeFile(join(testExtension, "test-prelude.js"), prelude);
for (const name of ["popup.html", "offscreen.html", "lab.html"]) {
  const html = await readFile(join(testExtension, name), "utf8");
  await writeFile(join(testExtension, name), html.replace('<script type="module"', '<script src="test-prelude.js"></script><script type="module"'));
}
const fixture = `<!doctype html><html><meta charset="utf-8"><style>body{background:#152f2c;color:white;font:20px sans-serif}video{width:800px;height:450px;display:block;background:#2c665d}</style><h1>On-device translation test</h1><button id="play">Play video</button><video controls></video><script>
document.querySelector('#play').onclick = async () => {
  const canvas = document.createElement('canvas'); canvas.width=800; canvas.height=450;
  const ctx=canvas.getContext('2d'); ctx.fillStyle='#336c5a';ctx.fillRect(0,0,800,450);
  const audio=new AudioContext();const osc=audio.createOscillator();osc.frequency.value=220;
  const gain=audio.createGain();gain.gain.value=.07;const dest=audio.createMediaStreamDestination();osc.connect(gain).connect(dest);osc.start();await audio.resume();
  const stream=canvas.captureStream(10);stream.addTrack(dest.stream.getAudioTracks()[0]);
  const video=document.querySelector('video');video.srcObject=stream;await video.play();
  const track=video.addTextTrack('captions','English','en'); track.mode='showing';
  track.addCue(new VTTCue(0,60,'Hello world.'));window.testAudio=audio;
};</script></html>`;
const audioOnlyFixture = `<!doctype html><html><meta charset="utf-8"><style>body{background:#24334a;color:white;font:24px sans-serif}</style><h1>Custom player without a video element</h1><button id="play">Play audio</button><script>
document.querySelector('#play').onclick = async () => {
  const audio = new AudioContext(), osc = audio.createOscillator(), gain = audio.createGain();
  osc.frequency.value = 220; gain.gain.value = .07; osc.connect(gain).connect(audio.destination);
  osc.start(); await audio.resume(); window.testAudio = audio;
};</script></html>`;
const server = createServer((request, response) => { response.setHeader("Content-Type", "text/html;charset=utf-8");
  response.end(request.url === "/audio-only" ? audioOnlyFixture : fixture); });
await new Promise(done => server.listen(0, "127.0.0.1", done));
let context; const checks = [], errors = [];
let cdp;
async function grantActiveTab(page) {
  if (!cdp) return;
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
  const tab = targetInfos.find(target => target.url === page.url());
  if (!tab) throw Error(`No tab target for ${page.url()}`);
  await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: tab.targetId });
}
try {
  const cdpLoad = process.env.SUBTRANS_CDP_LOAD === "1";
  const testProfile = join(root, `.test-profile-${Date.now()}`);
  context = await chromium.launchPersistentContext(testProfile, cdpLoad ? {
    executablePath, headless: false, ignoreDefaultArgs: true, viewport: { width: 1100, height: 800 },
    args: [`--user-data-dir=${testProfile}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required", "--start-minimized"]
  } : {
    executablePath, headless: true, ignoreDefaultArgs: ["--mute-audio"], viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`, `--allowlisted-extension-id=${extensionId}`, "--autoplay-policy=no-user-gesture-required"]
  });
  if (cdpLoad) {
    cdp = await context.browser().newBrowserCDPSession();
    const loaded = await cdp.send("Extensions.loadUnpacked", { path: testExtension });
    assert.equal(loaded.id, extensionId);
  }
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await (context.serviceWorkers()[0] || context.waitForEvent("serviceworker"));
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForTimeout(200); await popup.screenshot({ path: join(results, "popup.png"), fullPage: true });
  await popup.locator("#source").selectOption("en"); await popup.locator("#prepare").click();
  await popup.getByText("내장 모델 준비가 끝났습니다.", { exact: false }).waitFor();
  checks.push("model preparation button initializes the built-in translator mock");
  await popup.locator(".live-test summary").click(); await popup.locator("#testTranslate").click();
  await popup.getByText("번역: Hello, this is an on-device translation test.", { exact: true }).waitFor();
  checks.push("manual translation test displays a built-in model response");
  const lab = await context.newPage(); await lab.goto(`chrome-extension://${extensionId}/lab.html`);
  await lab.locator("#translate").click();
  await lab.getByText("번역: Hello, this is an on-device translation test.", { exact: true }).waitFor();
  checks.push("persistent lab page displays local translation response");
  await lab.locator("#prepareAudio").click();
  await lab.getByText("Gemini Nano 모델 준비가 끝났습니다.", { exact: false }).waitFor();
  checks.push("persistent lab prepares Nano without requiring an audio file");
  await lab.locator("#audioFile").setInputFiles({ name: "sample.wav", mimeType: "audio/wav", buffer: Buffer.alloc(200, 1) });
  await lab.locator("#transcribe").click();
  await lab.getByText("한국어: 번역: A new perspective.", { exact: false }).waitFor();
  checks.push("persistent lab page displays Nano audio and Korean translation response");
  await lab.screenshot({ path: join(results, "lab.png"), fullPage: true });
  await lab.close();
  const video = await context.newPage(); await video.goto(`http://127.0.0.1:${server.address().port}`); await video.locator("#play").click();
  await grantActiveTab(video);
  const call = (type, data = {}) => popup.evaluate(({ type, data }) => chrome.runtime.sendMessage({ target: "ondevice-ui", type, ...data }), { type, data });
  let result = await call("START", { mode: "captions", source: "en" });
  assert.equal(result.ok, true, JSON.stringify(result)); checks.push("separate Chrome extension starts caption translation without credentials");
  for (let i = 0; i < 50; i++) {
    result = await call("STATE"); if (result.state.translated) break;
    await popup.waitForTimeout(200);
  }
  const trackDebug = await video.evaluate(() => ({ video: Boolean(document.querySelector("video")), currentTime: document.querySelector("video")?.currentTime,
    tracks: [...document.querySelector("video").textTracks].map(t => ({ kind: t.kind, language: t.language, mode: t.mode, cues: t.cues?.length, active: t.activeCues?.length })),
    overlay: Boolean(document.querySelector("#subtrans-ondevice-overlay")) }));
  assert.ok(result.state.translated > 0, JSON.stringify({ result, trackDebug })); checks.push("native HTML5 caption reaches built-in Translator mock");
  const aiState = await popup.evaluate(() => chrome.runtime.sendMessage({ target: "test-ai-state" }));
  assert.ok(aiState.translations >= 1); assert.ok(aiState.languages.every(language => language === "en"));
  assert.equal(await video.locator("#subtrans-ondevice-overlay").count(), 1);
  await video.screenshot({ path: join(results, "caption-overlay.png") });
  await call("STOP"); assert.equal(await video.locator("#subtrans-ondevice-overlay").count(), 0); checks.push("stop restores page and removes overlay");
  await popup.bringToFront(); await video.bringToFront();
  result = await call("START", { mode: "audio", source: "en" });
  assert.equal(result.ok, true, JSON.stringify(result)); checks.push("real tab audio capture starts Nano experiment");
  for (let i = 0; i < 85; i++) {
    result = await call("STATE"); if (result.state.translated) break;
    if (!result.state.running) throw Error(JSON.stringify(result.state));
    await popup.waitForTimeout(200);
  }
  assert.ok(result.state.translated > 0, JSON.stringify(result));
  const audioState = await popup.evaluate(() => chrome.runtime.sendMessage({ target: "test-ai-state" }));
  assert.ok(audioState.prompts > 0 && audioState.audioBytes > 44, JSON.stringify({ audioState, result })); checks.push("captured audio is passed to Gemini Nano mock and translated locally");
  await call("STOP");
  assert.equal(await video.locator("#subtrans-ondevice-overlay").count(), 0);
  const audioOnly = await context.newPage(); await audioOnly.goto(`http://127.0.0.1:${server.address().port}/audio-only`);
  await audioOnly.locator("#play").click(); await popup.bringToFront(); await audioOnly.bringToFront();
  await grantActiveTab(audioOnly);
  result = await call("START", { mode: "audio", source: "en" });
  assert.equal(result.ok, true, JSON.stringify(result));
  for (let i = 0; i < 85; i++) {
    result = await call("STATE"); if (result.state.translated) break;
    if (!result.state.running) throw Error(JSON.stringify(result.state));
    await popup.waitForTimeout(200);
  }
  assert.ok(result.state.translated > 0, JSON.stringify(result));
  assert.equal(await audioOnly.locator("video").count(), 0);
  assert.equal(await audioOnly.locator("#subtrans-ondevice-overlay").count(), 1);
  await audioOnly.screenshot({ path: join(results, "audio-only-overlay.png") });
  await call("STOP"); checks.push("audio translation overlays a custom player page without a video element");
  await popup.bringToFront(); await audioOnly.bringToFront();
  result = await call("START", { mode: "speech", source: "ko", output: "en" });
  assert.equal(result.ok, true, JSON.stringify(result));
  for (let i = 0; i < 50; i++) {
    result = await call("STATE"); if (result.state.translated) break;
    if (!result.state.running) throw Error(JSON.stringify(result.state));
    await popup.waitForTimeout(200);
  }
  assert.ok(result.state.translated > 0, JSON.stringify(result));
  const speechState = await popup.evaluate(() => chrome.runtime.sendMessage({ target: "test-ai-state" }));
  assert.ok(speechState.speechStarts > 0);
  assert.equal(speechState.languages.at(-1), "ko"); assert.equal(speechState.targets.at(-1), "en");
  assert.equal(await audioOnly.locator("#subtrans-ondevice-overlay").count(), 1);
  await audioOnly.screenshot({ path: join(results, "korean-speech-overlay.png") });
  await call("STOP"); checks.push("tab audio reaches local Korean speech recognizer and English Translator mock");
  assert.deepEqual(errors, []); checks.push("no page JavaScript errors");
  await writeFile(join(results, "browser-results.json"), JSON.stringify({ checks, api: "mocked built-in AI; no model download", capture: "real Chrome tabCapture", errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { if (context) await context.close(); await new Promise(done => server.close(done)); }

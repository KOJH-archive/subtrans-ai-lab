import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SUBTRANS_PLAYWRIGHT || "playwright");
const browsers = join(root, ".test-browsers");
const version = (await readdir(browsers)).find(name => /^chromium-\d+$/.test(name));
const executablePath = process.env.SUBTRANS_BROWSER || join(browsers, version, "chrome-win64", "chrome.exe");
const testExtension = join(root, ".test-extension"), results = join(root, "test-results");
await mkdir(results, { recursive: true }); await cp(join(root, "extension"), testExtension, { recursive: true });
const manifest = JSON.parse(await readFile(join(testExtension, "manifest.json"), "utf8"));
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicBytes = publicKey.export({ type: "spki", format: "der" }); manifest.key = publicBytes.toString("base64");
const extensionId = createHash("sha256").update(publicBytes).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
// Fixture-only host grant avoids requiring an automated toolbar click. Never shipped.
manifest.host_permissions.push("http://127.0.0.1/*");
await writeFile(join(testExtension, "manifest.json"), JSON.stringify(manifest));
const prelude = `
globalThis.__test = { calls: 0, aborted: 0, delay: 0, errorStatus: 0, models: [], wavBytes: 0, frames: 0, peak: 0 };
const NativeWorklet = globalThis.AudioWorkletNode;
globalThis.AudioWorkletNode = class extends NativeWorklet {
  constructor(...args) { super(...args); this.port.addEventListener('message',event=> {globalThis.__test.frames++; for(const sample of event.data) globalThis.__test.peak=Math.max(globalThis.__test.peak,Math.abs(sample));}); }
};
globalThis.fetch = async (url, options = {}) => {
  const state = globalThis.__test; state.calls++;
  if (!String(url).startsWith('https://api.openai.com/') && !String(url).startsWith('https://generativelanguage.googleapis.com/')) throw new Error('Unexpected test network access');
  if (state.delay) await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, state.delay);
    options.signal?.addEventListener('abort', () => { clearTimeout(timer); state.aborted++; reject(new DOMException('Aborted','AbortError')); }, {once:true});
  });
  if (state.errorStatus) return new Response('{}', {status:state.errorStatus});
  let data;
  if (String(url).endsWith('transcriptions')) {
    state.wavBytes = options.body.get('file').size; state.models.push(options.body.get('model')); data = {text:'Every new perspective opens a new world.'};
  } else if (String(url).endsWith('/responses')) {
    state.models.push(JSON.parse(options.body).model);
    data = {status:'completed', output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({source:'Every new perspective opens a new world.',translation:'새로운 시선은 새로운 세상을 열어 줍니다.'})}]}]};
  } else {
    const body = JSON.parse(options.body); state.wavBytes = atob(body.contents[0].parts[1].inlineData.data).length;
    state.models.push(String(url).split('/models/')[1].split(':')[0]);
    data = {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({source:'Every new perspective opens a new world.',translation:'새로운 시선은 새로운 세상을 열어 줍니다.'})}]}}]};
  }
  return new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json'}});
};
chrome.runtime.onMessage.addListener((message,sender,respond)=> {
  if (message.target !== 'test-only') return;
  Object.assign(globalThis.__test,message.set||{}); respond(globalThis.__test);
});
`;
await writeFile(join(testExtension, "test-prelude.js"), prelude);
const offscreenHtml = await readFile(join(testExtension, "offscreen.html"), "utf8");
await writeFile(join(testExtension, "offscreen.html"), offscreenHtml.replace('<script type="module" src="offscreen.js">', '<script src="test-prelude.js"></script><script type="module" src="offscreen.js">'));
const fixture = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>SubTrans 테스트 영상</title><style>body{margin:0;background:#102f2a;color:#fff;font:16px sans-serif;padding:45px}h1{font-weight:500}video{display:block;width:900px;max-width:90vw;height:506px;background:#21463f;border-radius:12px}button{padding:12px 20px;margin:18px 0}</style></head><body><h1>SubTrans · 오디오 캡처 테스트</h1><button id="play">테스트 영상 재생</button><video controls></video><script>
document.querySelector('button').onclick=async()=>{
 const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');
 const draw=()=>{c.fillStyle='#21463f';c.fillRect(0,0,1280,720);c.fillStyle='#dbe4b5';c.beginPath();c.arc(920,280,140,0,Math.PI*2);c.fill();c.fillStyle='#fff';c.font='42px sans-serif';c.fillText('A new perspective.',75,220);c.font='22px sans-serif';c.fillText('SubTrans AI · Browser integration test',75,270);};draw();setInterval(draw,100);
 const audio=new AudioContext();const osc=audio.createOscillator();osc.frequency.value=220;const gain=audio.createGain();gain.gain.value=.05;const dest=audio.createMediaStreamDestination();osc.connect(gain).connect(dest);osc.start();await audio.resume();
 const stream=canvas.captureStream(10);stream.addTrack(dest.stream.getAudioTracks()[0]);
 const v=document.querySelector('video');v.srcObject=stream;await v.play();window.testAudio=audio;
};</script></body></html>`;
const server = createServer((request, response) => { response.setHeader("Content-Type", "text/html;charset=utf-8"); response.end(fixture); });
await new Promise(done => server.listen(0, "127.0.0.1", done));
let context;
const errors = [], checks = [];
try {
  context = await chromium.launchPersistentContext(join(root, `.test-profile-${Date.now()}`), {
    executablePath, headless: true, ignoreDefaultArgs: ["--mute-audio"], viewport: { width: 1280, height: 1000 },
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`, `--allowlisted-extension-id=${extensionId}`, "--autoplay-policy=no-user-gesture-required"]
  });
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  console.log("Extension worker loaded", worker.url());
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForFunction(() => document.querySelector('#status-message').textContent !== '번역 상태를 불러오는 중입니다.');
  await options.locator("#api-key").fill("sk-test-placeholder-not-a-real-key");
  await options.locator("#remember-key").check(); await options.locator("#save").click();
  await options.getByText("설정을 저장했습니다.", { exact: false }).waitFor();
  const call = (type, data = {}) => options.evaluate(({ type, data }) => chrome.runtime.sendMessage({ target: "background", type, ...data }), { type, data });
  let result = await call("GET_STATE"); assert.equal(result.provider, "openai"); assert.equal(result.hasKey, true); assert.ok(!JSON.stringify(result).includes("sk-test")); checks.push("UI key saving and redaction");
  await options.locator("#show-source").check(); await options.locator("#size").fill("30");
  await options.waitForTimeout(250); result = await call("GET_STATE"); assert.equal(result.settings.style.size, 30); assert.equal(result.settings.style.showSource, true); checks.push("live style persistence");
  await options.evaluate(() => scrollTo(0, 0)); await options.screenshot({ path: join(results, "settings.png"), fullPage: true });
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`); await popup.setViewportSize({ width: 390, height: 920 });
  await popup.waitForTimeout(200); await popup.screenshot({ path: join(results, "popup.png"), fullPage: true }); await popup.close();
  const video = await context.newPage(); await video.goto(`http://127.0.0.1:${server.address().port}`); await video.locator("#play").click();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1/*" }))[0].id);
  result = await call("START", { tabId }); assert.equal(result.ok, undefined, JSON.stringify(result));
  assert.equal(result.running, true, JSON.stringify(result)); checks.push("real Chrome tabCapture + offscreen startup");
  const waitForCue = async () => {
    for (let i = 0; i < 40; i++) {
      const latest = await call("GET_STATE");
      if (latest.state.cueCount > 0) return latest;
      if (!latest.state.running) throw new Error(`Capture ended: ${JSON.stringify(latest.state)}`);
      await options.waitForTimeout(250);
    }
    const debug = await options.evaluate(() => chrome.runtime.sendMessage({target:'test-only'}));
    throw new Error(`No subtitle generated: ${JSON.stringify(await call("GET_STATE"))}; audio=${JSON.stringify(debug)}; errors=${JSON.stringify(errors)}`);
  };
  result = await waitForCue(); checks.push("OpenAI mocked STT→MT through captured WAV");
  const debug = await options.evaluate(() => chrome.runtime.sendMessage({ target: "test-only" }));
  assert.ok(debug.wavBytes > 44); assert.deepEqual(debug.models.slice(0, 2), ["gpt-4o-mini-transcribe", "gpt-6-luna"]);
  await video.screenshot({ path: join(results, "overlay.png") });
  assert.equal(await video.locator("#subtrans-ai-overlay").count(), 1);
  await video.evaluate(() => document.querySelector("video").requestFullscreen());
  let nativeCue = false;
  for (let i = 0; i < 24; i++) {
    nativeCue = await video.evaluate(() => [...document.querySelector('video').textTracks].some(t => t.label === 'SubTrans AI' && t.mode === 'showing' && t.cues?.length));
    if (nativeCue) break;
    await options.waitForTimeout(250);
  }
  assert.ok(nativeCue); checks.push("video-element fullscreen uses native subtitles");
  await video.evaluate(() => document.exitFullscreen());
  const leak = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
    try { return await chrome.storage.local.get("credential"); } catch { return "denied"; }
  } }))[0].result, tabId);
  assert.equal(leak, "denied"); checks.push("content script cannot access stored API key");
  const forged = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => chrome.runtime.sendMessage({ target: "background", type: "GET_CUES" }) }))[0].result, tabId);
  assert.equal(forged.ok, false); checks.push("untrusted content messages rejected");
  const initialCalls = (await options.evaluate(() => chrome.runtime.sendMessage({target:'test-only',set:{delay:8000}}))).calls;
  for (let i = 0; i < 24; i++) {
    const latest = await options.evaluate(() => chrome.runtime.sendMessage({target:'test-only'}));
    if (latest.calls > initialCalls) break;
    await options.waitForTimeout(250);
  }
  await video.evaluate(() => document.querySelector("video").pause()); await options.waitForTimeout(500);
  const paused = await call("GET_STATE"); assert.ok(paused.state.generation > 0); checks.push("pause invalidates prior generation");
  assert.ok((await options.evaluate(() => chrome.runtime.sendMessage({target:'test-only'}))).aborted > 0);
  const pausedCues = paused.state.cueCount; await options.waitForTimeout(600);
  assert.equal((await call('GET_STATE')).state.cueCount, pausedCues); checks.push("in-flight request cancelled on pause without late subtitle");
  await call("STOP"); assert.equal(await video.locator("#subtrans-ai-overlay").count(), 0);
  assert.equal(await worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length), 0); checks.push("stop removes capture document and overlay");
  await call("SAVE_SETTINGS", { settings: { ...result.settings, provider: "auto", rememberKey: false }, key: "AIza-test-placeholder-not-a-real-key" });
  assert.equal(await worker.evaluate(async () => Boolean((await chrome.storage.local.get("credential")).credential)), false); checks.push("session-only key removes persisted copy");
  await video.evaluate(() => document.querySelector("video").play());
  result = await call("START", { tabId }); assert.equal(result.running, true, JSON.stringify(result)); await waitForCue(); checks.push("Gemini mocked audio→subtitle pipeline");
  await options.evaluate(() => chrome.runtime.sendMessage({ target: "test-only", set: { errorStatus: 429 } }));
  for (let i = 0; i < 35; i++) { result = await call("GET_STATE"); if (!result.state.running) break; await options.waitForTimeout(250); }
  assert.equal(result.state.phase, "error"); assert.match(result.state.message, /429/); checks.push("429 stops capture and further API calls");
  await call("DELETE_KEY"); result = await call("GET_STATE"); assert.equal(result.hasKey, false); checks.push("delete key clears both vaults");
  assert.deepEqual(errors, []); checks.push("no browser JavaScript errors");
  await writeFile(join(results, "browser-results.json"), JSON.stringify({ checkedAt: new Date().toISOString(), checks, api: "mocked; no real credentials or paid requests", audioCapture: "real Chrome tabCapture with generated test audio", errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await context?.close(); server.close(); }

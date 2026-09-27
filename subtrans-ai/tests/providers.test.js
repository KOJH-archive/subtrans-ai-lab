import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, sanitizeSettings, detectProvider, parseGlossary } from "../extension/lib/config.js";
import { translateAudio, parseResult, verifyKey } from "../extension/lib/providers.js";
const response = data => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const settings = sanitizeSettings(DEFAULTS);
const base = { key: "test-placeholder", settings, wav: new ArrayBuffer(44), signal: new AbortController().signal };
test("API key routing detects both providers and rejects mismatches", () => {
  assert.equal(detectProvider("sk-placeholder-for-unit-test"), "openai");
  assert.equal(detectProvider("AIza-placeholder-for-unit-test"), "gemini");
  assert.throws(() => detectProvider("sk-placeholder-for-unit-test", "gemini"));
  assert.throws(() => detectProvider("")); assert.throws(() => detectProvider("unknown-key-with-sufficient-length"));
});
test("settings reject CSS injection and bound usage, fonts and context", () => {
  const result = sanitizeSettings({ chunkMs: 100000, sessionMinutes: 10000, style: { font: 'x";display:none', color: "url(https://evil)", position: -50, size: 900 } });
  assert.equal(result.chunkMs, 6000); assert.equal(result.sessionMinutes, 180);
  assert.equal(result.style.position, 10); assert.equal(result.style.size, 48); assert.equal(result.style.color, "#ffffff");
  assert.equal(result.style.font, "Malgun Gothic");
  assert.deepEqual(parseGlossary("machine learning = 머신러닝\ninvalid\n = empty"), [{ source: "machine learning", target: "머신러닝" }]);
});
test("OpenAI uploads valid multipart then translates through Responses using the same key", async () => {
  const calls = []; let counted = 0;
  const result = await translateAudio({ ...base, provider: "openai", context: [1,2,3,4], onRequest: () => counted++ }, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("transcriptions")) return response({ text: "Hello." });
    return response({ status: "completed", output: [{ type: "reasoning", content: [] }, { type: "message", content: [{ type: "output_text", text: '{"source":"Hello.","translation":"안녕하세요."}' }] }] });
  });
  assert.equal(result.translation, "안녕하세요."); assert.equal(counted, 2);
  assert.equal(calls[0].options.body.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(calls[0].options.body.get("file").type, "audio/wav");
  const body = JSON.parse(calls[1].options.body); assert.equal(body.store, false); assert.equal(body.reasoning.effort, "none");
  assert.deepEqual(JSON.parse(body.input).previous, [2,3,4]);
  assert.equal(calls[0].options.headers.Authorization, calls[1].options.headers.Authorization);
});
test("Gemini sends audio and text schema in one request without a key in the URL", async () => {
  let request;
  const result = await translateAudio({ ...base, provider: "gemini" }, async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return response({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"source":"你好","translation":"안녕하세요"}' }] } }] });
  });
  assert.equal(result.translation, "안녕하세요"); assert.ok(!request.url.includes(base.key));
  assert.equal(request.options.headers["x-goog-api-key"], base.key);
  assert.equal(request.body.contents[0].parts[1].inlineData.mimeType, "audio/wav");
  assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
});
test("Gemini quality preset uses low thinking rather than unsupported minimal", async () => {
  await translateAudio({ ...base, provider: "gemini", settings: { ...settings, quality: "quality" } }, async (url, options) => {
    assert.ok(url.includes("gemini-3.8-flash")); assert.equal(JSON.parse(options.body).generationConfig.thinkingConfig.thinkingLevel, "low");
    return response({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"source":"hello","translation":"안녕"}' }] } }] });
  });
});
test("quota errors stop without retries and cannot echo a secret from the provider", async () => {
  let count = 0;
  await assert.rejects(translateAudio({ ...base, provider: "gemini" }, async () => {
    count++; return new Response(`sensitive ${base.key}`, { status: 429 });
  }), error => error.status === 429 && !error.message.includes(base.key));
  assert.equal(count, 1);
});
test("empty transcription skips paid text translation", async () => {
  let count = 0; const result = await translateAudio({ ...base, provider: "openai" }, async () => { count++; return response({ text: "" }); });
  assert.equal(result.translation, ""); assert.equal(count, 1);
});
test("abort after transcription never launches a second paid request", async () => {
  const controller = new AbortController(); let count = 0;
  await assert.rejects(translateAudio({ ...base, signal: controller.signal, provider: "openai" }, async () => {
    count++; controller.abort(); return response({ text: "hello" });
  })); assert.equal(count, 1);
});
test("malformed, blocked and truncated responses are rejected", async () => {
  assert.throws(() => parseResult("not json")); assert.throws(() => parseResult('{"source":12,"translation":"x"}'));
  await assert.rejects(translateAudio({ ...base, provider: "gemini" }, async () => response({ candidates: [{ finishReason: "MAX_TOKENS" }] })));
});
test("connection verification only reads model metadata without paid inference", async () => {
  const urls = []; await verifyKey({ provider: "openai", key: base.key, quality: "economy" }, async (url, options) => {
    assert.equal(options.method, undefined); urls.push(url); return response({ id: "model" });
  }); assert.equal(urls.length, 2); assert.ok(urls.every(url => url.includes("/models/")));
});

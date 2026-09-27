import test from "node:test";
import assert from "node:assert/strict";
import { audioOptions, cleanTranscript, cleanTranslation, trimRepeatedPrefix } from "../extension/lib/ondevice.js";
import { Segmenter, encodeWav } from "../extension/lib/audio.js";

test("audio capabilities request English and Japanese input/output without unsupported Korean Prompt output", () => {
  assert.deepEqual(audioOptions("en").expectedOutputs, [{ type: "text", languages: ["en"] }]);
  assert.deepEqual(audioOptions("ja").expectedInputs[0].languages, ["en", "ja"]);
  assert.throws(() => audioOptions("zh"), /영어·일본어/);
});
test("empty or no-speech prompts do not generate subtitles", () => {
  for (const input of ["", "[NO SPEECH]", "No speech.", "  silence  "]) assert.equal(cleanTranscript(input), "");
  assert.equal(cleanTranscript("```text\nHello there.\n```"), "Hello there.");
  assert.equal(cleanTranslation("  안녕하세요.  "), "안녕하세요.");
});
test("audio segmenter emits bounded speech and valid WAV for Prompt API", () => {
  const segmenter = new Segmenter({ maxMs: 700, silenceMs: 200 });
  let segment;
  for (let i = 0; i < 50; i++) segment ||= segmenter.push(new Float32Array(320).fill(.09));
  assert.ok(segment?.samples.length > 320);
  const wav = encodeWav(segment.samples);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new DataView(wav).getUint32(24, true), 16000);
});

test("forced audio cuts reuse 700 ms of speech but silence boundaries do not", () => {
  const segmenter = new Segmenter({ sampleRate: 1000, maxMs: 4000, silenceMs: 200, overlapMs: 700 });
  const emitted = [];
  for (let i = 0; i < 73; i++) {
    const segment = segmenter.push(new Float32Array(100).fill(.1 + i / 100));
    if (segment) emitted.push(segment);
  }
  assert.equal(emitted.length, 2);
  assert.deepEqual(emitted.map(s => [s.startSample, s.endSample, s.overlapSamples]),
    [[0, 4000, 0], [3300, 7300, 700]]);
  assert.deepEqual(emitted[0].samples.slice(-700), emitted[1].samples.slice(0, 700));
  assert.equal(segmenter.push(new Float32Array(100)), null);
  assert.equal(segmenter.push(new Float32Array(100)), null);
  assert.equal(segmenter.overlapSamples, 0);
});

test("transcript overlap removes repeated English words and Japanese characters", () => {
  assert.equal(trimRepeatedPrefix("We need to turn left", "turn left at the station", "en"), "at the station");
  assert.equal(trimRepeatedPrefix("今日は良い天気です", "天気です。散歩しましょう", "ja"), "散歩しましょう");
  assert.equal(trimRepeatedPrefix("We need to turn left", "Then continue straight", "en"), "Then continue straight");
});

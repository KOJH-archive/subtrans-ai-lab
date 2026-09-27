import test from "node:test";
import assert from "node:assert/strict";
import { Resampler, Segmenter, encodeWav, rms, toBase64 } from "../extension/lib/audio.js";
test("resampling 44.1kHz and 48kHz preserves time across arbitrary block boundaries", () => {
  for (const rate of [44100, 48000]) {
    const source = Float32Array.from({ length: rate }, (_, i) => Math.sin(i / 20));
    const whole = new Resampler(rate).push(source); const stream = new Resampler(rate); const pieces = [];
    for (let i = 0; i < source.length; i += 128) pieces.push(...stream.push(source.subarray(i, i + 128)));
    assert.equal(pieces.length, 16000); assert.deepEqual(new Float32Array(pieces), whole);
  }
});
test("WAV header, clipping and byte order match a 16kHz mono PCM16 upload", () => {
  const wav = encodeWav(new Float32Array([-2, 0, 2])); const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 6); assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(48, true), 32767); assert.equal(atob(toBase64(wav)).length, 50);
});
test("silence and a brief click do not trigger cloud uploads", () => {
  const segmenter = new Segmenter(); const frames = Array.from({ length: 200 }, () => new Float32Array(320));
  frames[50].fill(0.5);
  assert.equal(frames.map(f => segmenter.push(f)).filter(Boolean).length, 0);
  assert.equal(rms(new Float32Array(320)), 0);
});
test("speech contains preroll and closes after silence without duplicate audio", () => {
  const segmenter = new Segmenter(); let result;
  for (let i = 0; i < 30; i++) segmenter.push(new Float32Array(320));
  for (let i = 0; i < 30; i++) segmenter.push(new Float32Array(320).fill(.1));
  for (let i = 0; i < 30; i++) result = segmenter.push(new Float32Array(320)) || result;
  assert.equal(result.startSample, 18 * 320); assert.equal(result.endSample, 90 * 320);
  assert.equal(result.samples.length, 72 * 320);
  assert.equal(segmenter.push(new Float32Array(320)), null);
});
test("continuous speech splits at maximum duration with contiguous sample ranges", () => {
  const segmenter = new Segmenter({ maxMs: 2000 }); const results = [];
  for (let i = 0; i < 300; i++) { const result = segmenter.push(new Float32Array(320).fill(.1)); if (result) results.push(result); }
  assert.equal(results.length, 3); assert.equal(results[1].startSample, results[0].endSample);
  assert.equal(results[2].endSample, 96000);
});
test("reset drops old speech while keeping the capture clock", () => {
  const segmenter = new Segmenter(); segmenter.push(new Float32Array(320).fill(.1)); segmenter.reset();
  assert.equal(segmenter.cursor, 320); assert.equal(segmenter.frames.length, 0);
});

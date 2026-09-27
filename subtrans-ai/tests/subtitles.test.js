import test from "node:test";
import assert from "node:assert/strict";
import { timestamp, exportSubtitles } from "../extension/lib/subtitles.js";
test("SRT time carries milliseconds correctly and clamps negative values", () => {
  assert.equal(timestamp(59.9996), "00:01:00,000"); assert.equal(timestamp(-2), "00:00:00,000");
  assert.equal(timestamp(3661.123), "01:01:01,123");
});
test("subtitle exports keep Korean and avoid invalid blank cue blocks", () => {
  const cues = [{ start: 2, end: 1, translation: "한국어\n\n자막" }];
  assert.match(exportSubtitles(cues), /00:00:02,000 --> 00:00:02,300\n한국어\n자막/);
  assert.ok(exportSubtitles(cues, "vtt").startsWith("WEBVTT\n\n"));
});

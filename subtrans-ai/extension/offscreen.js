import { Segmenter, encodeWav } from "./lib/audio.js";
import { translateAudio } from "./lib/providers.js";

let session = null;
async function notify(type, extra = {}) {
  if (!session) return;
  try { await chrome.runtime.sendMessage({ target: "background", type, sessionId: session.id, ...extra }); } catch { /* worker can restart */ }
}
function publish(message) {
  if (!session) return;
  if (message) session.report.message = message;
  return notify("ENGINE_STATUS", { report: session.report });
}
async function cleanup() {
  const old = session; if (!old) return;
  session = null; old.active = false; old.controller?.abort(); old.queue.length = 0; old.key = "";
  clearInterval(old.timer); clearTimeout(old.limit);
  if (old.worklet) old.worklet.port.onmessage = null;
  old.worklet?.disconnect(); old.source?.disconnect();
  old.stream?.getTracks().forEach(track => track.stop());
  if (old.audio && old.audio.state !== "closed") await old.audio.close();
}
async function finish(message, failed = false) {
  const id = session?.id; if (!id) return;
  await cleanup();
  try { await chrome.runtime.sendMessage({ target: "background", type: "ENGINE_END", sessionId: id, message, failed }); } catch { /* browser closed */ }
}
function mediaAt(current, wall) {
  const playback = current.playback;
  if (!playback || !Number.isFinite(playback.time)) return Math.max(0, (wall - current.startedAt) / 1000);
  return Math.max(0, playback.time + (playback.paused ? 0 : (wall - playback.at) / 1000 * playback.rate));
}
async function drain(current) {
  if (current.busy) return;
  current.busy = true;
  try {
    while (current.active && current.queue.length) {
      const job = current.queue.shift();
      if (job.generation !== current.generation || Date.now() - job.endWall > 12000) { current.report.dropped++; continue; }
      const controller = new AbortController(); current.controller = controller;
      const timeout = setTimeout(() => controller.abort(new Error("timeout")), 20000);
      current.report.phase = "processing"; publish("음성을 한국어로 번역하고 있습니다.");
      try {
        current.report.audioSeconds += job.samples.length / 16000;
        const result = await translateAudio({ provider: current.provider, key: current.key, settings: current.settings,
          wav: encodeWav(job.samples), context: current.context, signal: controller.signal,
          onRequest: () => { current.report.requests++; }
        });
        if (!current.active || current.generation !== job.generation) continue;
        current.report.latencyMs = Math.max(0, Date.now() - job.endWall);
        if (!result.translation || !result.source) continue;
        current.context.push({ source: result.source, translation: result.translation }); current.context = current.context.slice(-3);
        if (Date.now() - job.endWall > 12000) { current.report.dropped++; continue; }
        await notify("ENGINE_CUE", { cue: { id: ++current.sequence, generation: job.generation, source: result.source,
          translation: result.translation, start: job.mediaStart, end: job.mediaEnd, receivedAt: Date.now() } });
      } catch (error) {
        if (!current.active || current.generation !== job.generation) continue;
        const message = controller.signal.aborted ? "응답 시간이 길어 번역을 중지했습니다. 연결 상태를 확인한 뒤 다시 시작해 주세요." : error.message;
        await finish(message, true); break;
      } finally { clearTimeout(timeout); if (current.controller === controller) current.controller = null; }
    }
  } finally {
    current.busy = false;
    if (current.active) { current.report.phase = current.playback?.paused ? "paused" : "listening"; publish(current.report.dropped ? "처리가 늦은 일부 구간을 건너뛰었습니다. 품질 모드나 음성 구간 길이를 조정해 주세요." : "다음 음성을 기다리고 있습니다."); }
  }
}
async function start(message) {
  await cleanup();
  const threshold = { quiet: 0.004, normal: 0.008, noisy: 0.016 }[message.settings.sensitivity];
  const current = { id: message.sessionId, active: true, key: message.key, provider: message.provider, settings: message.settings,
    generation: message.generation, playback: message.playback, queue: [], context: [], sequence: 0, busy: false,
    report: { requests: 0, audioSeconds: 0, dropped: 0, latencyMs: 0, phase: "listening", message: "음성을 기다리고 있습니다." },
    segmenter: new Segmenter({ threshold, maxMs: message.settings.chunkMs }) };
  session = current;
  try {
    current.stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } }, video: false });
    current.audio = new AudioContext();
    await current.audio.audioWorklet.addModule("audio-worklet.js");
    current.source = current.audio.createMediaStreamSource(current.stream);
    current.worklet = new AudioWorkletNode(current.audio, "subtrans-capture");
    current.source.connect(current.audio.destination);
    current.source.connect(current.worklet); current.worklet.connect(current.audio.destination);
    await current.audio.resume(); current.startedAt = Date.now();
    current.worklet.port.onmessage = event => {
      if (!current.active) return;
      if (current.playback?.paused) { current.segmenter.cursor += event.data.length; return; }
      const segment = current.segmenter.push(event.data); if (!segment) return;
      const startWall = current.startedAt + segment.startSample / 16, endWall = current.startedAt + segment.endSample / 16;
      if (current.queue.length >= 2) { current.queue.shift(); current.report.dropped++; }
      current.queue.push({ ...segment, generation: current.generation, endWall, mediaStart: mediaAt(current, startWall), mediaEnd: mediaAt(current, endWall) });
      void drain(current);
    };
    for (const track of current.stream.getTracks()) track.onended = () => { if (current.active) void finish("탭 오디오 캡처가 종료되었습니다."); };
    current.timer = setInterval(() => publish(), 1000);
    current.limit = setTimeout(() => finish("설정한 사용 시간이 지나 자동으로 중지했습니다."), message.settings.sessionMinutes * 60000);
    return { ok: true };
  } catch {
    await cleanup(); return { ok: false, error: "탭 오디오를 캡처할 수 없습니다." };
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "offscreen" || sender.id !== chrome.runtime.id || sender.url && sender.url !== chrome.runtime.getURL("background.js")) return;
  const run = async () => {
    if (message.type === "START") return start(message);
    if (message.type === "STOP") { await cleanup(); return { ok: true }; }
    if (message.type === "PLAYBACK" && session) {
      if (message.generation !== session.generation) {
        session.generation = message.generation; session.controller?.abort(); session.queue.length = 0; session.context = []; session.segmenter.reset();
      }
      session.playback = message.playback;
      if (message.playback?.paused) session.report.phase = "paused";
      return { ok: true };
    }
    return { ok: true };
  };
  run().then(respond, () => respond({ ok: false, error: "오디오 처리 중 오류가 발생했습니다." })); return true;
});

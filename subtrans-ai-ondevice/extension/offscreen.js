import { Segmenter, encodeWav } from "./lib/audio.js";
import { audioOptions, cleanTranscript, cleanTranslation, LANGUAGES, trimRepeatedPrefix } from "./lib/ondevice.js";

let session = null;
const send = (current, type, data = {}) => chrome.runtime.sendMessage({ target: "ondevice-worker", type, id: current.id, ...data }).catch(() => {});
const live = current => Boolean(current && session === current && current.active);
async function deadline(promise, milliseconds, label, lateResult) {
  let timer, expired = false;
  const guarded = promise.then(result => { if (expired) { lateResult?.(result); return null; } return result; });
  try { return await Promise.race([guarded, new Promise((_, reject) => { timer = setTimeout(() => {
    expired = true; reject(Error(`${label} 시간이 초과됐습니다. 전체 화면 내장 AI 실험실에서 모델을 먼저 준비해 주세요.`));
  }, milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function status(current, phase, message) { if (live(current)) await send(current, "STATUS", { phase, message }); }
async function cleanup() {
  const old = session; if (!old) return;
  session = null; old.active = false; old.controller?.abort(); old.queue.length = 0;
  clearTimeout(old.restartTimer);
  if (old.recognition) {
    old.recognition.onresult = old.recognition.onerror = old.recognition.onend = null;
    try { old.recognition.abort(); } catch {}
  }
  old.worklet?.disconnect(); old.sourceNode?.disconnect();
  old.stream?.getTracks().forEach(track => track.stop());
  if (old.audio && old.audio.state !== "closed") await old.audio.close();
  old.model?.destroy();
  for (const translator of old.translators.values()) translator.destroy();
}
async function fail(current, error) {
  if (!live(current)) return;
  const message = String(error?.message || error || "Chrome 내장 AI 오류").slice(0, 180);
  await send(current, "ERROR", { message: `${message} Chrome 내장 AI 지원 상태와 다운로드를 확인해 주세요.` });
  await cleanup();
}
async function translatorFor(current, sourceLanguage) {
  if (!LANGUAGES.includes(sourceLanguage) && !(current.mode === "speech" && sourceLanguage === "ko"))
    throw Error("지원하지 않는 자막 언어입니다.");
  if (current.translators.has(sourceLanguage)) return current.translators.get(sourceLanguage);
  if (typeof Translator === "undefined") throw Error("이 Chrome에는 Translator API가 없습니다.");
  const targetLanguage = current.mode === "speech" ? current.target : "ko";
  const options = { sourceLanguage, targetLanguage };
  const availability = await Translator.availability(options);
  if (availability === "unavailable") throw Error(`${sourceLanguage}→${targetLanguage} 내장 번역을 사용할 수 없습니다.`);
  await status(current, "downloading", `${sourceLanguage}→${targetLanguage} 언어팩을 준비하는 중입니다. 첫 실행은 다운로드가 필요할 수 있습니다.`);
  const translator = await deadline(Translator.create({ ...options, monitor(monitor) {
    monitor.addEventListener("downloadprogress", event => void status(current, "downloading", `번역 언어팩 다운로드 ${Math.round(event.loaded * 100)}%`));
  } }), 300000, "번역 언어팩 준비", result => result.destroy());
  if (!live(current)) { translator.destroy(); throw Error("취소됨"); }
  current.translators.set(sourceLanguage, translator);
  return translator;
}
async function prepareModel(current) {
  const options = audioOptions(current.source);
  if (typeof LanguageModel === "undefined") throw Error("이 Chrome에는 Gemini Nano Prompt API가 없습니다.");
  const availability = await LanguageModel.availability(options);
  if (availability === "unavailable") throw Error("이 컴퓨터에서는 Gemini Nano 오디오 입력을 사용할 수 없습니다. GPU 조건을 확인해 주세요.");
  await status(current, "downloading", "Gemini Nano 오디오 모델을 준비하는 중입니다. 첫 실행은 다운로드가 필요할 수 있습니다.");
  const model = await deadline(LanguageModel.create({ ...options, monitor(monitor) {
    monitor.addEventListener("downloadprogress", event => void status(current, "downloading", `Gemini Nano 다운로드 ${Math.round(event.loaded * 100)}%`));
  } }), 1200000, "Gemini Nano 준비", result => result.destroy());
  if (!live(current)) { model.destroy(); return; }
  current.model = model;
  await translatorFor(current, current.source);
  if (!live(current)) return;
  await current.audio.audioWorklet.addModule("audio-worklet.js");
  current.worklet = new AudioWorkletNode(current.audio, "subtrans-capture");
  current.sourceNode.connect(current.worklet); current.worklet.connect(current.audio.destination);
  current.segmenter = new Segmenter({ maxMs: 4000, silenceMs: 650, overlapMs: 700 });
  current.worklet.port.onmessage = event => {
    if (!live(current)) return;
    const segment = current.segmenter.push(event.data);
    if (segment) enqueue(current, { kind: "audio", samples: segment.samples,
      overlapSamples: segment.overlapSamples, created: Date.now() });
  };
  await status(current, "ready", "음성을 듣고 있습니다. 모델 처리에는 수 초 이상 걸릴 수 있습니다.");
}
async function prepareSpeech(current) {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (typeof Recognition !== "function" || typeof Recognition.available !== "function")
    throw Error("이 Chrome에는 온디바이스 Web Speech API가 없습니다.");
  const availability = await Recognition.available({ langs: ["ko-KR"], processLocally: true });
  if (!live(current)) return;
  if (availability !== "available") {
    const reason = availability === "unavailable" ? "한국어 음성팩을 지원하지 않습니다." :
      `한국어 음성팩 상태가 ${availability}입니다.`;
    throw Error(`${reason} 확장 팝업에서 한국어 음성팩을 먼저 준비해 주세요.`);
  }
  await translatorFor(current, "ko");
  if (!live(current)) return;
  const audioTrack = current.stream.getAudioTracks()[0];
  if (!audioTrack || audioTrack.readyState !== "live") throw Error("캡처한 탭의 오디오 트랙이 종료되었습니다.");
  const recognition = new Recognition();
  current.recognition = recognition;
  recognition.lang = "ko-KR";
  recognition.processLocally = true;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = event => {
    if (!live(current)) return;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const text = cleanTranscript(result[0]?.transcript);
      if (text) enqueue(current, { kind: "caption", text, language: "ko", created: Date.now() });
    }
  };
  recognition.onerror = event => {
    if (!live(current) || event.error === "no-speech" || event.error === "aborted") return;
    void fail(current, Error(`온디바이스 음성 인식 오류: ${event.error || "unknown"}`));
  };
  recognition.onend = () => {
    if (!live(current)) return;
    current.restartTimer = setTimeout(() => {
      if (!live(current) || audioTrack.readyState !== "live") return;
      try { recognition.start(audioTrack); }
      catch (error) { void fail(current, error); }
    }, 250);
  };
  recognition.start(audioTrack);
  await status(current, "ready", "탭의 한국어 음성을 기기에서 인식하고 번역하고 있습니다.");
}
function enqueue(current, item) {
  if (!live(current)) return;
  if (current.queue.length >= 2) current.queue.shift();
  current.queue.push(item); void drain(current);
}
async function drain(current) {
  if (current.busy) return;
  current.busy = true;
  try {
    while (live(current) && current.queue.length) {
      const item = current.queue.shift();
      const staleMs = item.kind === "audio" ? 90000 : 20000;
      if (Date.now() - item.created > staleMs) continue;
      try {
        let source, language, token = "";
        if (item.kind === "audio") {
          if (!current.model) continue;
          const wav = new Blob([encodeWav(item.samples)], { type: "audio/wav" });
          const prompt = current.source === "ja" ? "Transcribe the Japanese speech verbatim in Japanese. Return only the transcript. If no speech, return [NO SPEECH]." :
            "Transcribe the English speech verbatim in English. Return only the transcript. If no speech, return [NO SPEECH].";
          current.controller = new AbortController();
          const promptTimeout = setTimeout(() => current.controller?.abort(Error("Nano 음성 전사 시간이 초과됐습니다.")), 60000);
          let transcript;
          try { transcript = cleanTranscript(await current.model.prompt([{ role: "user", content: [
            { type: "text", value: prompt }, { type: "audio", value: wav }
          ] }], { signal: current.controller.signal })); }
          finally { clearTimeout(promptTimeout); }
          source = item.overlapSamples
            ? trimRepeatedPrefix(current.lastAudioTranscript, transcript, current.source)
            : transcript;
          if (transcript) current.lastAudioTranscript = transcript;
          language = current.source;
        } else { source = item.text; language = item.language; token = item.token; }
        if (!source || !live(current)) continue;
        const translator = await translatorFor(current, language);
        const translation = cleanTranslation(await deadline(translator.translate(source), 30000, "내장 번역"));
        if (!live(current) || !translation || Date.now() - item.created > staleMs) continue;
        await send(current, "RESULT", { cue: { source, translation, token } });
        await status(current, "ready", "자막을 번역하고 있습니다.");
      } catch (error) { if (live(current)) { await fail(current, error); break; } }
      finally { current.controller = null; }
    }
  } finally { current.busy = false; }
}
async function start(message) {
  if (message.mode === "speech" && (message.source !== "ko" || !["en", "ja"].includes(message.output)))
    throw Error("한국어 음성 번역은 영어 또는 일본어 출력만 지원합니다.");
  await cleanup();
  const current = { id: message.id, mode: message.mode, source: message.source, target: message.output, active: true,
    translators: new Map(), model: null, queue: [], busy: false, controller: null };
  session = current;
  if (current.mode === "captions") {
    await status(current, "ready", "영상의 HTML5 자막 트랙을 기다리는 중입니다.");
    return { ok: true };
  }
  try {
    current.stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: {
      chromeMediaSource: "tab", chromeMediaSourceId: message.streamId
    } }, video: false });
    current.audio = new AudioContext(); current.sourceNode = current.audio.createMediaStreamSource(current.stream);
    current.sourceNode.connect(current.audio.destination); await current.audio.resume();
    for (const track of current.stream.getTracks()) track.onended = () => { if (live(current)) void fail(current, Error("탭 오디오 캡처가 종료되었습니다.")); };
    void (current.mode === "speech" ? prepareSpeech(current) : prepareModel(current)).catch(error => fail(current, error));
    return { ok: true };
  } catch (error) { await cleanup(); return { ok: false, error: String(error?.message || error) }; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "ondevice-engine" || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("background.js")) return;
  const run = async () => {
    if (message.type === "START") return start(message);
    if (message.type === "STOP") { await cleanup(); return { ok: true }; }
    if (message.type === "CAPTION" && live(session) && session.id === message.id && session.mode === "captions") {
      enqueue(session, { kind: "caption", text: message.cue.text, language: message.cue.language,
        token: message.cue.token, created: Date.now() }); return { ok: true };
    }
    return { ok: false };
  };
  run().then(respond, error => respond({ ok: false, error: String(error?.message || error) })); return true;
});

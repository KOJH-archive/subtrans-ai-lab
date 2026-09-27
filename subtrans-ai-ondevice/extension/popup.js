import { audioOptions } from "./lib/ondevice.js";
const $ = id => document.getElementById(id);
async function awaitModel(promise, label) {
  let timer, expired = false;
  const guarded = promise.then(model => { if (expired) { model.destroy(); return null; } return model; });
  try { return await Promise.race([guarded, new Promise((_, reject) => { timer = setTimeout(() => {
    expired = true; reject(Error(`${label} 준비가 20분을 넘었습니다. Chrome의 모델 다운로드 상태와 네트워크를 확인해 주세요.`));
  }, 1200000); })]); }
  finally { clearTimeout(timer); }
}
let state = { running: false };
let style = { size: 26, position: 85, showSource: false };
let preparing = false;
const languages = () => $("mode").value === "speech"
  ? { sourceLanguage: "ko", targetLanguage: $("target").value }
  : { sourceLanguage: $("source").value, targetLanguage: "ko" };
const send = async (type, extra = {}) => {
  const result = await chrome.runtime.sendMessage({ target: "ondevice-ui", type, ...extra });
  if (!result?.ok) throw Error(result?.error || "확장프로그램 요청에 실패했습니다.");
  return result;
};
function render() {
  $("state").textContent = state.message || "시작할 준비가 되었습니다.";
  $("toggle").textContent = state.running ? "번역 중지" : "현재 탭에서 시작";
  $("toggle").classList.toggle("stop", state.running);
  $("mode").disabled = state.running;
  $("source").disabled = state.running;
  $("target").disabled = state.running;
  $("prepare").disabled = state.running || preparing;
  $("sizeValue").textContent = `${style.size}px`;
  $("positionValue").textContent = `${style.position}%`;
}
function modeNote() {
  const speech = $("mode").value === "speech";
  $("sourceGroup").hidden = speech; $("targetGroup").hidden = !speech;
  if (speech) {
    $("modeNote").textContent = "한국어 탭 음성을 Chrome의 온디바이스 음성 인식으로 받아 영어 또는 일본어로 번역합니다. 먼저 언어팩을 준비하세요. 실제 지원 여부는 Chrome과 기기에 따라 다릅니다.";
    if ($("testInput").value === "Hello, this is an on-device translation test.")
      $("testInput").value = "안녕하세요. 오늘은 좋은 날입니다.";
  } else if ($("mode").value === "audio") {
    if (!["en", "ja"].includes($("source").value)) $("source").value = "en";
    $("modeNote").textContent = "실험 기능: 영어·일본어 음성을 4초 안팎으로 모아 Gemini Nano가 전사하고, Translator API가 한국어로 번역합니다. 오디오 입력에는 전용 GPU 조건이 있습니다.";
  } else {
    $("modeNote").textContent = "HTML5 자막 트랙이 있는 영상에서 작동합니다. 영어·중국어·일본어 → 한국어 언어팩이 첫 사용 때 다운로드될 수 있습니다.";
  }
}
async function capability() {
  const rows = [];
  if (typeof Translator === "undefined") rows.push("번역 API 없음 · Chrome 138 이상 데스크톱이 필요합니다.");
  else {
    for (const sourceLanguage of ["en", "ja", "zh"]) {
      try { rows.push(`${sourceLanguage.toUpperCase()}→KO 번역: ${await Translator.availability({ sourceLanguage, targetLanguage: "ko" })}`); }
      catch { rows.push(`${sourceLanguage.toUpperCase()}→KO 번역: 확인 실패`); }
    }
    for (const targetLanguage of ["en", "ja"]) {
      try { rows.push(`KO→${targetLanguage.toUpperCase()} 번역: ${await Translator.availability({ sourceLanguage: "ko", targetLanguage })}`); }
      catch { rows.push(`KO→${targetLanguage.toUpperCase()} 번역: 확인 실패`); }
    }
  }
  const Speech = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (typeof Speech?.available !== "function") rows.push("한국어 로컬 음성 인식: API 없음");
  else {
    try { rows.push(`한국어 로컬 음성 인식: ${await Speech.available({ langs: ["ko-KR"], processLocally: true })}`); }
    catch { rows.push("한국어 로컬 음성 인식: 확인 실패"); }
  }
  if (typeof LanguageModel === "undefined") rows.push("Gemini Nano 오디오: Prompt API 없음");
  else {
    try { rows.push(`Gemini Nano 오디오: ${await LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }, { type: "audio" }],
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    })}`); }
    catch { rows.push("Gemini Nano 오디오: 확인 실패"); }
  }
  $("capabilities").replaceChildren(...rows.map(row => { const span = document.createElement("span"); span.textContent = row; return span; }));
}
async function refresh() {
  if (preparing) return;
  try { const result = await send("STATE"); state = result.state; style = result.style; render(); }
  catch (error) { $("state").textContent = error.message; }
}
$("mode").addEventListener("change", modeNote);
$("prepare").addEventListener("click", async () => {
  const mode = $("mode").value, { sourceLanguage, targetLanguage } = languages();
  if (sourceLanguage === "auto") { $("state").textContent = "먼저 준비할 원문 언어를 선택해 주세요."; return; }
  preparing = true; $("prepare").disabled = true; $("toggle").disabled = true; $("prepare").textContent = "내장 모델 준비 중…";
  try {
    if (typeof Translator === "undefined") throw Error("Translator API가 없습니다. Chrome 버전을 확인해 주세요.");
    if (mode === "speech") {
      const Speech = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
      if (typeof Speech?.install !== "function") throw Error("한국어 온디바이스 음성 인식 API가 없습니다.");
      const installed = Speech.install({ langs: ["ko-KR"], processLocally: true });
      const translator = awaitModel(Translator.create({ sourceLanguage, targetLanguage, monitor(monitor) {
        monitor.addEventListener("downloadprogress", event => { $("state").textContent = `번역 언어팩 다운로드 ${Math.round(event.loaded * 100)}%`; });
      } }), "번역 언어팩");
      const [speechResult, translationResult] = await Promise.allSettled([installed, translator]);
      if (translationResult.status === "fulfilled") translationResult.value?.destroy();
      if (speechResult.status === "rejected") throw speechResult.reason;
      if (speechResult.value !== true) throw Error("한국어 로컬 음성 언어팩을 설치할 수 없습니다.");
      if (translationResult.status === "rejected") throw translationResult.reason;
      $("state").textContent = "한국어 음성·번역 언어팩 준비가 끝났습니다.";
      void capability(); return;
    }
    if (mode === "audio") {
      if (typeof LanguageModel === "undefined") throw Error("Gemini Nano Prompt API가 없습니다.");
      const options = audioOptions(sourceLanguage);
      const model = await awaitModel(LanguageModel.create({ ...options, monitor(monitor) {
        monitor.addEventListener("downloadprogress", event => { $("state").textContent = `Gemini Nano 다운로드 ${Math.round(event.loaded * 100)}%`; });
      } }), "Gemini Nano");
      model.destroy();
    }
    const options = { sourceLanguage, targetLanguage };
    const translator = await awaitModel(Translator.create({ ...options, monitor(monitor) {
      monitor.addEventListener("downloadprogress", event => { $("state").textContent = `번역 언어팩 다운로드 ${Math.round(event.loaded * 100)}%`; });
    } }), "번역 언어팩");
    translator.destroy(); $("state").textContent = "내장 모델 준비가 끝났습니다. 번역을 시작하세요.";
    void capability();
  } catch (error) { $("state").textContent = error.message; }
  finally { preparing = false; $("prepare").disabled = state.running; $("toggle").disabled = false; $("prepare").textContent = "언어팩 / 모델 미리 준비"; }
});
$("testTranslate").addEventListener("click", async () => {
  const { sourceLanguage, targetLanguage } = languages();
  const input = $("testInput").value.trim();
  if (sourceLanguage === "auto") { $("testOutput").textContent = "영어·일본어·중국어 중 원문 언어를 선택해 주세요."; return; }
  if (!input) { $("testOutput").textContent = "시험할 원문을 입력해 주세요."; return; }
  $("testTranslate").disabled = true;
  $("testOutput").textContent = "Chrome 내장 번역 모델을 준비하는 중입니다…";
  let translator;
  try {
    if (typeof Translator === "undefined") throw Error("이 Chrome에는 Translator API가 없습니다.");
    const options = { sourceLanguage, targetLanguage };
    translator = await awaitModel(Translator.create({ ...options, monitor(monitor) {
      monitor.addEventListener("downloadprogress", event => { $("testOutput").textContent = `언어팩 다운로드 ${Math.round(event.loaded * 100)}%`; });
    } }), "번역 언어팩");
    $("testOutput").textContent = await translator.translate(input);
  } catch (error) { $("testOutput").textContent = `실제 내장 AI 오류: ${error.message}`; }
  finally { translator?.destroy(); $("testTranslate").disabled = false; }
});
$("toggle").addEventListener("click", async () => {
  $("toggle").disabled = true;
  try {
    if (state.running) state = (await send("STOP")).state;
    else state = (await send("START", { mode: $("mode").value,
      source: $("mode").value === "speech" ? "ko" : $("source").value,
      output: $("mode").value === "speech" ? $("target").value : "ko" })).state;
    render();
  } catch (error) { $("state").textContent = error.message; }
  finally { $("toggle").disabled = false; }
});
for (const field of ["size", "position", "showSource"]) {
  $(field).addEventListener("input", async () => {
    style[field] = field === "showSource" ? $(field).checked : Number($(field).value);
    render(); try { await send("STYLE", { style }); } catch {}
  });
}
await refresh();
$("size").value = style.size; $("position").value = style.position; $("showSource").checked = style.showSource;
modeNote(); void capability();
setInterval(refresh, 1200);

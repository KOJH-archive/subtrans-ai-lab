import { audioOptions, cleanTranscript } from "./lib/ondevice.js";
const $ = id => document.getElementById(id);
function report(id, message, error = false) { const element = $(id); element.textContent = message; element.classList.toggle("error", error); }
async function availability() {
  try { $("translationAvailability").textContent = typeof Translator === "undefined" ? "Translator API 없음" :
    `번역 모델: ${await Translator.availability({ sourceLanguage: $("language").value, targetLanguage: "ko" })}`; }
  catch (error) { $("translationAvailability").textContent = `번역 지원 확인 오류: ${error.message}`; }
  try { $("audioAvailability").textContent = typeof LanguageModel === "undefined" ? "Prompt API 없음" :
    `Nano 오디오: ${await LanguageModel.availability(audioOptions($("audioLanguage").value))}`; }
  catch (error) { $("audioAvailability").textContent = `Nano 지원 확인 오류: ${error.message}`; }
}
async function awaitModel(promise, label) {
  let timer, expired = false;
  const guarded = promise.then(model => { if (expired) { model.destroy(); return null; } return model; });
  try { return await Promise.race([guarded, new Promise((_, reject) => { timer = setTimeout(() => {
    expired = true; reject(Error(`${label} 준비가 20분을 넘었습니다. Chrome 모델 다운로드 상태와 네트워크를 확인해 주세요.`));
  }, 1200000); })]); }
  finally { clearTimeout(timer); }
}
function createTranslator(language, stateId) {
  if (typeof Translator === "undefined") throw Error("이 Chrome에는 Translator API가 없습니다.");
  return Translator.create({ sourceLanguage: language, targetLanguage: "ko", monitor(monitor) {
    monitor.addEventListener("downloadprogress", event => report(stateId, `번역 언어팩 다운로드 ${Math.round(event.loaded * 100)}%`));
  } });
}
$("prepareAudio").addEventListener("click", async () => {
  const button = $("prepareAudio");
  button.disabled = true; report("audioState", "Gemini Nano 모델을 준비하는 중입니다. 이 페이지를 열어 두세요.");
  let model;
  try {
    if (typeof LanguageModel === "undefined") throw Error("이 Chrome에는 Prompt API가 없습니다.");
    model = await awaitModel(LanguageModel.create({ ...audioOptions($("audioLanguage").value), monitor(monitor) {
      monitor.addEventListener("downloadprogress", event => report("audioState", `Gemini Nano 다운로드 ${Math.round(event.loaded * 100)}%`));
    } }), "Gemini Nano");
    report("audioState", "Gemini Nano 모델 준비가 끝났습니다. 음성 전사 또는 영상 번역을 시작하세요.");
    void availability();
  } catch (error) { report("audioState", `모델 준비 오류: ${error.message}`, true); }
  finally { model?.destroy(); button.disabled = false; }
});
$("translate").addEventListener("click", async () => {
  const text = $("input").value.trim(), language = $("language").value;
  if (!text) { report("translationState", "원문을 입력해 주세요.", true); return; }
  $("translate").disabled = true; report("translationState", "Chrome 번역 모델을 준비하는 중입니다…");
  let translator;
  try {
    // create() starts in the actual click activation, before the first await.
    translator = await awaitModel(createTranslator(language, "translationState"), "번역 언어팩");
    report("translationState", await translator.translate(text));
  } catch (error) { report("translationState", `실제 내장 AI 오류: ${error.message}`, true); }
  finally { translator?.destroy(); $("translate").disabled = false; }
});
$("transcribe").addEventListener("click", async () => {
  const file = $("audioFile").files[0], language = $("audioLanguage").value;
  if (!file) { report("audioState", "음성 파일을 선택해 주세요.", true); return; }
  if (file.size > 10_000_000) { report("audioState", "10MB 이하의 짧은 파일을 선택해 주세요.", true); return; }
  $("transcribe").disabled = true; report("audioState", "Gemini Nano 오디오 모델을 준비하는 중입니다…");
  let model, translator;
  try {
    if (typeof LanguageModel === "undefined") throw Error("이 Chrome에는 Prompt API가 없습니다.");
    if (typeof Translator === "undefined") throw Error("이 Chrome에는 Translator API가 없습니다.");
    const options = audioOptions(language);
    // Start both model creations within the click activation.
    const modelPromise = LanguageModel.create({ ...options, monitor(monitor) {
      monitor.addEventListener("downloadprogress", event => report("audioState", `Gemini Nano 다운로드 ${Math.round(event.loaded * 100)}%`));
    } });
    const translatorPromise = createTranslator(language, "audioState");
    const outcomes = await Promise.allSettled([
      awaitModel(modelPromise, "Gemini Nano"), awaitModel(translatorPromise, "번역 언어팩")
    ]);
    if (outcomes[0].status === "fulfilled") model = outcomes[0].value;
    if (outcomes[1].status === "fulfilled") translator = outcomes[1].value;
    if (outcomes[0].status === "rejected") throw outcomes[0].reason;
    if (outcomes[1].status === "rejected") throw outcomes[1].reason;
    report("audioState", "음성을 기기에서 전사하는 중입니다…");
    const instruction = language === "ja" ? "Transcribe the Japanese speech verbatim in Japanese. Return only the transcript. If no speech, return [NO SPEECH]." :
      "Transcribe the English speech verbatim in English. Return only the transcript. If no speech, return [NO SPEECH].";
    const source = cleanTranscript(await model.prompt([{ role: "user", content: [
      { type: "text", value: instruction }, { type: "audio", value: file }
    ] }]));
    if (!source) { report("audioState", "음성이 인식되지 않았습니다."); return; }
    report("audioState", `원문: ${source}\n\n한국어 번역 중…`);
    const translation = await translator.translate(source);
    report("audioState", `원문: ${source}\n한국어: ${translation}`);
  } catch (error) { report("audioState", `실제 내장 AI 오류: ${error.message}`, true); }
  finally { model?.destroy(); translator?.destroy(); $("transcribe").disabled = false; }
});
$("language").addEventListener("change", availability);
$("audioLanguage").addEventListener("change", availability);
void availability();

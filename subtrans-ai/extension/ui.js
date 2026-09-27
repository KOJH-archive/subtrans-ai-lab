import { DEFAULTS, sanitizeSettings, detectProvider, modelLabel } from "./lib/config.js";
import { exportSubtitles } from "./lib/subtitles.js";

const $ = id => document.getElementById(id);
const isPopup = document.body.classList.contains("popup");
let config = sanitizeSettings(DEFAULTS), knownProvider = null, hasKey = false, busy = false, currentState = {}, saveTimer;
async function call(type, data = {}) {
  if (!globalThis.chrome?.runtime?.sendMessage) throw new Error("이 화면은 Chrome에 확장프로그램을 설치한 뒤 사용할 수 있습니다.");
  const result = await chrome.runtime.sendMessage({ target: "background", type, ...data });
  if (result?.ok === false) throw new Error(result.error);
  if (!result) throw new Error("확장프로그램에 연결하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
  return result;
}
function feedback(message, error = false) {
  $("feedback").textContent = message; $("feedback").classList.toggle("error", error); $("feedback").hidden = false;
}
async function action(task) {
  if (busy) return; busy = true;
  document.querySelectorAll("button").forEach(button => button.disabled = true);
  try { await task(); } catch (error) { feedback(error.message, true); }
  finally { busy = false; document.querySelectorAll("button").forEach(button => button.disabled = false); renderState(currentState); }
}
function populate() {
  for (const [id, key] of [["provider", "provider"], ["language", "language"], ["quality", "quality"], ["session-minutes", "sessionMinutes"], ["chunk-ms", "chunkMs"], ["sensitivity", "sensitivity"], ["glossary", "glossary"]]) {
    if ($(id)) $(id).value = String(config[key]);
  }
  $("remember-key").checked = config.rememberKey;
  document.querySelectorAll("[data-style]").forEach(input => {
    const value = config.style[input.dataset.style];
    if (input.type === "checkbox") input.checked = value; else input.value = value;
  });
  providerPreview(); preview();
}
function collect() {
  const next = { ...config, style: { ...config.style }, provider: $("provider").value, language: $("language").value,
    quality: $("quality").value, rememberKey: $("remember-key").checked };
  for (const [id, key] of [["session-minutes", "sessionMinutes"], ["chunk-ms", "chunkMs"], ["sensitivity", "sensitivity"], ["glossary", "glossary"]]) if ($(id)) next[key] = $(id).value;
  document.querySelectorAll("[data-style]").forEach(input => next.style[input.dataset.style] = input.type === "checkbox" ? input.checked : input.value);
  return sanitizeSettings(next);
}
function providerPreview() {
  let provider = knownProvider;
  if ($("api-key").value.trim()) {
    try { provider = detectProvider($("api-key").value, $("provider").value); } catch { provider = null; }
  } else if ($("provider").value !== "auto") provider = $("provider").value;
  $("provider-badge").textContent = provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : "키 하나로 시작";
  $("key-hint").textContent = hasKey ? "키가 저장되어 있습니다. 바꾸려면 새 키를 입력하세요." : "키 형식을 확인해 공급자를 자동으로 선택합니다.";
  if ($("model-name")) $("model-name").textContent = modelLabel(provider, $("quality").value);
  $("api-key").placeholder = hasKey ? "저장된 키 사용 · 변경할 때만 입력" : "sk-… 또는 AIza…";
}
function preview() {
  const s = collect().style;
  for (const [key, unit] of [["size", "px"], ["position", "%"], ["opacity", "%"]]) if ($(`${key}-value`)) $(`${key}-value`).textContent = `${s[key]}${unit}`;
  if (!$("preview-caption")) return;
  const caption = $("preview-caption");
  caption.style.top = `${s.position}%`; caption.style.fontFamily = `"${s.font}",sans-serif`;
  caption.style.fontSize = `${s.size * .7}px`; caption.style.color = s.color; caption.style.textAlign = s.align;
  caption.style.textShadow = s.effect === "shadow" ? "0 2px 4px #000" : "none";
  caption.style.webkitTextStroke = s.effect === "outline" ? ".7px #000" : "0 transparent";
  const rgb = s.background.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16)).join(",");
  for (const line of caption.children) {
    line.style.background = `rgba(${rgb},${s.opacity / 100})`;
    line.style.marginLeft = s.align === "left" ? "0" : "auto"; line.style.marginRight = s.align === "right" ? "0" : "auto";
  }
  $("preview-source").style.display = s.showSource ? "table" : "none";
}
function renderState(state = {}) {
  currentState = state;
  $("phase").textContent = ({ idle: "시작 준비", starting: "연결 중", listening: "음성 감지 중", processing: "번역 중", paused: "일시정지", error: "확인 필요" })[state.phase] || "시작 준비";
  $("status-message").textContent = state.message || "API 키를 연결하고 영상에서 시작해 주세요.";
  $("status-dot").classList.toggle("on", Boolean(state.running)); $("status-dot").classList.toggle("error", state.phase === "error");
  $("latency").textContent = state.latencyMs ? `${(state.latencyMs / 1000).toFixed(1)}초` : "—";
  $("requests").textContent = String(state.requests || 0); $("cue-count").textContent = String(state.cueCount || 0);
  $("stop").hidden = !state.running;
  if ($("start")) $("start").hidden = Boolean(state.running);
  $("export").disabled = busy || !state.cueCount;
  if ($("adjust")) $("adjust").disabled = busy || !state.running;
}
async function load(initial = false) {
  const data = await call("GET_STATE"); knownProvider = data.provider; hasKey = data.hasKey;
  if (initial) { config = data.settings; populate(); if ($("key-details")) $("key-details").open = !hasKey; }
  renderState(data.state); providerPreview();
}
async function save() {
  clearTimeout(saveTimer);
  const next = collect(); await call("SAVE_SETTINGS", { settings: next, key: $("api-key").value });
  config = next; $("api-key").value = ""; await load(); if ($("key-details")) $("key-details").open = !hasKey;
}
$("settings-form").addEventListener("submit", event => {
  event.preventDefault(); action(async () => {
    await save();
    if (isPopup) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("현재 탭을 찾을 수 없습니다.");
      await call("START", { tabId: tab.id }); await load(); feedback("번역을 시작했습니다. 팝업을 닫아도 계속 작동합니다.");
    } else feedback("설정을 저장했습니다. 영상 탭에서 확장 아이콘을 눌러 시작하세요.");
  });
});
$("stop").addEventListener("click", () => action(async () => { await call("STOP"); await load(); feedback("캡처와 API 요청을 중지했습니다."); }));
$("toggle-key").addEventListener("click", () => {
  const show = $("api-key").type === "password"; $("api-key").type = show ? "text" : "password";
  $("toggle-key").textContent = show ? "숨김" : "보기"; $("toggle-key").setAttribute("aria-label", show ? "API 키 숨기기" : "API 키 표시");
});
for (const id of ["api-key", "provider", "quality"]) $(id).addEventListener("input", providerPreview);
$("open-options")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
$("verify")?.addEventListener("click", () => action(async () => {
  await save(); await call("VERIFY_KEY"); feedback("키와 선택 모델의 접근 권한을 확인했습니다. 음성 인식·번역 성공 여부는 실제 영상에서 확인하세요.");
}));
$("delete-key")?.addEventListener("click", () => action(async () => { await call("DELETE_KEY"); $("api-key").value = ""; await load(); feedback("저장한 키를 삭제했습니다."); }));
$("adjust")?.addEventListener("click", () => action(async () => { await call("ADJUST"); feedback("번역 중인 영상 탭으로 돌아가 자막 손잡이를 드래그하세요. Esc로 완료합니다."); }));
document.querySelectorAll("[data-style]").forEach(input => input.addEventListener("input", () => {
  preview(); clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { const next = collect(); await call("SAVE_STYLE", { style: next.style }); config.style = next.style; }
    catch (error) { feedback(error.message, true); }
  }, 120);
}));
$("reset-style")?.addEventListener("click", () => action(async () => {
  config.style = { ...DEFAULTS.style };
  document.querySelectorAll("[data-style]").forEach(input => { const value = config.style[input.dataset.style]; if (input.type === "checkbox") input.checked = value; else input.value = value; });
  await call("SAVE_STYLE", { style: config.style }); preview(); feedback("기본 자막 스타일로 되돌렸습니다.");
}));
$("export").addEventListener("click", () => action(async () => {
  const { cues } = await call("GET_CUES");
  if (!cues.length) throw new Error("저장할 자막이 없습니다.");
  // Use only the latest continuous generation, avoiding mixed timelines after a seek or ad.
  const generation = cues.at(-1).generation; const selected = cues.filter(cue => cue.generation === generation);
  const url = URL.createObjectURL(new Blob(["\ufeff", exportSubtitles(selected)], { type: "application/x-subrip;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `SubTrans-${new Date().toISOString().slice(0, 10)}.srt`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  feedback("최근 연속 재생 구간의 자막을 저장했습니다. 탐색 이전 구간은 포함하지 않습니다.");
}));
load(true).catch(error => feedback(error.message, true));
setInterval(() => { if (!busy && !document.hidden) load().catch(() => {}); }, 1200);

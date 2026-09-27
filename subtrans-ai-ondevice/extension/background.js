const INITIAL_STYLE = { size: 26, position: 85, showSource: false };
let session = null;
let offscreenCreation = null;
let lastMessage = "시작할 준비가 되었습니다.";

const isPopup = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html");
const isEngine = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("offscreen.html");
const boundedStyle = raw => ({
  size: Number.isFinite(+raw?.size) ? Math.max(14, Math.min(48, Math.round(+raw.size))) : 26,
  position: Number.isFinite(+raw?.position) ? Math.max(10, Math.min(95, Math.round(+raw.position))) : 85,
  showSource: Boolean(raw?.showSource)
});
async function restoreSession() {
  if (session) return;
  const saved = (await chrome.storage.session.get("ondeviceSession")).ondeviceSession;
  if (saved && Number.isInteger(saved.tabId) && typeof saved.id === "string") session = saved;
}
const persistSession = () => session ? chrome.storage.session.set({ ondeviceSession: session }) : chrome.storage.session.remove("ondeviceSession");
const publicState = () => session ? { running: true, phase: session.phase, message: session.message, mode: session.mode, source: session.source, target: session.target,
  translated: session.translated } : { running: false, phase: "idle", message: lastMessage, translated: 0 };

async function sendOverlay(type, data = {}) {
  if (!session) return;
  try { return await chrome.tabs.sendMessage(session.tabId, { target: "ondevice-overlay", type, ...data }); } catch { return null; }
}
async function ensureOffscreen() {
  if (offscreenCreation) return offscreenCreation;
  offscreenCreation = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (!contexts.length) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"],
      justification: "Process captured tab audio and Chrome built-in AI in an extension document" });
  })().finally(() => { offscreenCreation = null; });
  return offscreenCreation;
}
async function stop(message = "번역을 중지했습니다.") {
  const old = session; if (!old) return;
  session = null;
  lastMessage = message;
  await persistSession();
  try { await chrome.runtime.sendMessage({ target: "ondevice-engine", type: "STOP", id: old.id }); } catch {}
  try { await chrome.tabs.sendMessage(old.tabId, { target: "ondevice-overlay", type: "STOP" }); } catch {}
  try { await chrome.offscreen.closeDocument(); } catch {}
  return { running: false, phase: "idle", message };
}
async function start(message, sender) {
  if (!isPopup(sender)) throw Error("확장 팝업에서 시작해 주세요.");
  const mode = ["audio", "speech"].includes(message.mode) ? message.mode : "captions";
  const source = mode === "speech" ? "ko" : ["auto", "en", "ja", "zh"].includes(message.source) ? message.source : "auto";
  const target = mode === "speech" && ["en", "ja"].includes(message.output) ? message.output : "ko";
  if (mode === "audio" && !["en", "ja"].includes(source)) throw Error("음성 실험은 영어 또는 일본어만 지원합니다.");
  if (mode === "speech" && target === "ko") throw Error("한국어 음성의 번역 언어는 영어 또는 일본어를 선택해 주세요.");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw Error("일반 웹 동영상 탭에서 시작해 주세요.");
  await stop();
  lastMessage = "내장 모델을 준비하는 중입니다.";
  const id = crypto.randomUUID();
  const style = boundedStyle((await chrome.storage.local.get("style")).style || INITIAL_STYLE);
  session = { id, tabId: tab.id, mode, source, target, phase: "starting", message: "내장 모델을 준비하는 중입니다.", translated: 0 };
  await persistSession();
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await ensureOffscreen();
    if (session?.id !== id) return publicState();
    let streamId;
    if (mode === "audio" || mode === "speech") streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const result = await chrome.runtime.sendMessage({ target: "ondevice-engine", type: "START", id, mode, source, output: target, streamId });
    if (!result?.ok) throw Error(result?.error || "내장 모델을 시작할 수 없습니다.");
    await sendOverlay("INIT", { mode, source, style });
    return publicState();
  } catch (error) {
    if (session?.id === id) await stop();
    throw error;
  }
}
async function dispatch(message, sender) {
  if (!message || typeof message !== "object") return { ok: false };
  await restoreSession();
  if (message.target === "ondevice-ui" && isPopup(sender)) {
    if (message.type === "STATE") return { ok: true, state: publicState(), style: boundedStyle((await chrome.storage.local.get("style")).style || INITIAL_STYLE) };
    if (message.type === "START") return { ok: true, state: await start(message, sender) };
    if (message.type === "STOP") return { ok: true, state: await stop() || publicState() };
    if (message.type === "STYLE") {
      const style = boundedStyle(message.style); await chrome.storage.local.set({ style }); await sendOverlay("STYLE", { style });
      return { ok: true, style };
    }
  }
  if (message.target === "ondevice-worker" && isEngine(sender) && session?.id === message.id) {
    if (message.type === "STATUS") {
      session.phase = message.phase || session.phase; session.message = String(message.message || "").slice(0, 220);
      await persistSession(); return { ok: true };
    }
    if (message.type === "RESULT") {
      session.translated++;
      await persistSession();
      await sendOverlay("RESULT", { cue: message.cue }); return { ok: true };
    }
    if (message.type === "ERROR") {
      const error = String(message.message || "내장 AI를 사용할 수 없습니다.").slice(0, 220);
      await stop(error); return { ok: true, message: error };
    }
  }
  if (message.target === "ondevice-worker" && sender.id === chrome.runtime.id && sender.tab?.id === session?.tabId && !sender.frameId) {
    if (message.type === "CAPTION" && session.mode === "captions") {
      const text = String(message.cue?.text || "").trim().slice(0, 600);
      const language = String(message.cue?.language || "").toLowerCase().split("-")[0];
      if (!text || !["en", "ja", "zh"].includes(language)) return { ok: false };
      await chrome.runtime.sendMessage({ target: "ondevice-engine", type: "CAPTION", id: session.id,
        cue: { text, language, token: String(message.cue?.token || "").slice(0, 100) } });
      return { ok: true };
    }
    if (message.type === "TRACK_STATUS" && session.mode === "captions") {
      if (session.phase === "ready") session.message = String(message.message || "").slice(0, 220);
      return { ok: true };
    }
  }
  return { ok: false };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!["ondevice-ui", "ondevice-worker"].includes(message?.target)) return;
  dispatch(message, sender).then(respond, error => respond({ ok: false, error: String(error?.message || error).slice(0, 250) }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { void restoreSession().then(() => { if (session?.tabId === tabId) return stop(); }); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === "loading" || change.url) void restoreSession().then(() => { if (session?.tabId === tabId) return stop(); }); });

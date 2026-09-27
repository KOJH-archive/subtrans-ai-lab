import { DEFAULTS, sanitizeSettings, detectProvider, modelLabel } from "./lib/config.js";
import { verifyKey } from "./lib/providers.js";

const emptyState = () => ({ running: false, phase: "idle", message: "번역을 시작할 준비가 되었습니다.",
  tabId: null, sessionId: null, generation: 0, requests: 0, audioSeconds: 0, latencyMs: 0, dropped: 0, cues: [] });
let state = emptyState(); let lifecycle = Promise.resolve();
const ready = (async () => {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  ]);
  const saved = await chrome.storage.session.get("runtimeState");
  state = saved.runtimeState || emptyState();
  if (state.running && !(await hasOffscreen())) {
    state.running = false; state.phase = "idle"; state.message = "캡처가 종료되었습니다. 다시 시작해 주세요.";
    await persist();
  }
})();
async function persist() { await chrome.storage.session.set({ runtimeState: state }); }
async function settings() {
  const data = await chrome.storage.local.get("settings"); return sanitizeSettings(data.settings || DEFAULTS);
}
async function credential() {
  const temporary = await chrome.storage.session.get("credential");
  if (temporary.credential) return temporary.credential;
  return (await chrome.storage.local.get("credential")).credential || "";
}
function serialized(task) {
  const result = lifecycle.then(task, task); lifecycle = result.catch(() => {}); return result;
}
async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] })).length > 0;
}
async function engine(type, data = {}) {
  return chrome.runtime.sendMessage({ target: "offscreen", type, ...data });
}
async function overlay(type, data = {}) {
  if (!state.tabId) return;
  try { return await chrome.tabs.sendMessage(state.tabId, { target: "overlay", type, ...data }, { frameId: 0 }); } catch { /* page may be navigating */ }
}
async function badge(text = "") {
  await chrome.action.setBadgeText({ text }); await chrome.action.setBadgeBackgroundColor({ color: "#147d70" });
}
async function stop(message = "번역을 중지했습니다.", phase = "idle") {
  state.running = false; state.generation++; state.phase = phase; state.message = message;
  if (await hasOffscreen()) {
    try { await engine("STOP"); } catch { /* cleanup continues */ }
    try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
  }
  await overlay("STOP"); await badge(); await persist();
  return publicState();
}
function publicState() {
  const { cues, ...publicData } = state;
  return { ...publicData, cueCount: cues.length };
}
async function start(tabId) {
  if (state.running) throw new Error("이미 번역 중입니다. 먼저 현재 번역을 중지해 주세요.");
  const config = await settings(); const key = await credential(); const provider = detectProvider(key, config.provider);
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("일반 웹사이트의 동영상 탭에서 시작해 주세요. Chrome 설정 페이지에서는 사용할 수 없습니다.");
  state = { ...emptyState(), running: true, phase: "starting", message: "현재 탭의 오디오를 연결하고 있습니다…",
    tabId, sessionId: crypto.randomUUID(), generation: 0, startedAt: Date.now(), provider, model: modelLabel(provider, config.quality), title: tab.title || "동영상" };
  await persist();
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    const init = await overlay("INIT", { style: config.style });
    if (!init?.ok) throw new Error("이 페이지에 자막을 표시할 수 없습니다.");
    if (!(await hasOffscreen())) await chrome.offscreen.createDocument({
      url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "사용자가 선택한 탭 오디오를 캡처해 자막을 생성하고 원래 소리를 재생합니다."
    });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    const result = await engine("START", { streamId, key, provider, settings: config, sessionId: state.sessionId,
      generation: state.generation, playback: init.playback });
    if (!result?.ok) throw new Error(result?.error || "탭의 오디오를 연결하지 못했습니다.");
    state.phase = "listening"; state.message = init.hasVideo ? "음성을 기다리고 있습니다." : "영상 위치를 찾지 못해 창 하단에 자막을 표시합니다.";
    state.overlayFallback = !init.hasVideo; await badge("ON"); await persist(); return publicState();
  } catch (error) {
    await stop(error.message === "이 페이지에 자막을 표시할 수 없습니다." ? error.message : "캡처를 시작하지 못했습니다. 동영상을 재생한 뒤 다시 시작해 주세요.", "error");
    throw new Error(state.message);
  }
}
function isPage(sender, filename) { return sender.url?.split("?")[0] === chrome.runtime.getURL(filename); }
async function handle(message, sender) {
  await ready;
  const ui = isPage(sender, "popup.html") || isPage(sender, "options.html");
  const offscreen = isPage(sender, "offscreen.html");
  if (message.type === "OVERLAY_POSITION" && sender.tab?.id === state.tabId && sender.frameId === 0 && state.running) {
    const config = await settings();
    config.style.position = Math.max(10, Math.min(95, Number(message.position) || 85));
    await chrome.storage.local.set({ settings: config }); return { ok: true };
  }
  if (message.type === "PLAYBACK" && sender.tab?.id === state.tabId && sender.frameId === 0 && state.running) {
    if (message.playback?.discontinuity) {
      state.generation++; await overlay("CLEAR"); await persist();
    }
    await engine("PLAYBACK", { playback: message.playback, generation: state.generation });
    return { ok: true };
  }
  if (offscreen && message.sessionId === state.sessionId) {
    if (message.type === "ENGINE_STATUS" && state.running) {
      const report = message.report || {};
      for (const key of ["requests", "audioSeconds", "latencyMs", "dropped", "phase", "message"]) {
        if (report[key] !== undefined) state[key] = report[key];
      }
      await persist(); return { ok: true };
    }
    if (message.type === "ENGINE_CUE" && state.running && message.cue.generation === state.generation) {
      state.cues.push(message.cue); if (state.cues.length > 2000) state.cues.shift();
      let characters = state.cues.reduce((total, cue) => total + cue.source.length + cue.translation.length, 0);
      while (characters > 750000 && state.cues.length > 1) {
        const oldest = state.cues.shift(); characters -= oldest.source.length + oldest.translation.length;
      }
      await overlay("CUE", { cue: message.cue }); await persist(); return { ok: true };
    }
    if (message.type === "ENGINE_END") return serialized(() => stop(message.message, message.failed ? "error" : "idle"));
    return { ok: true };
  }
  if (!ui) throw new Error("허용되지 않은 요청입니다.");
  switch (message.type) {
    case "GET_STATE": {
      const config = await settings(); const key = await credential(); let provider = null;
      try { provider = detectProvider(key, config.provider); } catch { /* not configured */ }
      return { ok: true, settings: config, hasKey: Boolean(key), provider, state: publicState() };
    }
    case "SAVE_SETTINGS": return serialized(async () => {
      const previous = await settings(); const config = sanitizeSettings(message.settings);
      if (state.running && (message.key?.trim() || ["provider", "quality", "language", "chunkMs", "sessionMinutes", "sensitivity", "glossary"].some(k => previous[k] !== config[k]))) {
        throw new Error("번역 방식이나 키를 바꾸려면 먼저 번역을 중지해 주세요. 자막 스타일은 바로 변경할 수 있습니다.");
      }
      const key = message.key?.trim() || await credential();
      if (key) detectProvider(key, config.provider);
      await chrome.storage.local.set({ settings: config });
      if (config.rememberKey && key) {
        await chrome.storage.local.set({ credential: key }); await chrome.storage.session.remove("credential");
      } else {
        if (key) await chrome.storage.session.set({ credential: key });
        await chrome.storage.local.remove("credential");
      }
      await overlay("STYLE", { style: config.style }); return { ok: true };
    });
    case "SAVE_STYLE": {
      const config = sanitizeSettings({ ...await settings(), style: message.style });
      await chrome.storage.local.set({ settings: config }); await overlay("STYLE", { style: config.style }); return { ok: true };
    }
    case "DELETE_KEY": return serialized(async () => {
      if (state.running) await stop();
      await chrome.storage.local.remove("credential"); await chrome.storage.session.remove("credential"); return { ok: true };
    });
    case "VERIFY_KEY": {
      const config = await settings(); const key = await credential(); const provider = detectProvider(key, config.provider);
      await verifyKey({ provider, key, quality: config.quality }); return { ok: true };
    }
    case "START": return serialized(() => start(message.tabId));
    case "STOP": return serialized(() => stop());
    case "ADJUST": await overlay("ADJUST"); return { ok: true };
    case "GET_CUES": return { ok: true, cues: state.cues, title: state.title };
    default: throw new Error("지원하지 않는 요청입니다.");
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "background" || sender.id !== chrome.runtime.id) return;
  handle(message, sender).then(result => respond(result), error => respond({ ok: false, error: error.message || "작업을 완료하지 못했습니다." }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { ready.then(() => { if (state.running && state.tabId === tabId) serialized(() => stop("번역하던 탭이 닫혔습니다.")); }); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") ready.then(() => {
    if (state.running && state.tabId === tabId) serialized(() => stop("페이지가 이동되어 번역을 중지했습니다. 새 페이지에서 다시 시작해 주세요."));
  });
});

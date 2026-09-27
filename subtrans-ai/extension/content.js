(() => {
  if (globalThis.__subtransAI) return;
  globalThis.__subtransAI = true;
  let active = false, host, shadow, panel, sourceText, translatedText, handle;
  let video = null, style = {}, timer, clearTimer, lastSource = "", adjusting = false, drag = null;
  let nativeTrack = null, nativeVideo = null;
  const bindings = [];
  const send = (type, data = {}) => chrome.runtime.sendMessage({ target: "background", type, ...data }).catch(() => {});
  const rect = () => video?.isConnected ? video.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  function playback(discontinuity = false) {
    return video ? { time: video.currentTime, paused: video.paused || video.ended, rate: video.playbackRate,
      at: Date.now(), discontinuity, src: video.currentSrc?.slice(0, 200) || "" } : null;
  }
  function sync(discontinuity = false) { if (active) send("PLAYBACK", { playback: playback(discontinuity) || { discontinuity, paused: false, rate: 1, at: Date.now() } }); }
  function cleanupVideo() {
    bindings.splice(0).forEach(([element, name, callback]) => element.removeEventListener(name, callback));
  }
  function pickVideo() {
    const candidates = [...document.querySelectorAll("video")].filter(v => {
      const r = v.getBoundingClientRect(); return r.width > 60 && r.height > 40 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    });
    candidates.sort((a, b) => {
      const score = v => { const r = v.getBoundingClientRect(); return r.width * r.height * (v.paused ? 1 : 2); };
      return score(b) - score(a);
    });
    const next = candidates[0] || null;
    if (next === video) {
      if (video && lastSource !== video.currentSrc) { lastSource = video.currentSrc; sync(true); clear(); }
      return;
    }
    cleanupVideo(); video = next; lastSource = video?.currentSrc || "";
    if (video) {
      for (const name of ["seeking", "pause", "play", "ratechange", "emptied", "ended", "loadedmetadata"]) {
        const callback = () => { clear(); sync(true); };
        video.addEventListener(name, callback); bindings.push([video, name, callback]);
      }
    }
    clear(); sync(true);
  }
  function makeOverlay() {
    if (host?.isConnected) return;
    host = document.createElement("div"); host.id = "subtrans-ai-overlay";
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;";
    shadow = host.attachShadow({ mode: "closed" });
    const css = document.createElement("style");
    css.textContent = `:host{color-scheme:normal}*{box-sizing:border-box}.subtitle{position:fixed;margin:0;line-height:1.35;transform:translate(-50%,-100%);overflow-wrap:anywhere;white-space:pre-wrap;pointer-events:none;max-height:65vh;overflow:hidden}.line{display:table;margin:0 auto;padding:.18em .5em;border-radius:8px;max-width:100%}.original{font-size:.67em;opacity:.85;margin-bottom:4px}.handle{display:none;border:0;border-radius:6px;margin:0 auto 5px;padding:6px 12px;background:#147d70;color:white;font:12px sans-serif;cursor:ns-resize;pointer-events:auto;touch-action:none}.adjust .handle{display:table}.adjust{pointer-events:auto}.hidden{display:none}`;
    panel = document.createElement("div"); panel.className = "subtitle hidden"; panel.setAttribute("role", "status"); panel.setAttribute("aria-live", "off");
    handle = document.createElement("button"); handle.type = "button"; handle.className = "handle"; handle.textContent = "위아래로 드래그 · Esc로 완료";
    sourceText = document.createElement("div"); sourceText.className = "line original";
    translatedText = document.createElement("div"); translatedText.className = "line";
    panel.append(handle, sourceText, translatedText); shadow.append(css, panel); document.documentElement.append(host);
    handle.addEventListener("pointerdown", event => { drag = event.pointerId; handle.setPointerCapture(drag); event.preventDefault(); });
    handle.addEventListener("pointermove", event => {
      if (drag !== event.pointerId) return;
      const r = rect(); style.position = Math.round(Math.max(10, Math.min(95, (event.clientY - r.top) / r.height * 100))); layout();
    });
    handle.addEventListener("pointerup", () => { drag = null; send("OVERLAY_POSITION", { position: style.position }); });
  }
  function mount() {
    if (!host) return;
    const fullscreen = document.fullscreenElement;
    const parent = fullscreen && fullscreen.tagName !== "VIDEO" ? fullscreen : document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    if (nativeTrack && fullscreen !== nativeVideo) { nativeTrack.mode = "disabled"; clearNative(); }
  }
  function layout() {
    if (!panel) return;
    mount(); const r = rect();
    panel.style.left = `${Math.max(0, r.left) + r.width / 2}px`;
    panel.style.top = `${Math.max(0, r.top) + r.height * (style.position || 85) / 100}px`;
    panel.style.maxWidth = `${Math.max(100, Math.min(r.width * 0.88, innerWidth - 24))}px`;
    panel.style.fontFamily = `"${style.font || "Malgun Gothic"}",sans-serif`; panel.style.fontSize = `${style.size || 26}px`;
    panel.style.color = style.color || "#ffffff"; panel.style.textAlign = style.align || "center";
    panel.style.textShadow = style.effect === "shadow" ? "0 2px 4px #000,0 0 2px #000" : "none";
    panel.style.webkitTextStroke = style.effect === "outline" ? "1px #000" : "0px transparent";
    const rgb = (style.background || "#101820").match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16)).join(",");
    for (const line of [sourceText, translatedText]) {
      line.style.background = `rgba(${rgb},${(style.opacity ?? 75) / 100})`;
      line.style.marginLeft = style.align === "left" ? "0" : "auto"; line.style.marginRight = style.align === "right" ? "0" : "auto";
    }
    sourceText.style.display = style.showSource && sourceText.textContent ? "table" : "none";
  }
  function clearNative() { if (nativeTrack?.cues) for (const cue of [...nativeTrack.cues]) nativeTrack.removeCue(cue); }
  function clear() {
    clearTimeout(clearTimer); clearNative();
    if (panel && !adjusting) { panel.classList.add("hidden"); sourceText.textContent = ""; translatedText.textContent = ""; }
  }
  function cue(data) {
    if (!active) return; clearTimeout(clearTimer);
    sourceText.textContent = data.source; translatedText.textContent = data.translation; panel.classList.remove("hidden");
    const duration = Math.max(3000, Math.min(8000, data.translation.length * 100));
    if (document.fullscreenElement?.tagName === "VIDEO" && video === document.fullscreenElement) {
      if (nativeVideo !== video) { if (nativeTrack) nativeTrack.mode = "disabled"; nativeVideo = video; nativeTrack = video.addTextTrack("subtitles", "SubTrans AI", "ko"); }
      clearNative(); nativeTrack.mode = "showing";
      nativeTrack.addCue(new VTTCue(video.currentTime, video.currentTime + duration / 1000 * video.playbackRate, data.translation));
    }
    layout(); clearTimer = setTimeout(clear, duration);
  }
  function stop() {
    active = false; adjusting = false; clearInterval(timer); clearTimeout(clearTimer); cleanupVideo(); clearNative();
    if (nativeTrack) nativeTrack.mode = "disabled";
    host?.remove(); host = null; panel = null; video = null;
    document.removeEventListener("fullscreenchange", layout); window.removeEventListener("resize", layout); window.removeEventListener("scroll", layout, true);
  }
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && adjusting) { adjusting = false; panel.classList.remove("adjust"); send("OVERLAY_POSITION", { position: style.position }); clear(); }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.target !== "overlay") return;
    if (message.type === "INIT") {
      stop(); style = message.style; makeOverlay(); pickVideo(); active = true; layout();
      document.addEventListener("fullscreenchange", layout); window.addEventListener("resize", layout); window.addEventListener("scroll", layout, true);
      timer = setInterval(() => { pickVideo(); if (!host.isConnected) makeOverlay(); layout(); sync(); }, 1000);
      respond({ ok: true, hasVideo: Boolean(video), playback: playback() });
    } else if (message.type === "STOP") { stop(); respond({ ok: true }); }
    else if (message.type === "STYLE") { style = message.style; layout(); respond({ ok: true }); }
    else if (message.type === "CLEAR") { clear(); respond({ ok: true }); }
    else if (message.type === "CUE") { cue(message.cue); respond({ ok: true }); }
    else if (message.type === "ADJUST" && active) {
      adjusting = true; panel.classList.add("adjust"); panel.classList.remove("hidden"); translatedText.textContent ||= "이 위치에 한국어 자막이 표시됩니다."; layout(); respond({ ok: true });
    }
  });
})();

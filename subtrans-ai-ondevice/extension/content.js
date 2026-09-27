(() => {
  if (globalThis.__subtransOnDevice) return;
  globalThis.__subtransOnDevice = true;
  let active = false, mode = "captions", wanted = "auto", style = {}, video = null, track = null;
  let host, shadow, box, original, korean, timer, vanishTimer, nativeTrack, nativeVideo;
  let lastToken = "", currentToken = "", previousTrackMode = null, previousTrack = null, lastReport = "";
  const send = (type, extra = {}) => chrome.runtime.sendMessage({ target: "ondevice-worker", type, ...extra }).catch(() => {});
  const language = value => String(value || "").toLowerCase().split("-")[0];
  const visibleVideo = () => [...document.querySelectorAll("video")].filter(v => {
    const r = v.getBoundingClientRect(); return r.width > 60 && r.height > 40 && r.bottom > 0 && r.right > 0;
  }).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0] || null;
  function restoreTrack() { if (previousTrack) { try { previousTrack.mode = previousTrackMode; } catch {} previousTrack = null; } }
  function clearNative() { if (nativeTrack?.cues) for (const cue of [...nativeTrack.cues]) nativeTrack.removeCue(cue); }
  function clear() { clearTimeout(vanishTimer); if (box) box.hidden = true; clearNative(); }
  function mount() {
    if (!host) return;
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== "VIDEO" ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
  }
  function layout() {
    if (!host || !box) return;
    mount(); const r = video?.isConnected ? video.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    box.style.left = `${r.left + r.width / 2}px`;
    box.style.top = `${r.top + r.height * (style.position || 85) / 100}px`;
    box.style.maxWidth = `${Math.min(innerWidth - 20, Math.max(140, r.width * .9))}px`;
    box.style.fontSize = `${style.size || 26}px`;
    original.style.display = style.showSource ? "block" : "none";
  }
  function makeOverlay() {
    if (host?.isConnected) return;
    host = document.createElement("div"); host.id = "subtrans-ondevice-overlay";
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
    shadow = host.attachShadow({ mode: "closed" });
    const css = document.createElement("style");
    css.textContent = `.cue{position:fixed;transform:translate(-50%,-100%);text-align:center;color:white;font-family:system-ui,"Malgun Gothic",sans-serif;font-weight:700;line-height:1.35;text-shadow:0 2px 5px #000;overflow-wrap:anywhere;white-space:pre-wrap}.cue[hidden]{display:none}.cue p{margin:4px auto;padding:.2em .55em;max-width:100%;width:max-content;border-radius:8px;background:rgba(0,0,0,.72)}.source{font-size:.67em;font-weight:500}`;
    box = document.createElement("div"); box.className = "cue"; box.hidden = true;
    original = document.createElement("p"); original.className = "source";
    korean = document.createElement("p"); box.append(original, korean); shadow.append(css, box); document.documentElement.append(host);
  }
  function selectTrack() {
    if (!video || mode !== "captions") return null;
    const tracks = [...video.textTracks].filter(t => t !== nativeTrack && ["subtitles", "captions"].includes(t.kind) && ["en", "ja", "zh"].includes(language(t.language)));
    return tracks.find(t => t.mode === "showing" && (wanted === "auto" || language(t.language) === wanted)) ||
      tracks.find(t => wanted === "auto" || language(t.language) === wanted) || null;
  }
  function scan() {
    if (!active) return;
    const nextVideo = visibleVideo();
    if (nextVideo !== video) { restoreTrack(); video = nextVideo; track = null; lastToken = currentToken = ""; clear(); }
    if (mode !== "captions") { layout(); return; }
    const nextTrack = selectTrack();
    if (nextTrack !== track) {
      restoreTrack(); track = nextTrack; lastToken = currentToken = ""; clear();
      if (track) { previousTrack = track; previousTrackMode = track.mode; track.mode = "hidden"; }
    }
    const report = !video ? "화면에서 영상 요소를 찾는 중입니다." : !track ? "이 영상에는 접근 가능한 HTML5 자막 트랙이 없습니다." : "기존 자막을 기다리는 중입니다.";
    if (report !== lastReport) { lastReport = report; send("TRACK_STATUS", { message: report }); }
    const cue = track?.activeCues?.[0];
    const text = String(cue?.text || "").replace(/<[^>]*>/g, "").trim();
    const token = cue && text ? `${video.currentSrc.slice(0, 50)}:${cue.startTime}:${cue.endTime}:${text.slice(0, 45)}` : "";
    currentToken = token;
    if (!token) { clear(); layout(); return; }
    if (token !== lastToken) { lastToken = token; clear(); send("CAPTION", { cue: { text, language: language(track.language), token } }); }
    layout();
  }
  function show(cue) {
    if (!active || !cue?.translation) return;
    if (mode === "captions" && cue.token !== currentToken) return;
    original.textContent = String(cue.source || ""); korean.textContent = String(cue.translation || "");
    box.hidden = false; layout(); clearTimeout(vanishTimer);
    if (document.fullscreenElement?.tagName === "VIDEO" && video === document.fullscreenElement) {
      if (nativeVideo !== video) { if (nativeTrack) nativeTrack.mode = "disabled"; nativeVideo = video; nativeTrack = video.addTextTrack("subtitles", "SubTrans On-device", "ko"); }
      clearNative(); nativeTrack.mode = "showing";
      nativeTrack.addCue(new VTTCue(video.currentTime, video.currentTime + 5 * video.playbackRate, cue.translation));
    }
    if (mode === "audio" || mode === "speech") vanishTimer = setTimeout(clear, 6000);
  }
  function stop() {
    active = false; clearInterval(timer); clear(); restoreTrack(); if (nativeTrack) nativeTrack.mode = "disabled";
    host?.remove(); host = null; box = null; video = null; track = null; lastToken = currentToken = "";
    document.removeEventListener("fullscreenchange", layout); window.removeEventListener("resize", layout);
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.target !== "ondevice-overlay") return;
    if (message.type === "INIT") {
      stop(); mode = message.mode; wanted = message.source; style = message.style; active = true; makeOverlay();
      scan(); timer = setInterval(scan, 250); document.addEventListener("fullscreenchange", layout); window.addEventListener("resize", layout);
      respond({ ok: true });
    } else if (message.type === "STOP") { stop(); respond({ ok: true }); }
    else if (message.type === "RESULT") { show(message.cue); respond({ ok: true }); }
    else if (message.type === "STYLE") { style = message.style; layout(); respond({ ok: true }); }
  });
})();

export const DEFAULTS = Object.freeze({
  provider: "auto", language: "auto", quality: "economy", chunkMs: 3600,
  sessionMinutes: 30, sensitivity: "normal", glossary: "", rememberKey: false,
  style: { font: "Malgun Gothic", size: 26, color: "#ffffff", background: "#101820",
    opacity: 75, position: 85, align: "center", effect: "shadow", showSource: false }
});
export const FONTS = ["Malgun Gothic", "Pretendard", "Noto Sans KR", "Nanum Gothic", "sans-serif"];
export const MODELS = Object.freeze({
  openai: {
    economy: { stt: "gpt-4o-mini-transcribe", mt: "gpt-6-luna" },
    quality: { stt: "gpt-4o-transcribe", mt: "gpt-6-sol" }
  },
  gemini: { economy: { audio: "gemini-3.5-flash-lite" }, quality: { audio: "gemini-3.8-flash" } }
});
const enumValue = (value, values, fallback) => values.includes(value) ? value : fallback;
const number = (value, low, high, fallback) => Number.isFinite(Number(value))
  ? Math.max(low, Math.min(high, Number(value))) : fallback;
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
export function sanitizeSettings(input = {}) {
  const s = input.style || {};
  return {
    provider: enumValue(input.provider, ["auto", "openai", "gemini"], "auto"),
    language: enumValue(input.language, ["auto", "en", "ja", "zh"], "auto"),
    quality: enumValue(input.quality, ["economy", "quality"], "economy"),
    chunkMs: number(input.chunkMs, 2000, 6000, DEFAULTS.chunkMs),
    sessionMinutes: number(input.sessionMinutes, 1, 180, 30),
    sensitivity: enumValue(input.sensitivity, ["quiet", "normal", "noisy"], "normal"),
    glossary: String(input.glossary || "").slice(0, 4000), rememberKey: input.rememberKey === true,
    style: {
      font: enumValue(s.font, FONTS, DEFAULTS.style.font), size: number(s.size, 14, 48, 26),
      color: color(s.color, "#ffffff"), background: color(s.background, "#101820"),
      opacity: number(s.opacity, 0, 100, 75), position: number(s.position, 10, 95, 85),
      align: enumValue(s.align, ["left", "center", "right"], "center"),
      effect: enumValue(s.effect, ["none", "shadow", "outline"], "shadow"), showSource: s.showSource === true
    }
  };
}
export function detectProvider(key, choice = "auto") {
  key = String(key || "").trim();
  if (!key || /\s/.test(key) || key.length < 16) throw new Error("API 키를 정확히 입력해 주세요.");
  const detected = key.startsWith("sk-") ? "openai" : key.startsWith("AIza") ? "gemini" : null;
  if (choice !== "auto") {
    if (!["openai", "gemini"].includes(choice)) throw new Error("지원하지 않는 API 공급자입니다.");
    if (detected && choice !== detected) throw new Error("선택한 공급자와 API 키 종류가 다릅니다.");
    return choice;
  }
  if (!detected) throw new Error("키 종류를 찾지 못했습니다. 공급자를 직접 선택해 주세요.");
  return detected;
}
export function parseGlossary(text) {
  return String(text || "").split(/\r?\n/).map(line => {
    const index = line.indexOf("=");
    if (index < 1) return null;
    const source = line.slice(0, index).trim().slice(0, 80);
    const target = line.slice(index + 1).trim().slice(0, 80);
    return source && target ? { source, target } : null;
  }).filter(Boolean).slice(0, 40);
}
export function modelLabel(provider, quality = "economy") {
  const models = MODELS[provider]?.[quality];
  return models ? Object.values(models).join(" → ") : "키를 연결하면 자동으로 선택됩니다";
}

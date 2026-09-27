export const LANGUAGES = ["en", "ja", "zh"];
export function audioOptions(source) {
  if (!["en", "ja"].includes(source)) throw Error("Gemini Nano 음성 실험은 영어·일본어만 지원합니다.");
  return {
    expectedInputs: [{ type: "text", languages: source === "ja" ? ["en", "ja"] : ["en"] }, { type: "audio" }],
    expectedOutputs: [{ type: "text", languages: [source] }]
  };
}
export function cleanTranscript(text) {
  const value = String(text || "").trim().replace(/^```[^\n]*\n?|```$/g, "").trim();
  if (!value || /^\[?(no speech|silence|audio unclear)\]?\.?$/i.test(value)) return "";
  return value.slice(0, 600);
}
export function cleanTranslation(text) {
  return String(text || "").trim().slice(0, 600);
}
export function trimRepeatedPrefix(previous, current, language) {
  const before = String(previous || "").trim(), after = String(current || "").trim();
  if (!before || !after) return after;
  if (language === "ja") {
    const a = Array.from(before), b = Array.from(after);
    for (let size = Math.min(30, a.length, b.length); size >= 3; size--) {
      if (a.slice(-size).join("") === b.slice(0, size).join(""))
        return b.slice(size).join("").replace(/^[、。，．！？!?,.\s]+/u, "").trim();
    }
    return after;
  }
  const words = text => [...text.matchAll(/\S+/g)].map(match => ({ value: match[0], end: match.index + match[0].length }));
  const a = words(before), b = words(after);
  const normalized = word => word.value.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  for (let size = Math.min(10, a.length, b.length); size >= 1; size--) {
    if (size === 1 && normalized(b[0]).length < 4) continue;
    if (a.slice(-size).every((word, i) => normalized(word) && normalized(word) === normalized(b[i]))) {
      return after.slice(b[size - 1].end).trim();
    }
  }
  return after;
}

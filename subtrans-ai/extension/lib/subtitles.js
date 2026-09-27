export function timestamp(seconds, separator = ",") {
  const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, secs = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}
export function exportSubtitles(cues, format = "srt") {
  const separator = format === "vtt" ? "." : ",";
  // A generation is one continuous playback interval; export keeps playback order.
  const blocks = cues.filter(cue => cue.translation).map((cue, index) =>
    `${index + 1}\n${timestamp(cue.start, separator)} --> ${timestamp(Math.max(cue.start + 0.3, cue.end), separator)}\n${cue.translation.replace(/\r/g, "").replace(/\n{2,}/g, "\n")}`);
  return `${format === "vtt" ? "WEBVTT\n\n" : ""}${blocks.join("\n\n")}\n`;
}

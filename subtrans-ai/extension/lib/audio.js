// Streaming box-filter resampling preserves sample count across worklet blocks.
export class Resampler {
  constructor(inputRate, outputRate = 16000) {
    this.ratio = inputRate / outputRate; this.weight = 0; this.sum = 0;
  }
  push(input) {
    const result = [];
    for (const value of input) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-8) {
          result.push(this.sum / this.ratio); this.sum = 0; this.weight = 0;
        }
      }
    }
    return new Float32Array(result);
  }
}
export function rms(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}
export class Segmenter {
  constructor({ sampleRate = 16000, threshold = 0.008, maxMs = 3600, silenceMs = 600 } = {}) {
    this.sampleRate = sampleRate; this.threshold = threshold;
    this.maxSamples = maxMs * sampleRate / 1000;
    this.silenceSamples = silenceMs * sampleRate / 1000;
    this.cursor = 0; this.reset();
  }
  reset() { this.frames = []; this.pre = []; this.length = 0; this.voice = 0; this.quiet = 0; }
  push(frame) {
    const start = this.cursor; this.cursor += frame.length;
    const voiced = rms(frame) >= this.threshold;
    if (!this.frames.length && !voiced) {
      this.pre.push({ samples: frame, start });
      while (this.pre.reduce((n, f) => n + f.samples.length, 0) > this.sampleRate * 0.24) this.pre.shift();
      return null;
    }
    if (!this.frames.length) {
      this.start = this.pre[0]?.start ?? start;
      this.frames = this.pre.map(f => f.samples); this.pre = [];
      this.length = this.frames.reduce((n, f) => n + f.length, 0);
    }
    this.frames.push(frame); this.length += frame.length;
    this.voice += voiced ? frame.length : 0; this.quiet = voiced ? 0 : this.quiet + frame.length;
    if (this.length < this.maxSamples && this.quiet < this.silenceSamples) return null;
    let segment = null;
    if (this.voice >= this.sampleRate * 0.18) {
      const samples = new Float32Array(this.length); let offset = 0;
      for (const f of this.frames) { samples.set(f, offset); offset += f.length; }
      segment = { samples, startSample: this.start, endSample: this.cursor };
    }
    this.reset(); return segment;
  }
}
export function encodeWav(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const s = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  });
  return buffer;
}
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

import { Resampler } from "./lib/audio.js";
class SubTransCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new Resampler(sampleRate, 16000); this.frame = new Float32Array(320); this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0]; if (!channels?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    for (const sample of this.resampler.push(mono)) {
      this.frame[this.offset++] = sample;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]); this.frame = new Float32Array(320); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("subtrans-capture", SubTransCapture);

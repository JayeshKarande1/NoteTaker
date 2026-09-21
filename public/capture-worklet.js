/* Average source samples into 16 kHz bins. Keeps fractional bin state across render blocks. */
class StillnoteCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.fill = 0; this.sum = 0; this.output = []; this.paused = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'pause') { this.flush(); this.paused = data.paused; }
      if (data.type === 'stop') { this.flush(); this.paused = true; this.port.postMessage({ type: 'flushed' }); }
    };
  }
  flush() {
    if (this.fill) { this.output.push(this.sum / this.fill); this.sum = 0; this.fill = 0; }
    if (this.output.length) {
      const samples = new Float32Array(this.output);
      this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
      this.output = [];
    }
  }
  process(inputs) {
    if (this.paused || !inputs[0]?.length) return true;
    const channels = inputs[0];
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.fill);
        this.sum += sample * take; this.fill += take; remaining -= take;
        if (this.fill >= this.ratio - 1e-8) {
          this.output.push(this.sum / this.ratio); this.sum = 0; this.fill = 0;
          if (this.output.length >= 1600) this.flush();
        }
      }
    }
    return true;
  }
}
registerProcessor('stillnote-capture', StillnoteCapture);

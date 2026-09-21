export const SAMPLE_RATE = 16000;

export function joinSamples(parts: Float32Array[]) {
  const result = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Silence-delimited chunks with overlap only when a long phrase must be split. */
export class Segmenter {
  private parts: Float32Array[] = [];
  private length = 0;
  private silence = 0;
  private voiced = 0;
  private overlaps = false;
  constructor(private emit: (samples: Float32Array, overlap: boolean) => void) {}
  push(samples: Float32Array) {
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const speech = Math.sqrt(energy / samples.length) > 0.008;
    this.parts.push(samples);
    this.length += samples.length;
    this.silence = speech ? 0 : this.silence + samples.length;
    if (speech) this.voiced += samples.length;
    if (this.length >= SAMPLE_RATE * 12) this.flush(true);
    else if (this.length >= SAMPLE_RATE * 2 && this.silence >= SAMPLE_RATE * 0.7) this.flush(false);
  }
  flush(overlap = false) {
    if (!this.length) return;
    const samples = joinSamples(this.parts);
    if (this.voiced >= SAMPLE_RATE * 0.2) this.emit(samples, this.overlaps);
    const tail = overlap ? samples.slice(-SAMPLE_RATE) : new Float32Array(0);
    this.parts = tail.length ? [tail] : [];
    this.length = tail.length;
    this.voiced = 0;
    this.silence = 0;
    this.overlaps = overlap;
  }
}

export function appendTranscript(previous: string, incoming: string, overlap: boolean) {
  const old = previous.trim();
  const next = incoming.trim();
  if (!old) return next;
  if (!next) return old;
  const a = old.split(/\s+/), b = next.split(/\s+/);
  let cut = 0;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
  if (overlap) {
    for (let size = Math.min(20, a.length, b.length); size >= 1; size--) {
      if (a.slice(-size).map(normalize).join(' ') === b.slice(0, size).map(normalize).join(' ')) { cut = size; break; }
    }
  }
  return [old, b.slice(cut).join(' ')].filter(Boolean).join(' ');
}

export function wavBlob(parts: Float32Array[]): Blob {
  const samples = joinSamples(parts);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
  return new Blob([buffer], { type: 'audio/wav' });
}

export class Microphone {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private flushResolve?: () => void;
  private paused = false;
  async start(onSamples: (samples: Float32Array) => void, onEnded: () => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    try {
      this.context = new AudioContext();
      const basePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
      await this.context.audioWorklet.addModule(`${basePath}capture-worklet.js`);
      await this.context.resume();
      this.node = new AudioWorkletNode(this.context, 'stillnote-capture');
      this.node.port.onmessage = ({ data }) => {
        if (data.type === 'flushed') this.flushResolve?.();
        else onSamples(data.samples);
      };
      const source = this.context.createMediaStreamSource(this.stream);
      const mute = this.context.createGain(); mute.gain.value = 0;
      source.connect(this.node).connect(mute).connect(this.context.destination);
      this.stream.getAudioTracks()[0].onended = onEnded;
    } catch (error) { await this.close(); throw error; }
  }
  setPaused(paused: boolean) { this.paused = paused; this.node?.port.postMessage({ type: 'pause', paused }); }
  async stop() {
    if (this.node && this.context?.state === 'running') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1500);
        this.flushResolve = () => { clearTimeout(timer); resolve(); };
        this.node!.port.postMessage({ type: 'stop' });
      });
    }
    await this.close();
  }
  private async close() {
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.node?.disconnect();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.node = undefined; this.context = undefined; this.stream = undefined; this.paused = false;
  }
}

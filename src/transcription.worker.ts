import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type PretrainedModelOptions } from '@huggingface/transformers';
import { MODEL_CACHE, MODEL_FILES, MODEL_REVISION, modelCached, modelPath } from './model';
import type { WorkerRequest, WorkerResponse } from './types';

const send = (message: WorkerResponse) => self.postMessage(message);
let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
const cancelled = new Set<string>();

async function prepare(download: boolean) {
  const cache = await caches.open(MODEL_CACHE);
  if (download) {
    for (let index = 0; index < MODEL_FILES.length; index++) {
      const file = MODEL_FILES[index];
      if (await cache.match(modelPath(file))) continue;
      const response = await fetch(`https://huggingface.co/onnx-community/whisper-base/resolve/${MODEL_REVISION}/${file}`, { signal: AbortSignal.timeout(300000) });
      if (!response.ok || !response.body) throw new Error('The speech model could not be downloaded. Check your connection and try again.');
      const total = Number(response.headers.get('content-length'));
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let loaded = 0;
      let lastProgress = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); loaded += value.length;
        if (Date.now() - lastProgress > 150) {
          send({ type: 'progress', progress: ((index + (total ? loaded / total : 0)) / MODEL_FILES.length) * 90, detail: `Downloading speech model · ${(loaded / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}` });
          lastProgress = Date.now();
        }
      }
      await cache.put(modelPath(file), new Response(new Blob(chunks), { headers: { 'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' } }));
    }
  }
  if (!await modelCached()) throw new Error('Offline files are missing. Connect to the internet and set up transcription again.');
  send({ type: 'progress', progress: 93, detail: 'Checking the speech model on your device…' });
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '/models/';
  env.useBrowserCache = false;
  env.useCustomCache = true;
  const basePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  env.backends.onnx.wasm!.wasmPaths = `${self.location.origin}${basePath}runtime/`;
  env.backends.onnx.wasm!.numThreads = 1;
  env.backends.onnx.wasm!.proxy = false;
  const createSpeechPipeline = pipeline as (task: 'automatic-speech-recognition', model: string, options: PretrainedModelOptions) => Promise<AutomaticSpeechRecognitionPipeline>;
  transcriber ??= await createSpeechPipeline('automatic-speech-recognition', 'whisper-base', { dtype: 'q8', device: 'wasm', local_files_only: true });
  send({ type: 'ready' });
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === 'cancel') { cancelled.add(data.sessionId); return; }
    if (data.type === 'prepare') { await prepare(data.download); return; }
    if (!transcriber) throw new Error('Set up offline transcription before recording.');
    if (cancelled.has(data.sessionId)) return;
    const result = await transcriber(data.samples, {
      language: data.language === 'hi' ? 'hindi' : 'english', task: 'transcribe',
      return_timestamps: false, max_new_tokens: 192,
    });
    if (!cancelled.has(data.sessionId)) send({ type: 'result', sessionId: data.sessionId, segmentId: data.segmentId, text: (Array.isArray(result) ? result[0] : result).text });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Transcription failed. Your saved audio is available to retry.',
      ...(data.type === 'transcribe' ? { sessionId: data.sessionId, segmentId: data.segmentId } : {}) });
  }
};

export const MODEL_REVISION = '1846881b6b3a3024392c1eea3ad983695bc23925';
export const MODEL_CACHE = `stillnote-model-${MODEL_REVISION}`;
export const MODEL_FILES = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
export const modelPath = (file: string) => `/models/whisper-base/${file}`;
export async function modelCached() {
  if (!('caches' in globalThis)) return false;
  const cache = await caches.open(MODEL_CACHE);
  return (await Promise.all(MODEL_FILES.map((file) => cache.match(modelPath(file))))).every(Boolean);
}

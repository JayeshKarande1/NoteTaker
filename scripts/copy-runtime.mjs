import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const runtime = dirname(require.resolve('onnxruntime-web'));
await mkdir('public/runtime', { recursive: true });
for (const name of await readdir(runtime)) {
  if (/^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(name)) await copyFile(join(runtime, name), join('public/runtime', name));
}

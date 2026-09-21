import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  const base = process.env.BASE_PATH || (process.env.GITHUB_ACTIONS ? '/NoteTaker/' : '/');
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'capture-worklet.js', 'runtime/*'],
        manifest: {
          name: 'Stillnote — Voice notes',
          short_name: 'Stillnote',
          description: 'Room for your thoughts. Private, offline voice notes.',
          theme_color: '#f8f9f6',
          background_color: '#f8f9f6',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,woff2,svg,png,wasm,mjs}'],
          navigateFallback: `${base}index.html`,
        },
      }),
    ],
    worker: { format: 'es' as const },
  };
});

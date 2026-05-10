import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  optimizeDeps: {
    include: ['butterchurn', 'butterchurn-presets', 'web-audio-beat-detector'],
  },
});

import { defineConfig } from 'vite';
import { resolve }      from 'path';

export default defineConfig({
  root:    'public',
  publicDir: '../assets',
  build: {
    outDir:        '../dist',
    emptyOutDir:   true,
    rollupOptions: {
      input: resolve(__dirname, 'public/index.html'),
    },
  },
  resolve: {
    alias: {
      '@audio':     resolve(__dirname, 'audio'),
      '@game':      resolve(__dirname, 'game'),
      '@input':     resolve(__dirname, 'input'),
      '@animation': resolve(__dirname, 'animation'),
      '@character': resolve(__dirname, 'character'),
      '@render':    resolve(__dirname, 'render'),
      '@ui':        resolve(__dirname, 'ui'),
    },
  },
});

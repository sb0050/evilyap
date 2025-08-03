import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    host: true, // Permet les connexions externes
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.ngrok.io',
      '.ngrok-free.app',
      '.ngrok.app',
    ],
  },
  build: {
    outDir: 'build',
  },
  css: {
    postcss: './postcss.config.js',
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // Polyfills pour les modules Node.js dans le navigateur
      buffer: 'buffer',
      process: 'process/browser',
    },
  },
  optimizeDeps: {
    include: ['buffer', 'process'],
  },
});

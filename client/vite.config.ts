/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    sourcemap: false, // [M18] never emit sourcemaps in production — prevents source disclosure
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        cookieDomainRewrite: '',
        // Rewrite Origin header so server CSRF check (Origin vs Host) passes in dev.
        // Without this, browser sends Origin: http://localhost:5173 but server sees
        // Host: localhost:3000 → "Forbidden — origin mismatch" on exempt endpoints.
        headers: { origin: 'http://localhost:3000' },
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        cookieDomainRewrite: '',
        headers: { origin: 'http://localhost:3000' },
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
      // BRIDGE: Serve old JS files from Express static (public/ dir)
      '/js': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Old CSS files (main.css, components.css, themes.css)
      '/css': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})

/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// [CFG-6] Allow dev-time override of Zeus server URL via env var. Default
// keeps existing localhost:3000 behavior so unchanged dev setups Just Work.
// Set ZEUS_SERVER_URL (e.g. http://192.168.1.50:3001 or http://localhost:8080)
// before `npm run dev` to point Vite proxy at a non-default server location.
// WS proxy converts http(s) → ws(s) automatically.
const ZEUS_SERVER_URL = process.env.ZEUS_SERVER_URL || 'http://localhost:3000'
const ZEUS_SERVER_WS = ZEUS_SERVER_URL.replace(/^http/, 'ws')

// [CFG-11 2026-05-13] Env-overridable base path. Default '/app/' preserved.
// Override doar dacă server-side static serve route is also updated să match.
// Coupling: server.js routes la `/app/*` — ambele trebuie aliniate.
const ZEUS_BASE_PATH = process.env.ZEUS_BASE_PATH || '/app/'

export default defineConfig({
  plugins: [react()],
  base: ZEUS_BASE_PATH,
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    sourcemap: false, // [M18] never emit sourcemaps in production — prevents source disclosure
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: ZEUS_SERVER_URL,
        changeOrigin: true,
        cookieDomainRewrite: '',
        // Rewrite Origin header so server CSRF check (Origin vs Host) passes in dev.
        // Without this, browser sends Origin: http://localhost:5173 but server sees
        // Host: <target host> → "Forbidden — origin mismatch" on exempt endpoints.
        headers: { origin: ZEUS_SERVER_URL },
      },
      '/auth': {
        target: ZEUS_SERVER_URL,
        changeOrigin: true,
        cookieDomainRewrite: '',
        headers: { origin: ZEUS_SERVER_URL },
      },
      '/health': {
        target: ZEUS_SERVER_URL,
        changeOrigin: true,
      },
      '/ws': {
        target: ZEUS_SERVER_WS,
        ws: true,
        changeOrigin: true,
      },
      // BRIDGE: Serve old JS files from Express static (public/ dir)
      '/js': {
        target: ZEUS_SERVER_URL,
        changeOrigin: true,
      },
      // Old CSS files (main.css, components.css, themes.css)
      '/css': {
        target: ZEUS_SERVER_URL,
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

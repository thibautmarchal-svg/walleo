import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon.ico',
        'apple-touch-icon-180x180.png',
      ],
      manifest: {
        name: 'Walleo',
        short_name: 'Walleo',
        description: 'Vos cartes de fidélité et billets, en local.',
        theme_color: '#0A0A0A',
        background_color: '#0A0A0A',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'fr',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff2}'],
        // Tesseract assets (worker, core wasm, traineddata) are too big
        // for precache and only needed when the user runs OCR. They go
        // through runtimeCaching below instead.
        globIgnores: ['**/tesseract/**'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // Defense in depth — if a future feature ever exposes /api/, the
        // SW must let those requests reach the network instead of
        // silently returning index.html for 404s.
        navigateFallbackDenylist: [/^\/api\//, /^\/tesseract\//],
        // Tesseract assets (~15 MB total) are too big to precache.
        // Runtime cache them on first OCR use so subsequent uses are
        // offline-ready.
        runtimeCaching: [
          {
            urlPattern: /^\/tesseract\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-assets',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Strip console.* and debugger statements from the production bundle
  // so OCR rawText / parser snippets / device fingerprints aren't
  // visible to anyone with DevTools access on a shared device.
  esbuild: {
    drop: ['console', 'debugger'],
  },
  server: {
    port: 5173,
    host: true,
  },
})

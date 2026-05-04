import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Hard-reload the page when a new service worker takes over. Without
// this, after a deploy the SW silently activates the new bundle but the
// in-memory JS keeps running the old code — and any old fetch URLs no
// longer allowed by the new CSP (e.g. Tesseract CDN before self-host)
// fail with NetworkError. Reloading right after the SW switch keeps
// the running code in sync with what the server is serving.
if ('serviceWorker' in navigator) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

// One-shot cleanup of the legacy `tesseract-assets` runtime cache.
// Older builds runtime-cached every /tesseract/* response with
// CacheFirst — when the SPA rewrite mistakenly returned index.html
// (200) for a missing .gz, that HTML got cached forever, and
// Tesseract kept getting served HTML where it expected a wasm /
// traineddata blob ("NetworkError: Load failed"). Drop the cache
// once on next boot so users on the old SW recover automatically.
if ('caches' in window) {
  caches.delete('tesseract-assets').catch(() => {})
}

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

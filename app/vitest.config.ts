import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Globals disabled — tests import { describe, it, expect } explicitly
    // to avoid needing "vitest/globals" in tsconfig types.
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Prevent Tesseract / pdfjs workers from hanging the suite
    testTimeout: 30_000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __BUILD_HASH__: JSON.stringify('test'),
    __BUILD_DATE__: JSON.stringify('2026-05-04'),
  },
})

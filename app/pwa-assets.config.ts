import { defineConfig } from '@vite-pwa/assets-generator/config'

/**
 * Custom preset for Walleo. Two important deviations from the default
 * `minimal2023Preset`:
 *
 *   1. apple-touch-icon padding = 0. Default 0.3 + white background was
 *      producing a thick white border around the icon on iPhone home
 *      screens. Now the icon fills the whole 180×180 square — iOS
 *      applies its own rounded mask so no double-round artifact.
 *
 *   2. maskable icon background = Walleo black. Default white showed
 *      through the safe-area padding on Android launchers that don't
 *      apply a circle mask.
 */
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: {
      sizes: [64, 192, 512],
      favicons: [[64, 'favicon.ico']],
    },
    maskable: {
      sizes: [512],
      padding: 0.3,
      resizeOptions: { background: '#0A0A0A', fit: 'contain' },
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { background: '#0A0A0A', fit: 'contain' },
    },
  },
  images: ['public/favicon.svg'],
})

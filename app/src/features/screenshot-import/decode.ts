import type { BarcodeFormat as DomainFormat } from '@/shared/db/types'

export type DecodeTechnique =
  | 'direct'
  | 'greyscale'
  | 'upscale'
  | 'invert'

export interface DecodeResult {
  format: Exclude<DomainFormat, 'NONE'>
  value: string
  technique: DecodeTechnique
}

const ZXING_TO_DOMAIN: Record<string, DecodeResult['format']> = {
  QR_CODE: 'QR',
  EAN_13: 'EAN13',
  UPC_A: 'EAN13', // 12 → 13 with leading 0 — same physical barcode
  CODE_128: 'CODE128',
  PDF_417: 'PDF417',
  AZTEC: 'AZTEC',
}

const DETECTED_BUT_UNRENDERABLE = new Set([
  'EAN_8',
  'UPC_E',
  'CODE_39',
  'DATA_MATRIX',
  'ITF',
])

/**
 * Tries to decode a barcode from an image using a stack of techniques.
 * Each technique returns a different bitmap; we run them in sequence with
 * zxing's TRY_HARDER hint until one succeeds.
 *
 * Order is intentional — direct first (cheapest), then progressively more
 * aggressive transformations.
 */
export async function decodeImageBarcode(
  source: File | Blob | HTMLImageElement,
): Promise<DecodeResult> {
  const baseImg =
    source instanceof HTMLImageElement
      ? source
      : await loadImageFromBlob(source)

  const [{ BrowserMultiFormatReader }, lib] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ])

  const hints = new Map<number, unknown>()
  hints.set(lib.DecodeHintType.TRY_HARDER, true)
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [
    lib.BarcodeFormat.QR_CODE,
    lib.BarcodeFormat.EAN_13,
    lib.BarcodeFormat.EAN_8,
    lib.BarcodeFormat.UPC_A,
    lib.BarcodeFormat.UPC_E,
    lib.BarcodeFormat.CODE_128,
    lib.BarcodeFormat.CODE_39,
    lib.BarcodeFormat.PDF_417,
    lib.BarcodeFormat.AZTEC,
    lib.BarcodeFormat.DATA_MATRIX,
    lib.BarcodeFormat.ITF,
  ])

  const reader = new BrowserMultiFormatReader(hints)

  const techniques: Array<{
    name: DecodeTechnique
    enabled: boolean
    transform: () => Promise<HTMLImageElement>
  }> = [
    { name: 'direct', enabled: true, transform: async () => baseImg },
    {
      name: 'greyscale',
      enabled: true,
      transform: async () => loadImageFromUrl(toGreyscaleContrasted(baseImg)),
    },
    {
      name: 'upscale',
      enabled:
        Math.max(baseImg.naturalWidth, baseImg.naturalHeight) < 1500,
      transform: async () => loadImageFromUrl(upscale(baseImg, 2)),
    },
    {
      name: 'invert',
      enabled: true,
      transform: async () => loadImageFromUrl(invert(baseImg)),
    },
  ]

  let unsupportedFormatError: Error | null = null

  for (const tech of techniques) {
    if (!tech.enabled) continue
    try {
      const img = await tech.transform()
      const result = await reader.decodeFromImageElement(img)
      const formatNum = result.getBarcodeFormat()
      const formatName = (lib.BarcodeFormat as unknown as Record<number, string>)[
        formatNum
      ]
      const domainFormat = formatName
        ? ZXING_TO_DOMAIN[formatName]
        : undefined

      if (!domainFormat) {
        if (formatName && DETECTED_BUT_UNRENDERABLE.has(formatName)) {
          unsupportedFormatError = new Error(
            `Format détecté (${formatName}) pas encore supporté. Saisis-le manuellement.`,
          )
          continue
        }
        continue
      }

      let value = result.getText()
      if (formatName === 'UPC_A' && value.length === 12) {
        value = '0' + value
      }

      return { format: domainFormat, value, technique: tech.name }
    } catch {
      // try next technique
    }
  }

  if (unsupportedFormatError) throw unsupportedFormatError
  throw new Error('Aucun code-barres reconnu')
}

function loadImageFromBlob(blob: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return loadImageFromUrl(url).finally(() => {
    // Image element keeps a reference to the URL via .src — but the bitmap
    // is decoded synchronously in modern browsers, so revoking right after
    // load is safe. Still, defer to next tick to be defensive on iOS Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
}

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image non chargée'))
    img.src = src
  })
}

function toGreyscaleContrasted(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas.toDataURL('image/png')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = data.data
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 0
    const g = pixels[i + 1] ?? 0
    const b = pixels[i + 2] ?? 0
    const grey = 0.299 * r + 0.587 * g + 0.114 * b
    const boosted = Math.min(255, Math.max(0, (grey - 128) * 1.7 + 128))
    pixels[i] = boosted
    pixels[i + 1] = boosted
    pixels[i + 2] = boosted
  }
  ctx.putImageData(data, 0, 0)
  return canvas.toDataURL('image/png')
}

function upscale(img: HTMLImageElement, factor: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * factor)
  canvas.height = Math.round(img.naturalHeight * factor)
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas.toDataURL('image/png')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

function invert(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas.toDataURL('image/png')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = data.data
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255 - (pixels[i] ?? 0)
    pixels[i + 1] = 255 - (pixels[i + 1] ?? 0)
    pixels[i + 2] = 255 - (pixels[i + 2] ?? 0)
  }
  ctx.putImageData(data, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Crops a file/blob to a region (in pixels relative to the natural image
 * dimensions) and returns a Blob suitable for re-feeding decodeImageBarcode.
 */
export async function cropImageRegion(
  source: File | Blob,
  region: { x: number; y: number; width: number; height: number },
): Promise<Blob> {
  const img = await loadImageFromBlob(source)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(region.width)
  canvas.height = Math.round(region.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D non disponible')
  ctx.drawImage(
    img,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Crop failed'))),
      'image/png',
    )
  })
}

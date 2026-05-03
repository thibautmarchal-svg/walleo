import type { BarcodeFormat as DomainFormat } from '@/shared/db/types'

export interface DecodeResult {
  format: Exclude<DomainFormat, 'NONE'>
  value: string
}

/**
 * Maps zxing's BarcodeFormat enum names to our domain BarcodeFormat strings.
 * zxing's enum is numeric — we reverse-lookup by index to get the name.
 */
const ZXING_TO_DOMAIN: Record<string, DecodeResult['format']> = {
  QR_CODE: 'QR',
  EAN_13: 'EAN13',
  CODE_128: 'CODE128',
  PDF_417: 'PDF417',
  AZTEC: 'AZTEC',
}

export async function decodeImageBarcode(file: File | Blob): Promise<DecodeResult> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const [{ BrowserMultiFormatReader }, lib] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ])
    const reader = new BrowserMultiFormatReader()
    const result = await reader.decodeFromImageElement(img)

    const formatNum = result.getBarcodeFormat()
    const formatName = (lib.BarcodeFormat as unknown as Record<number, string>)[formatNum]
    const domainFormat =
      formatName !== undefined ? ZXING_TO_DOMAIN[formatName] : undefined

    if (!domainFormat) {
      throw new Error(`Format non supporté (${formatName ?? 'inconnu'})`)
    }

    return { format: domainFormat, value: result.getText() }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image non chargée'))
    img.src = src
  })
}

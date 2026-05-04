/**
 * Lazy-loaded PDF parser using pdfjs-dist.
 *
 * Returns:
 *   - flat text content of all pages (fed into parseEventText)
 *   - any attachments embedded in the PDF; .pkpass blobs are flagged so
 *     they can be stored on the resulting card for Wallet re-export
 *   - per-page barcode (when fallback OCR runs): one barcode per page is
 *     decoded via zxing on the rendered canvas, since for Ticketmaster
 *     Belgium PDFs each page = one ticket
 *
 * Worker loading: we use Vite's `?url` import suffix which bundles
 * pdfjs's web-worker file as a static asset and returns its public URL.
 *
 * Fallback OCR:
 *   Some issuers (Ticketmaster Belgium e-tickets in particular) embed
 *   the ticket text as vector glyphs WITHOUT a ToUnicode mapping, so
 *   `getTextContent()` returns nothing even though the PDF is not a
 *   scan. In that case we render each page to a canvas and run
 *   Tesseract + zxing on it. Slower (5-15s per page) but reliable.
 */
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { BarcodeFormat as DomainBarcodeFormat } from '@/shared/db/types'

export interface PdfAttachment {
  filename: string
  blob: Blob
  /** True if the bytes start with the ZIP magic header — pkpass files
   *  are ZIPs, so this is a strong signal for "scannable in Wallet". */
  isPkpass: boolean
}

export interface PdfPageBarcode {
  /** 1-based page index where the barcode was found */
  pageIndex: number
  format: Exclude<DomainBarcodeFormat, 'NONE'>
  value: string
}

export interface PdfParseResult {
  text: string
  numPages: number
  attachments: PdfAttachment[]
  /** True when the text layer was empty and we fell back to render+OCR. */
  ocrUsed: boolean
  /** Set when fallback OCR ran. One barcode per page where one was decoded. */
  perPageBarcodes: PdfPageBarcode[]
}

export type PdfProgressPhase =
  | 'load'
  | 'extract-text'
  | 'render'
  | 'ocr'
  | 'barcode'

export interface PdfParseOptions {
  onProgress?: (current: number, total: number, phase: PdfProgressPhase) => void
}

let workerConfigured = false

export async function parsePdfFile(
  file: File | Blob,
  options: PdfParseOptions = {},
): Promise<PdfParseResult> {
  const { onProgress } = options

  let pdfjsLib: typeof import('pdfjs-dist')
  try {
    onProgress?.(0, 1, 'load')
    pdfjsLib = await import('pdfjs-dist')
  } catch (err) {
    console.error('[walleo] pdfjs-dist failed to load', err)
    throw new Error("Le module PDF n'a pas pu se charger.")
  }

  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    workerConfigured = true
  }

  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
  try {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    pdf = await loadingTask.promise
  } catch (err) {
    console.error('[walleo] PDF load failed', err)
    throw new Error(
      err instanceof Error
        ? `Le PDF est corrompu ou protégé : ${err.message}`
        : 'Le PDF est corrompu ou protégé.',
    )
  }

  const numPages = pdf.numPages

  // ── 1. Default text layer extraction ──
  let text = await extractTextLayer(pdf, numPages, onProgress, {})
  console.info(`[walleo] PDF text layer (default): ${text.trim().length} chars`)

  // ── 2. Retry with disableCombineTextItems if previous returned nothing ──
  //   Some PDFs (Ticketmaster Belgium specifically) lay out characters
  //   individually with custom CIDs — combining them collapses everything
  //   into empty marks. Disabling that sometimes recovers the text.
  if (text.trim().length < 50) {
    const retry = await extractTextLayer(pdf, numPages, onProgress, {
      disableCombineTextItems: true,
    })
    console.info(
      `[walleo] PDF text layer (disableCombine): ${retry.trim().length} chars`,
    )
    if (retry.trim().length > text.trim().length) text = retry
  }

  // ── 3. Try includeMarkedContent — different reader path that pulls
  //   text from PDF accessibility tags ──
  if (text.trim().length < 50) {
    const retry = await extractTextLayer(pdf, numPages, onProgress, {
      includeMarkedContent: true,
    })
    console.info(
      `[walleo] PDF text layer (markedContent): ${retry.trim().length} chars`,
    )
    if (retry.trim().length > text.trim().length) text = retry
  }

  // ── 4. Last-resort fallback: render each page + OCR + barcode ──
  let ocrUsed = false
  let perPageBarcodes: PdfPageBarcode[] = []
  if (text.trim().length < 50) {
    console.info(
      `[walleo] PDF text layer still empty (${text.trim().length} chars) — falling back to render+OCR`,
    )
    ocrUsed = true
    const fallback = await renderAndScan(pdf, numPages, onProgress)
    text = fallback.text
    perPageBarcodes = fallback.barcodes
  }

  // ── 3. Embedded attachments ──
  let attachments: PdfAttachment[] = []
  try {
    const raw = await pdf.getAttachments()
    if (raw && typeof raw === 'object') {
      attachments = Object.values(raw)
        .filter(
          (a): a is { content: Uint8Array; filename: string } =>
            a !== null &&
            typeof a === 'object' &&
            'content' in a &&
            'filename' in a,
        )
        .map((a) => {
          const u8 = a.content
          const filename = a.filename
          const isPkpass = isZipMagic(u8) && /\.pkpass$/i.test(filename)
          return {
            filename,
            blob: new Blob([new Uint8Array(u8)], {
              type: isPkpass
                ? 'application/vnd.apple.pkpass'
                : 'application/octet-stream',
            }),
            isPkpass,
          }
        })
    }
  } catch (err) {
    console.warn('[walleo] PDF getAttachments failed', err)
  }

  await pdf.destroy().catch(() => {})

  return { text, numPages, attachments, ocrUsed, perPageBarcodes }
}

interface TextLayerOptions {
  disableCombineTextItems?: boolean
  includeMarkedContent?: boolean
}

async function extractTextLayer(
  pdf: Awaited<
    ReturnType<typeof import('pdfjs-dist')['getDocument']>['promise']
  >,
  numPages: number,
  onProgress: PdfParseOptions['onProgress'],
  options: TextLayerOptions,
): Promise<string> {
  let text = ''
  for (let i = 1; i <= numPages; i++) {
    onProgress?.(i, numPages, 'extract-text')
    try {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent(options)
      const pageText = (content.items ?? [])
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
      text += pageText + '\n\n'
      page.cleanup()
    } catch (err) {
      console.warn(`[walleo] PDF page ${i} text extraction failed`, err)
    }
  }
  return text
}

const ZXING_TO_DOMAIN: Record<string, PdfPageBarcode['format']> = {
  QR_CODE: 'QR',
  EAN_13: 'EAN13',
  UPC_A: 'EAN13',
  CODE_128: 'CODE128',
  PDF_417: 'PDF417',
  AZTEC: 'AZTEC',
}

interface FallbackResult {
  text: string
  barcodes: PdfPageBarcode[]
}

async function renderAndScan(
  pdf: Awaited<
    ReturnType<typeof import('pdfjs-dist')['getDocument']>['promise']
  >,
  numPages: number,
  onProgress?: PdfParseOptions['onProgress'],
): Promise<FallbackResult> {
  // Lazy-load OCR + barcode libs
  const [{ createOcrSession }, zxingBrowser, zxingLib] = await Promise.all([
    import('@/features/ocr/extractTicketInfo'),
    import('@zxing/browser'),
    import('@zxing/library'),
  ])

  const session = await createOcrSession()

  const hints = new Map<number, unknown>()
  hints.set(zxingLib.DecodeHintType.TRY_HARDER, true)
  hints.set(zxingLib.DecodeHintType.POSSIBLE_FORMATS, [
    zxingLib.BarcodeFormat.QR_CODE,
    zxingLib.BarcodeFormat.EAN_13,
    zxingLib.BarcodeFormat.UPC_A,
    zxingLib.BarcodeFormat.CODE_128,
    zxingLib.BarcodeFormat.PDF_417,
    zxingLib.BarcodeFormat.AZTEC,
  ])
  const reader = new zxingBrowser.BrowserMultiFormatReader(hints)

  let allText = ''
  const barcodes: PdfPageBarcode[] = []

  try {
    for (let i = 1; i <= numPages; i++) {
      onProgress?.(i, numPages, 'render')
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        page.cleanup()
        continue
      }

      await page
        .render({ canvasContext: ctx, viewport, canvas })
        .promise.catch((err) => {
          console.warn(`[walleo] PDF page ${i} render failed`, err)
        })

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      )

      if (blob) {
        // OCR text
        onProgress?.(i, numPages, 'ocr')
        try {
          const info = await session.recognize(blob)
          if (info.rawText) allText += info.rawText + '\n\n'
        } catch (err) {
          console.warn(`[walleo] OCR page ${i} failed`, err)
        }

        // Barcode
        onProgress?.(i, numPages, 'barcode')
        try {
          const url = URL.createObjectURL(blob)
          try {
            const img = await loadImageFromUrl(url)
            const result = await reader.decodeFromImageElement(img)
            const formatNum = result.getBarcodeFormat()
            const formatName = (
              zxingLib.BarcodeFormat as unknown as Record<number, string>
            )[formatNum]
            const domainFormat = formatName
              ? ZXING_TO_DOMAIN[formatName]
              : undefined
            if (domainFormat) {
              let value = result.getText()
              if (formatName === 'UPC_A' && value.length === 12) {
                value = '0' + value
              }
              barcodes.push({ pageIndex: i, format: domainFormat, value })
            }
          } finally {
            setTimeout(() => URL.revokeObjectURL(url), 0)
          }
        } catch {
          // No barcode decoded on this page
        }
      }

      page.cleanup()
    }
  } finally {
    await session.terminate().catch(() => {})
  }

  return { text: allText, barcodes }
}

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image PDF non chargée'))
    img.src = src
  })
}

function isZipMagic(u8: Uint8Array): boolean {
  return (
    u8.length >= 4 &&
    u8[0] === 0x50 &&
    u8[1] === 0x4b &&
    (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07) &&
    (u8[3] === 0x04 || u8[3] === 0x06 || u8[3] === 0x08)
  )
}

/**
 * Validate a Blob (e.g. user-uploaded .pkpass file) by checking ZIP magic.
 * Used for the email-paste flow where the .pkpass arrives separately from
 * the email body text.
 */
export async function validatePkpassBlob(blob: Blob): Promise<boolean> {
  const buffer = await blob.slice(0, 4).arrayBuffer()
  const u8 = new Uint8Array(buffer)
  return isZipMagic(u8)
}

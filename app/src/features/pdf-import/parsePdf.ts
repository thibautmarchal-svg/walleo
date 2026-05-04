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

        // Barcodes — a single PDF page can contain multiple QR / barcodes
        // (festival pass sheets, group tickets). Decode in a loop, masking
        // the detected region after each success so zxing finds the next one.
        onProgress?.(i, numPages, 'barcode')
        const pageBarcodes = decodeAllBarcodesInCanvas(canvas, reader, zxingLib)
        for (const bc of pageBarcodes) {
          barcodes.push({ pageIndex: i, format: bc.format, value: bc.value })
        }
      }

      page.cleanup()
    }
  } finally {
    await session.terminate().catch(() => {})
  }

  return { text: allText, barcodes }
}

/**
 * Decode every barcode visible on the rendered canvas. Strategy:
 *   - decodeFromCanvas returns the first match
 *   - paint a white rectangle over its bounding box (computed from
 *     getResultPoints()) so the next iteration finds the next code
 *   - repeat up to 10 codes per page (safety cap)
 *   - de-dupe by value in case the same QR is detected twice through
 *     marginally different points
 */
function decodeAllBarcodesInCanvas(
  canvas: HTMLCanvasElement,
  reader: import('@zxing/browser').BrowserMultiFormatReader,
  lib: typeof import('@zxing/library'),
): Array<{ format: PdfPageBarcode['format']; value: string }> {
  const out: Array<{ format: PdfPageBarcode['format']; value: string }> = []
  const seen = new Set<string>()
  const ctx = canvas.getContext('2d')
  if (!ctx) return out

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const result = reader.decodeFromCanvas(canvas)
      if (!result) break

      const value = result.getText()
      if (seen.has(value)) {
        // Same code detected twice — masking failed, stop to avoid loop
        break
      }
      seen.add(value)

      const formatNum = result.getBarcodeFormat()
      const formatName = (
        lib.BarcodeFormat as unknown as Record<number, string>
      )[formatNum]
      const domainFormat = formatName ? ZXING_TO_DOMAIN[formatName] : undefined
      if (domainFormat) {
        let normalized = value
        if (formatName === 'UPC_A' && value.length === 12) {
          normalized = '0' + value
        }
        out.push({ format: domainFormat, value: normalized })
      }

      // Compute bbox from the result's anchor points, then white-out so
      // the next decodeFromCanvas iteration finds a different code.
      const points = result.getResultPoints?.()
      if (!points || points.length === 0) break

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of points) {
        if (!p || typeof p.getX !== 'function' || typeof p.getY !== 'function') {
          continue
        }
        const x = p.getX()
        const y = p.getY()
        if (Number.isFinite(x) && Number.isFinite(y)) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
      if (!Number.isFinite(minX) || !Number.isFinite(maxX)) break

      const padding = Math.max(40, (maxX - minX) * 0.3, (maxY - minY) * 0.3)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(
        minX - padding,
        minY - padding,
        maxX - minX + padding * 2,
        maxY - minY + padding * 2,
      )
    } catch (err) {
      // NotFoundException (no more codes), or unexpected runtime — either
      // way we have what we already decoded, stop and return it.
      const name = (err as Error & { name?: string })?.name
      if (name && name !== 'NotFoundException') {
        console.warn('[walleo] decodeAllBarcodesInCanvas inner error', err)
      }
      break
    }
  }

  return out
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

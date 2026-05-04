/**
 * Tesseract.js-based OCR for ticket photos / screenshots.
 *
 * Tesseract is sensitive to image quality. Without preprocessing, it
 * struggles on low-contrast screenshots, slightly small images, and
 * stylized fonts. Walleo's pipeline:
 *
 *   1. Preprocess: composite onto white, greyscale + contrast boost,
 *      upscale 2× when the source is < 1500 px wide. Output as PNG.
 *   2. Tesseract recognize with PSM 6 (single uniform block of text)
 *      and `preserve_interword_spaces` to keep formatting hints.
 *   3. Hand the resulting text to the shared parseEventText() so the
 *      same heuristics power both OCR-of-photos and email/PDF imports.
 *
 * The session is reused across multiple recognize() calls — Tesseract's
 * worker initialization is the slow part (~2-3s + model download), so
 * batch imports stay fast.
 */

import {
  parseEventText,
  type ParsedEvent,
  type ParsedTicket,
  type ProviderId,
} from '@/features/parser/parseEvent'

export interface ExtractedTicketInfo {
  /** Per-ticket */
  holderName?: string
  seat?: string
  /** Event-wide (only from photos that show the event metadata block) */
  eventName?: string
  eventDate?: string
  venue?: string
  organizer?: string
  provider: ProviderId
  rawText: string
  /** Tesseract-reported confidence 0-1 over the entire page */
  confidence: number
}

export interface OcrSession {
  recognize(blob: File | Blob): Promise<ExtractedTicketInfo>
  terminate(): Promise<void>
  /** Tesseract.js progress / status messages collected so far. Surfaced
   *  in the import preview when something goes wrong. */
  log: string[]
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    return (
      e.message ||
      e.name ||
      e.constructor.name ||
      Object.prototype.toString.call(e)
    )
  }
  if (e === null || e === undefined) return String(e)
  if (typeof e === 'string') return e || '<empty>'
  if (typeof e === 'object') {
    try {
      return JSON.stringify(e) || Object.prototype.toString.call(e)
    } catch {
      return Object.prototype.toString.call(e)
    }
  }
  return String(e)
}

export async function createOcrSession(): Promise<OcrSession> {
  let createWorker: typeof import('tesseract.js')['createWorker']
  let PSM: typeof import('tesseract.js')['PSM']
  try {
    const mod = await import('tesseract.js')
    createWorker = mod.createWorker
    PSM = mod.PSM
  } catch (err) {
    console.error('[walleo] tesseract.js import failed', err)
    throw new Error(`[tesseract-import] ${describeError(err)}`)
  }

  // Self-hosted assets — no external CDN. Worker, core wasm and language
  // packs are all served from <origin>/tesseract/ (copied into
  // app/public/tesseract/ at build time).
  //
  // IMPORTANT: pass FULL absolute URLs. Tesseract.js v5 spawns its
  // worker via a blob: URL; relative paths inside that blob context
  // don't resolve against the parent origin and the inner fetches
  // fail with a generic "NetworkError: Load failed".
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : ''
  const tesseractBase = `${origin}/tesseract`

  // Capture every Tesseract status / progress message so we can surface
  // them in the import preview for debugging.
  const log: string[] = []
  const tesseractLogger = (m: { status?: string; progress?: number }): void => {
    const time = new Date().toISOString().slice(11, 19)
    const status = m.status ?? '<no-status>'
    const pct =
      typeof m.progress === 'number' ? ` ${Math.round(m.progress * 100)}%` : ''
    const line = `[${time}] ${status}${pct}`
    log.push(line)
    console.log('[walleo:tesseract]', m)
  }
  // Cache it on window so Import.tsx can surface it even when the
  // session was never returned (createWorker rejected).
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __walleoTesseractLog: string[] }).__walleoTesseractLog = log
  }

  let worker: Awaited<ReturnType<typeof createWorker>>
  try {
    log.push(`[init] workerPath=${tesseractBase}/worker.min.js`)
    log.push(`[init] corePath=${tesseractBase}`)
    log.push(`[init] langPath=${tesseractBase}`)
    worker = await createWorker(['fra', 'eng'], 1, {
      workerPath: `${tesseractBase}/worker.min.js`,
      corePath: tesseractBase,
      langPath: tesseractBase,
      gzip: false,
      logger: tesseractLogger,
    })
  } catch (err) {
    console.error('[walleo] Tesseract createWorker failed', err)
    log.push(`[error] ${describeError(err)}`)
    throw new Error(`[tesseract-worker] ${describeError(err)}`)
  }

  // PSM 6 = "Assume a single uniform block of text" — the right mode for
  // ticket photos (most of the surface is text, no columns to separate).
  // preserve_interword_spaces helps keep "Bloc A12 Rang 14 Place 22"
  // from collapsing into a single token.
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })
  } catch (err) {
    console.error('[walleo] Tesseract setParameters failed', err)
    throw new Error(`[tesseract-params] ${describeError(err)}`)
  }

  return {
    async recognize(blob) {
      const preprocessed = await preprocessForOcr(blob)
      const { data } = await worker.recognize(preprocessed)
      const text = data.text ?? ''
      const parsed = parseEventText(text)
      const ticket = parsed.tickets[0]
      return {
        holderName: ticket?.holderName,
        seat: ticket?.seat,
        eventName: parsed.event.name,
        eventDate: parsed.event.date,
        venue: parsed.event.venue,
        organizer: parsed.event.organizer,
        provider: parsed.provider,
        rawText: text,
        confidence:
          typeof data.confidence === 'number' ? data.confidence / 100 : 0,
      }
    },
    async terminate() {
      await worker.terminate()
    },
    log,
  }
}

/** Re-exported for callers that want to apply the same heuristics on the
 *  raw text without re-running OCR. */
export { parseEventText }
export type { ParsedEvent, ParsedTicket, ProviderId }

// ───────────────────────── Image preprocessing ─────────────────────────

/**
 * Returns a PNG Blob optimized for OCR:
 *   - Composited onto opaque white (in case of transparent screenshots)
 *   - Greyscaled
 *   - Contrast boosted around 128
 *   - Upscaled 2× when the source is small
 */
async function preprocessForOcr(source: File | Blob): Promise<Blob> {
  const img = await loadImage(source)
  const maxSide = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = maxSide < 1500 ? 2 : 1

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    // Fallback: return source as-is
    return source instanceof Blob ? source : new Blob([source])
  }

  // Composite onto white so transparent regions become white instead of
  // black (which Tesseract reads as "ink").
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] ?? 0
    const g = px[i + 1] ?? 0
    const b = px[i + 2] ?? 0
    const grey = 0.299 * r + 0.587 * g + 0.114 * b
    // Contrast boost centered around 128
    const boosted = Math.min(255, Math.max(0, (grey - 128) * 1.5 + 128))
    px[i] = boosted
    px[i + 1] = boosted
    px[i + 2] = boosted
    // alpha unchanged
  }
  ctx.putImageData(data, 0, 0)

  return await new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (b) =>
        resolve(b ?? (source instanceof Blob ? source : new Blob([source]))),
      'image/png',
    )
  })
}

function loadImage(source: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source)
    const img = new Image()
    img.onload = () => {
      // Defer revoke so the image bitmap is committed
      setTimeout(() => URL.revokeObjectURL(url), 0)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image OCR non chargée'))
    }
    img.src = url
  })
}

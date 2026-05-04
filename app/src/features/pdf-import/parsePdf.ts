/**
 * Lazy-loaded PDF parser using pdfjs-dist.
 *
 * Returns:
 *   - flat text content of all pages (used by parseEventText)
 *   - any attachments embedded in the PDF; .pkpass blobs are flagged so
 *     they can be stored on the resulting card for Wallet re-export.
 *
 * Worker loading: we use Vite's `?url` import suffix which bundles
 * pdfjs's web-worker file as a static asset and returns its public URL.
 * That's more reliable than `new URL(..., import.meta.url)` which can
 * fail to resolve correctly when the path lives in node_modules.
 */
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export interface PdfAttachment {
  filename: string
  blob: Blob
  /** True if the bytes start with the ZIP magic header — pkpass files
   *  are ZIPs, so this is a strong signal for "scannable in Wallet". */
  isPkpass: boolean
}

export interface PdfParseResult {
  text: string
  numPages: number
  attachments: PdfAttachment[]
}

let workerConfigured = false

export async function parsePdfFile(file: File | Blob): Promise<PdfParseResult> {
  let pdfjsLib: typeof import('pdfjs-dist')
  try {
    pdfjsLib = await import('pdfjs-dist')
  } catch (err) {
    console.error('[walleo] pdfjs-dist failed to load', err)
    throw new Error('Le module PDF n\'a pas pu se charger.')
  }

  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    workerConfigured = true
  }

  let pdf: Awaited<
    ReturnType<typeof pdfjsLib.getDocument>['promise']
  >
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

  // Capture numPages NOW — accessing it after destroy() can throw on
  // some pdfjs versions.
  const numPages = pdf.numPages

  // Text extraction
  let text = ''
  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = (content.items ?? [])
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
      text += pageText + '\n\n'
      page.cleanup()
    } catch (err) {
      console.warn(`[walleo] PDF page ${i} extraction failed`, err)
    }
  }

  // Attachments
  let attachments: PdfAttachment[] = []
  try {
    const raw = await pdf.getAttachments()
    if (raw && typeof raw === 'object') {
      attachments = Object.values(raw)
        .filter((a): a is { content: Uint8Array; filename: string } =>
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

  return { text, numPages, attachments }
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

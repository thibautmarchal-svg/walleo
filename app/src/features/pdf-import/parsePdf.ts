/**
 * Lazy-loaded PDF parser using pdfjs-dist.
 *
 * Returns:
 *   - flat text content of all pages (used by parseEventText)
 *   - any attachments embedded in the PDF; .pkpass blobs are flagged so
 *     they can be stored on the resulting card for Wallet re-export.
 *
 * pdfjs-dist needs a Web Worker. Vite + the
 * `new URL('...', import.meta.url)` pattern bundles the worker as a
 * static asset and gives us a stable URL.
 */

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
  const pdfjsLib = await import('pdfjs-dist')

  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href
    workerConfigured = true
  }

  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise

  // Text extraction
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
    text += pageText + '\n\n'
    page.cleanup()
  }

  // Attachments
  let attachments: PdfAttachment[] = []
  try {
    const raw = await pdf.getAttachments()
    if (raw && typeof raw === 'object') {
      attachments = Object.values(raw).map((a) => {
        const u8 = (a as { content: Uint8Array }).content
        const filename = (a as { filename: string }).filename
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
  } catch {
    // Some PDFs error on getAttachments — degrade silently.
  }

  await pdf.destroy()

  return { text, numPages: pdf.numPages, attachments }
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

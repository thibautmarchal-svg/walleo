/**
 * Re-serve an already-signed .pkpass blob to Apple Wallet.
 *
 * Walleo never signs passes itself — we only forward what the issuer
 * (Ticketmaster, FNAC, SNCF, Air France…) sent in the original email or
 * PDF. The trick is two-fold:
 *
 *   1. The Blob's Content-Type must be exactly
 *      `application/vnd.apple.pkpass` for iOS Safari to recognize it.
 *   2. On iOS, the anchor must NOT carry a `download` attribute — Safari
 *      then reads the MIME type and shows the native "Add to Wallet"
 *      sheet. With `download` set, Safari drops the file into Files
 *      instead and Wallet integration never triggers.
 *
 * On macOS / desktop browsers we fall back to a regular download.
 */

export interface PkpassExportResult {
  ok: boolean
  message?: string
}

const PKPASS_MIME = 'application/vnd.apple.pkpass'

export async function exportPkpassToWallet(
  blob: Blob,
  filename = 'walleo-pass.pkpass',
): Promise<PkpassExportResult> {
  if (!blob || !(blob instanceof Blob) || blob.size === 0) {
    return { ok: false, message: 'Fichier .pkpass introuvable ou vide.' }
  }

  const proper =
    blob.type === PKPASS_MIME
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: PKPASS_MIME })

  const url = URL.createObjectURL(proper)
  try {
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener'

    if (!isAppleMobile()) {
      // Desktop / Android: classic download — let the OS associate the
      // file extension with whichever app handles it (Wallet on iCloud
      // Mac, nothing meaningful elsewhere).
      a.download = filename
    }

    document.body.appendChild(a)
    a.click()
    a.remove()

    // Hold the object URL long enough for Safari to parse the blob.
    setTimeout(() => URL.revokeObjectURL(url), 4000)

    return { ok: true }
  } catch (err) {
    URL.revokeObjectURL(url)
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Échec de l'export.",
    }
  }
}

/** Detects iOS / iPadOS Safari (iPadOS 13+ reports a desktop UA, hence
 *  the touch sniff). */
function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ on iPad Pro pretends to be MacIntel
  if (
    /Mac/.test(ua) &&
    typeof document !== 'undefined' &&
    'ontouchend' in document
  ) {
    return true
  }
  return false
}

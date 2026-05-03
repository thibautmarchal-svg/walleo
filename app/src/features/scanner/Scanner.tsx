import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, X } from 'lucide-react'
import type { BarcodeFormat as DomainFormat } from '@/shared/db/types'

const ZXING_TO_DOMAIN: Record<string, Exclude<DomainFormat, 'NONE'>> = {
  QR_CODE: 'QR',
  EAN_13: 'EAN13',
  UPC_A: 'EAN13',
  CODE_128: 'CODE128',
  PDF_417: 'PDF417',
  AZTEC: 'AZTEC',
}

interface ScannerControls {
  stop(): void
}

export function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let controls: ScannerControls | null = null
    let cancelled = false

    const start = async (): Promise<void> => {
      try {
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
        const videoEl = videoRef.current
        if (!videoEl || cancelled) return

        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoEl,
          (result, _err, ctrls) => {
            if (cancelled || !result) return

            const formatNum = result.getBarcodeFormat()
            const formatName = (
              lib.BarcodeFormat as unknown as Record<number, string>
            )[formatNum]
            const domainFormat = formatName
              ? ZXING_TO_DOMAIN[formatName]
              : undefined

            if (!domainFormat) {
              // Unsupported format — keep scanning
              return
            }

            ctrls.stop()
            controls = null

            // Haptic feedback (Android Chrome; no-op on iOS Safari)
            if ('vibrate' in navigator) {
              try {
                navigator.vibrate(120)
              } catch {
                // ignore
              }
            }

            let value = result.getText()
            if (formatName === 'UPC_A' && value.length === 12) {
              value = '0' + value
            }

            navigate('/add', {
              replace: true,
              state: {
                initialBarcode: {
                  format: domainFormat,
                  value,
                  source: 'camera' as const,
                },
              },
            })
          },
        )
        if (cancelled) {
          controls?.stop()
          controls = null
          return
        }
        setReady(true)
      } catch (err) {
        if (cancelled) return
        const name = (err as Error & { name?: string }).name
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError(
            'Accès à la caméra refusé. Autorise-le dans les réglages Safari pour scanner.',
          )
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setError('Aucune caméra disponible sur cet appareil.')
        } else if (name === 'NotReadableError') {
          setError('La caméra est utilisée par une autre app.')
        } else {
          setError(err instanceof Error ? err.message : 'Erreur caméra.')
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [navigate])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header className="flex items-center justify-between px-4 py-3 text-white">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Annuler"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-semibold">Scanner un code</h1>
        <div className="h-9 w-9" />
      </header>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
        />

        {/* Targeting frame */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-64 w-64 max-w-[80vw]">
            <div className="absolute inset-0 rounded-3xl border-2 border-walleo-yellow/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            {/* Corners */}
            <Corner className="-left-px -top-px border-l-4 border-t-4 rounded-tl-3xl" />
            <Corner className="-right-px -top-px border-r-4 border-t-4 rounded-tr-3xl" />
            <Corner className="-left-px -bottom-px border-l-4 border-b-4 rounded-bl-3xl" />
            <Corner className="-right-px -bottom-px border-r-4 border-b-4 rounded-br-3xl" />
          </div>
        </div>

        {!ready && !error && (
          <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-2 text-white/80">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-xs">Activation de la caméra…</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-6 bottom-24 rounded-2xl bg-white/10 p-4 text-center text-sm text-white backdrop-blur-md">
            {error}
          </div>
        )}
      </div>

      <footer className="px-6 pb-3 text-center text-xs text-white/70">
        Centre le code-barres dans le cadre. Walleo détecte automatiquement.
      </footer>
    </div>
  )
}

function Corner({ className }: { className: string }) {
  return (
    <span
      className={`absolute h-7 w-7 border-walleo-yellow ${className}`}
      aria-hidden
    />
  )
}

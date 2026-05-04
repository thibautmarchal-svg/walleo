import { useEffect, useRef, useState } from 'react'
import bwipjs from 'bwip-js/browser'
import type { BarcodeFormat } from '@/shared/db/types'

interface BarcodeProps {
  format: BarcodeFormat
  value: string
  className?: string
}

interface BwipOptions {
  bcid: string
  text: string
  scale: number
  height?: number
  includetext?: boolean
  textxalign?: 'center'
  backgroundcolor: string
  paddingwidth: number
  paddingheight: number
}

function getOptions(format: BarcodeFormat, value: string): BwipOptions | null {
  if (format === 'NONE') return null
  const base = {
    text: value,
    backgroundcolor: 'FFFFFF',
    paddingwidth: 8,
    paddingheight: 8,
  }
  switch (format) {
    case 'QR':
      return { ...base, bcid: 'qrcode', scale: 6 }
    case 'AZTEC':
      return { ...base, bcid: 'azteccode', scale: 6 }
    case 'EAN13':
      return {
        ...base,
        bcid: 'ean13',
        scale: 3,
        height: 22,
        // No inline digits — the caller renders the value below for a
        // cleaner, more readable barcode image.
        includetext: false,
      }
    case 'CODE128':
      return {
        ...base,
        bcid: 'code128',
        scale: 3,
        height: 22,
        includetext: false,
      }
    case 'PDF417':
      return { ...base, bcid: 'pdf417', scale: 3, height: 8 }
  }
}

export function Barcode({ format, value, className }: BarcodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const opts = getOptions(format, value)
    if (!opts) return
    try {
      bwipjs.toCanvas(canvasRef.current, opts)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [format, value])

  if (format === 'NONE') {
    return (
      <div className={className}>
        <p className="text-sm text-muted-foreground">
          Cette carte n'a pas de code-barres.
        </p>
      </div>
    )
  }

  return (
    <div className={className}>
      <canvas ref={canvasRef} className="mx-auto block h-auto max-w-full bg-white" />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

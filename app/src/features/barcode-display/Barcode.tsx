import { useEffect, useRef } from 'react'
import bwipjs from 'bwip-js/browser'
import type { BarcodeFormat } from '@/shared/db/types'

interface BarcodeProps {
  format: BarcodeFormat
  value: string
  scale?: number
  height?: number
  className?: string
}

const FORMAT_TO_BCID: Record<Exclude<BarcodeFormat, 'NONE'>, string> = {
  QR: 'qrcode',
  EAN13: 'ean13',
  CODE128: 'code128',
  PDF417: 'pdf417',
  AZTEC: 'azteccode',
}

export function Barcode({
  format,
  value,
  scale = 4,
  height = 20,
  className,
}: BarcodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (format === 'NONE' || !canvasRef.current) return
    const canvas = canvasRef.current
    const errorEl = errorRef.current
    try {
      bwipjs.toCanvas(canvas, {
        bcid: FORMAT_TO_BCID[format],
        text: value,
        scale,
        height,
        includetext: format === 'EAN13' || format === 'CODE128',
        textxalign: 'center',
        backgroundcolor: 'FFFFFF',
        paddingwidth: 8,
        paddingheight: 8,
      })
      if (errorEl) errorEl.textContent = ''
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (errorEl) errorEl.textContent = message
    }
  }, [format, value, scale, height])

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
      <canvas ref={canvasRef} className="max-w-full h-auto bg-white rounded" />
      <div ref={errorRef} className="text-xs text-destructive mt-2" />
    </div>
  )
}

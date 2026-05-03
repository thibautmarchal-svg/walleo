import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'

interface CropRegion {
  x: number
  y: number
  width: number
  height: number
}

interface ImageCropperProps {
  imageUrl: string
  onCancel: () => void
  /** Region is given in NATURAL image pixels, ready for cropImageRegion(). */
  onConfirm: (region: CropRegion) => void
}

/**
 * Lightweight touch + mouse-friendly crop tool.
 * Drag to draw a rectangle over the displayed image, then "Détecter ici".
 * Coordinates are normalized to the displayed size, then scaled back to
 * natural image dimensions on confirm.
 */
export function ImageCropper({
  imageUrl,
  onCancel,
  onConfirm,
}: ImageCropperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(
    null,
  )
  const [displayedSize, setDisplayedSize] = useState<{
    w: number
    h: number
  } | null>(null)
  const [drag, setDrag] = useState<{
    startX: number
    startY: number
    endX: number
    endY: number
    active: boolean
  } | null>(null)

  useEffect(() => {
    const onResize = (): void => {
      if (!imgRef.current) return
      setDisplayedSize({
        w: imgRef.current.clientWidth,
        h: imgRef.current.clientHeight,
      })
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [naturalSize])

  const onImageLoad = (): void => {
    if (!imgRef.current) return
    setNaturalSize({
      w: imgRef.current.naturalWidth,
      h: imgRef.current.naturalHeight,
    })
    setDisplayedSize({
      w: imgRef.current.clientWidth,
      h: imgRef.current.clientHeight,
    })
  }

  const getRelativeXY = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    if (!imgRef.current) return null
    const rect = imgRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, clientY - rect.top)),
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const point = getRelativeXY(e.clientX, e.clientY)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
      active: true,
    })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag?.active) return
    const point = getRelativeXY(e.clientX, e.clientY)
    if (!point) return
    setDrag({ ...drag, endX: point.x, endY: point.y })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDrag({ ...drag, active: false })
  }

  const rect =
    drag !== null
      ? {
          left: Math.min(drag.startX, drag.endX),
          top: Math.min(drag.startY, drag.endY),
          width: Math.abs(drag.endX - drag.startX),
          height: Math.abs(drag.endY - drag.startY),
        }
      : null

  const canConfirm =
    rect !== null &&
    rect.width > 16 &&
    rect.height > 16 &&
    naturalSize !== null &&
    displayedSize !== null

  const onConfirmClick = (): void => {
    if (!canConfirm || !rect || !naturalSize || !displayedSize) return
    const scaleX = naturalSize.w / displayedSize.w
    const scaleY = naturalSize.h / displayedSize.h
    onConfirm({
      x: rect.left * scaleX,
      y: rect.top * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header className="flex items-center justify-between px-4 py-3 text-white">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Annuler"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-sm font-semibold">Sélectionne le code-barres</h2>
        <button
          type="button"
          onClick={onConfirmClick}
          disabled={!canConfirm}
          aria-label="Détecter dans la zone"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-walleo-yellow text-walleo-black transition active:scale-95 disabled:opacity-30"
        >
          <Check className="h-5 w-5" strokeWidth={3} />
        </button>
      </header>

      <div
        ref={containerRef}
        className="relative flex flex-1 select-none items-center justify-center overflow-hidden px-4"
        style={{ touchAction: 'none' }}
      >
        <div
          className="relative inline-block max-h-full max-w-full"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            onLoad={onImageLoad}
            draggable={false}
            className="max-h-[70vh] max-w-full select-none object-contain"
          />
          {rect && (
            <div
              className="pointer-events-none absolute border-2 border-walleo-yellow bg-walleo-yellow/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            />
          )}
        </div>
      </div>

      <p className="px-6 pb-3 text-center text-xs text-white/70">
        Touche et fais glisser pour entourer le code-barres.
      </p>
    </div>
  )
}

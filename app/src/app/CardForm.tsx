import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Crop, ImagePlus, Loader2 } from 'lucide-react'
import { useCardsStore } from '@/features/cards/store'
import {
  cropImageRegion,
  decodeImageBarcode,
} from '@/features/screenshot-import/decode'
import { ImageCropper } from '@/features/screenshot-import/ImageCropper'
import type {
  BarcodeFormat,
  Card,
  CardSource,
  CardType,
} from '@/shared/db/types'

const BARCODE_FORMATS: BarcodeFormat[] = [
  'QR',
  'EAN13',
  'CODE128',
  'PDF417',
  'AZTEC',
  'NONE',
]

const PRESET_COLORS = [
  '#0E4A8A',
  '#0082C3',
  '#E8B71D',
  '#7C3AED',
  '#0F172A',
  '#EF4444',
  '#16A34A',
  '#FFD60A',
]

type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; format: BarcodeFormat }
  | { kind: 'error'; message: string }

interface CardFormProps {
  mode: 'add' | 'edit'
}

function isoToLocalDatetime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export function CardForm({ mode }: CardFormProps) {
  const navigate = useNavigate()
  const params = useParams<{ id: string }>()
  const editingId = mode === 'edit' ? params.id : undefined
  const existing = useCardsStore((s) =>
    editingId ? s.cards.find((c) => c.id === editingId) : undefined,
  )
  const add = useCardsStore((s) => s.add)
  const update = useCardsStore((s) => s.update)
  const loading = useCardsStore((s) => s.loading)

  const [type, setType] = useState<CardType>(existing?.type ?? 'loyalty')
  const [name, setName] = useState(existing?.name ?? '')
  const [brandColor, setBrandColor] = useState(
    existing?.brandColor ?? PRESET_COLORS[0]!,
  )
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormat>(
    existing?.barcodeFormat ?? 'QR',
  )
  const [barcodeValue, setBarcodeValue] = useState(existing?.barcodeValue ?? '')
  const [memberNumber, setMemberNumber] = useState(existing?.memberNumber ?? '')
  const [eventDate, setEventDate] = useState(
    existing?.eventDate ? isoToLocalDatetime(existing.eventDate) : '',
  )
  const [venue, setVenue] = useState(existing?.venue ?? '')
  const [seat, setSeat] = useState(existing?.seat ?? '')
  const [organizer, setOrganizer] = useState(existing?.organizer ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [importStatus, setImportStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [importSource, setImportSource] = useState<CardSource>(
    existing?.source ?? 'manual',
  )
  const [cropSource, setCropSource] = useState<{
    file: File | Blob
    objectUrl: string
  } | null>(null)
  const [cropperOpen, setCropperOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (cropSource) URL.revokeObjectURL(cropSource.objectUrl)
    }
  }, [cropSource])

  // Re-hydrate fields if the card finally loads after the store finishes loadAll()
  useEffect(() => {
    if (mode !== 'edit' || !existing) return
    setType(existing.type)
    setName(existing.name)
    setBrandColor(existing.brandColor)
    setBarcodeFormat(existing.barcodeFormat)
    setBarcodeValue(existing.barcodeValue)
    setMemberNumber(existing.memberNumber ?? '')
    setEventDate(
      existing.eventDate ? isoToLocalDatetime(existing.eventDate) : '',
    )
    setVenue(existing.venue ?? '')
    setSeat(existing.seat ?? '')
    setOrganizer(existing.organizer ?? '')
    setImportSource(existing.source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existing?.id])

  const tryDecode = async (
    blob: File | Blob,
    source: CardSource,
  ): Promise<boolean> => {
    setImportStatus({ kind: 'loading' })
    try {
      const result = await decodeImageBarcode(blob)
      setBarcodeFormat(result.format)
      setBarcodeValue(result.value)
      setImportSource(source)
      setImportStatus({ kind: 'success', format: result.format })
      return true
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Aucun code détecté'
      setImportStatus({ kind: 'error', message: reason })
      return false
    }
  }

  const handleImageFile = async (
    file: File,
    fromPaste: boolean,
  ): Promise<void> => {
    const source: CardSource = fromPaste ? 'screenshot' : 'photo-ocr'
    const ok = await tryDecode(file, source)
    if (!ok) {
      // Keep the image around so the user can manually crop & retry.
      const objectUrl = URL.createObjectURL(file)
      setCropSource((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl)
        return { file, objectUrl }
      })
    }
  }

  const handleCropConfirm = async (region: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void> => {
    if (!cropSource) return
    try {
      const cropped = await cropImageRegion(cropSource.file, region)
      const ok = await tryDecode(cropped, importSource)
      if (ok) {
        setCropperOpen(false)
        URL.revokeObjectURL(cropSource.objectUrl)
        setCropSource(null)
      }
    } catch (err) {
      setImportStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Échec du recadrage.',
      })
    }
  }

  const handleCropCancel = (): void => {
    setCropperOpen(false)
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            void handleImageFile(file, true)
          }
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) void handleImageFile(file, false)
    e.target.value = ''
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const payload = {
        type,
        name: name.trim(),
        brandColor,
        barcodeFormat,
        barcodeValue: barcodeValue.trim(),
        source: importSource,
        memberNumber:
          type === 'loyalty' && memberNumber.trim()
            ? memberNumber.trim()
            : undefined,
        eventDate:
          type === 'event' && eventDate
            ? new Date(eventDate).toISOString()
            : undefined,
        venue: type === 'event' && venue.trim() ? venue.trim() : undefined,
        seat: type === 'event' && seat.trim() ? seat.trim() : undefined,
        organizer:
          type === 'event' && organizer.trim() ? organizer.trim() : undefined,
      } satisfies Partial<Card>

      if (mode === 'edit' && editingId) {
        await update(editingId, payload)
        navigate(`/card/${editingId}`, { replace: true })
      } else {
        const card = await add({
          type: payload.type,
          name: payload.name,
          brandColor: payload.brandColor,
          barcodeFormat: payload.barcodeFormat,
          barcodeValue: payload.barcodeValue,
          source: payload.source,
          ...(payload.memberNumber ? { memberNumber: payload.memberNumber } : {}),
          ...(payload.eventDate ? { eventDate: payload.eventDate } : {}),
          ...(payload.venue ? { venue: payload.venue } : {}),
          ...(payload.seat ? { seat: payload.seat } : {}),
          ...(payload.organizer ? { organizer: payload.organizer } : {}),
        })
        navigate(`/card/${card.id}`, { replace: true })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    name.trim().length > 0 &&
    (barcodeFormat === 'NONE' || barcodeValue.trim().length > 0)

  if (mode === 'edit' && !loading && !existing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Carte introuvable.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-full bg-secondary px-4 py-2 text-sm"
        >
          Retour au dashboard
        </button>
      </div>
    )
  }

  return (
    <>
      {cropperOpen && cropSource && (
        <ImageCropper
          imageUrl={cropSource.objectUrl}
          onCancel={handleCropCancel}
          onConfirm={handleCropConfirm}
        />
      )}
      <div className="min-h-full bg-background">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold">
          {mode === 'edit' ? 'Modifier la carte' : 'Nouvelle carte'}
        </h1>
      </header>

      <form
        onSubmit={onSubmit}
        className="space-y-5 px-5 py-6"
        style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}
      >
        <div className="rounded-2xl border border-dashed border-border bg-secondary/40 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-walleo-yellow/15 p-2 text-walleo-yellow">
              <ImagePlus className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Importer un code-barres</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Colle (Cmd+V) un screenshot ou choisis une image depuis ton
                téléphone.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importStatus.kind === 'loading'}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-walleo-yellow px-4 py-2 text-xs font-semibold text-walleo-black transition active:scale-95 disabled:opacity-50"
              >
                {importStatus.kind === 'loading' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Détection…
                  </>
                ) : (
                  <>Choisir une image</>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onFilePicked}
              />
              {importStatus.kind === 'success' && (
                <p className="mt-2 text-xs text-walleo-yellow">
                  Code détecté ({importStatus.format}). Vérifie les autres
                  champs avant de sauvegarder.
                </p>
              )}
              {importStatus.kind === 'error' && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-destructive">
                    {importStatus.message}
                  </p>
                  {cropSource && (
                    <button
                      type="button"
                      onClick={() => setCropperOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium transition active:scale-95"
                    >
                      <Crop className="h-3.5 w-3.5" />
                      Recadrer manuellement
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <Field label="Type">
          <div className="grid grid-cols-2 gap-2">
            {(['loyalty', 'event'] as CardType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`rounded-xl border px-3 py-3 text-sm font-medium transition ${
                  type === t
                    ? 'border-walleo-yellow bg-walleo-yellow/10 text-walleo-yellow'
                    : 'border-border bg-secondary text-secondary-foreground'
                }`}
              >
                {t === 'loyalty' ? 'Carte de fidélité' : 'Billet / Événement'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Nom">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={type === 'loyalty' ? 'Carrefour' : 'Coldplay au Stade…'}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
          />
        </Field>

        <Field label="Couleur">
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setBrandColor(c)}
                aria-label={`Couleur ${c}`}
                className={`h-9 w-9 rounded-full border-2 transition ${
                  brandColor === c ? 'border-walleo-yellow' : 'border-transparent'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>

        <Field label="Format du code">
          <select
            value={barcodeFormat}
            onChange={(e) => setBarcodeFormat(e.target.value as BarcodeFormat)}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
          >
            {BARCODE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f === 'NONE' ? 'Aucun' : f}
              </option>
            ))}
          </select>
        </Field>

        {barcodeFormat !== 'NONE' && (
          <Field label="Valeur du code">
            <input
              value={barcodeValue}
              onChange={(e) => setBarcodeValue(e.target.value)}
              required
              placeholder="0123456789012"
              className="w-full rounded-xl border border-border bg-secondary px-4 py-3 font-mono text-base outline-none focus:border-walleo-yellow"
            />
          </Field>
        )}

        {type === 'loyalty' && (
          <Field label="N° de membre (lisible)">
            <input
              value={memberNumber}
              onChange={(e) => setMemberNumber(e.target.value)}
              placeholder="0123 4567 8901"
              className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
            />
          </Field>
        )}

        {type === 'event' && (
          <>
            <Field label="Date & heure">
              <input
                type="datetime-local"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
              />
            </Field>
            <Field label="Lieu">
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Stade de France, Saint-Denis"
                className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
              />
            </Field>
            <Field label="Place">
              <input
                value={seat}
                onChange={(e) => setSeat(e.target.value)}
                placeholder="Bloc A12 — Rang 14 — Siège 22"
                className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
              />
            </Field>
            <Field label="Émetteur">
              <input
                value={organizer}
                onChange={(e) => setOrganizer(e.target.value)}
                placeholder="Ticketmaster"
                className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
              />
            </Field>
          </>
        )}

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
          className="fixed left-5 right-5 flex h-12 items-center justify-center rounded-full bg-walleo-yellow text-base font-semibold text-walleo-black shadow-2xl shadow-walleo-yellow/30 transition active:scale-95 disabled:opacity-40"
        >
          {submitting
            ? 'Enregistrement…'
            : mode === 'edit'
              ? 'Enregistrer les modifications'
              : 'Enregistrer la carte'}
        </button>
      </form>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

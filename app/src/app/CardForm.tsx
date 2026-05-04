import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Crop,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { useCardsStore } from '@/features/cards/store'
import {
  cropImageRegion,
  decodeImageBarcode,
} from '@/features/screenshot-import/decode'
import { ImageCropper } from '@/features/screenshot-import/ImageCropper'
import {
  createOcrSession,
  type ExtractedTicketInfo,
} from '@/features/ocr/extractTicketInfo'
import type {
  BarcodeFormat,
  CardSource,
  CardType,
  Ticket,
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
  | { kind: 'batch-decode'; current: number; total: number }
  | { kind: 'batch-ocr'; current: number; total: number }
  | { kind: 'success'; message: string }
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

function makeEmptyTicket(): Ticket {
  return { id: nanoid(), barcodeFormat: 'QR', barcodeValue: '' }
}

interface InitialBarcodeState {
  initialBarcode?: {
    format: BarcodeFormat
    value: string
    source?: CardSource
  }
  prefill?: {
    type?: CardType
    name?: string
    eventDate?: string
    venue?: string
    organizer?: string
    tickets?: Ticket[]
    source?: CardSource
  }
}

export function CardForm({ mode }: CardFormProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as InitialBarcodeState | null
  const initialBarcode = locationState?.initialBarcode
  const prefill = locationState?.prefill
  const params = useParams<{ id: string }>()
  const editingId = mode === 'edit' ? params.id : undefined
  const existing = useCardsStore((s) =>
    editingId ? s.cards.find((c) => c.id === editingId) : undefined,
  )
  const add = useCardsStore((s) => s.add)
  const update = useCardsStore((s) => s.update)
  const loading = useCardsStore((s) => s.loading)

  const initialTickets = useMemo<Ticket[]>(() => {
    if (existing) {
      if (existing.tickets && existing.tickets.length > 0)
        return existing.tickets
      if (existing.type === 'event' && existing.barcodeValue) {
        return [
          {
            id: nanoid(),
            barcodeFormat: existing.barcodeFormat,
            barcodeValue: existing.barcodeValue,
            seat: existing.seat,
          },
        ]
      }
      return []
    }
    // New card from /import (email/PDF parser) — full ticket list
    if (prefill?.tickets && prefill.tickets.length > 0) {
      return prefill.tickets
    }
    // New card from scanner — pre-seed a ticket so event mode works too
    if (initialBarcode) {
      return [
        {
          id: nanoid(),
          barcodeFormat: initialBarcode.format,
          barcodeValue: initialBarcode.value,
        },
      ]
    }
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id])

  const [type, setType] = useState<CardType>(
    existing?.type ?? prefill?.type ?? 'loyalty',
  )
  const [name, setName] = useState(existing?.name ?? prefill?.name ?? '')
  const [brandColor, setBrandColor] = useState(
    existing?.brandColor ?? PRESET_COLORS[0]!,
  )
  // Loyalty-only barcode fields
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormat>(
    existing?.barcodeFormat ?? initialBarcode?.format ?? 'QR',
  )
  const [barcodeValue, setBarcodeValue] = useState(
    existing?.barcodeValue ?? initialBarcode?.value ?? '',
  )
  const [memberNumber, setMemberNumber] = useState(existing?.memberNumber ?? '')
  // Event fields
  const [eventDate, setEventDate] = useState(
    existing?.eventDate
      ? isoToLocalDatetime(existing.eventDate)
      : prefill?.eventDate ?? '',
  )
  const [venue, setVenue] = useState(existing?.venue ?? prefill?.venue ?? '')
  const [organizer, setOrganizer] = useState(
    existing?.organizer ?? prefill?.organizer ?? '',
  )
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)

  const [submitting, setSubmitting] = useState(false)
  const [importStatus, setImportStatus] = useState<ImportStatus>(
    initialBarcode
      ? { kind: 'success', message: `Code détecté (${initialBarcode.format}).` }
      : { kind: 'idle' },
  )
  const [importSource, setImportSource] = useState<CardSource>(
    existing?.source ??
      prefill?.source ??
      initialBarcode?.source ??
      'manual',
  )
  const [cropSource, setCropSource] = useState<{
    file: File | Blob
    objectUrl: string
    /** When set, decoding succeeds will append a Ticket instead of overwriting
     *  the loyalty barcode fields. */
    target: 'loyalty' | 'tickets'
  } | null>(null)
  const [cropperOpen, setCropperOpen] = useState(false)
  /** Raw OCR output captured per ticket id, exposed via the editor's
   *  "Voir le texte lu" toggle so the user can debug what Tesseract saw. */
  const [ocrDebug, setOcrDebug] = useState<Record<string, string>>({})
  const loyaltyFileRef = useRef<HTMLInputElement>(null)
  const ticketsFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (cropSource) URL.revokeObjectURL(cropSource.objectUrl)
    }
  }, [cropSource])

  // Re-hydrate when the store finishes initial load in edit mode
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
    setOrganizer(existing.organizer ?? '')
    setTickets(initialTickets)
    setImportSource(existing.source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existing?.id])

  /** Size guard for any image entering the import pipeline — protects
   *  against DoS via a 50 MB clipboard paste eating Tesseract memory on
   *  iPhone. */
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024

  const isAcceptableImage = (file: File | Blob): boolean => {
    if (file.size > MAX_IMAGE_BYTES) {
      setImportStatus({
        kind: 'error',
        message: `Image trop volumineuse (${(file.size / 1024 / 1024).toFixed(1)} Mo, max ${MAX_IMAGE_BYTES / 1024 / 1024} Mo).`,
      })
      return false
    }
    return true
  }

  // ───────────── Loyalty single-image import (existing flow) ─────────────

  const tryDecodeForLoyalty = async (blob: File | Blob): Promise<boolean> => {
    setImportStatus({ kind: 'loading' })
    try {
      const result = await decodeImageBarcode(blob)
      setBarcodeFormat(result.format)
      setBarcodeValue(result.value)
      setImportSource('screenshot')
      setImportStatus({
        kind: 'success',
        message: `Code détecté (${result.format}).`,
      })
      return true
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Aucun code détecté'
      setImportStatus({ kind: 'error', message: reason })
      return false
    }
  }

  const handleLoyaltyFile = async (file: File): Promise<void> => {
    if (!isAcceptableImage(file)) return
    const ok = await tryDecodeForLoyalty(file)
    if (!ok) {
      const objectUrl = URL.createObjectURL(file)
      setCropSource((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl)
        return { file, objectUrl, target: 'loyalty' }
      })
    }
  }

  // ─────────── Event tickets multi-image batch import (new) ──────────────

  const handleTicketFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const accepted = files.filter(isAcceptableImage)
    if (accepted.length === 0) return
    files = accepted

    // Phase 1: barcode decode (fast)
    const decoded: Array<{ file: File; ticket: Ticket }> = []
    const failed: File[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file) continue
      setImportStatus({
        kind: 'batch-decode',
        current: i + 1,
        total: files.length,
      })
      try {
        const result = await decodeImageBarcode(file)
        decoded.push({
          file,
          ticket: {
            id: nanoid(),
            barcodeFormat: result.format,
            barcodeValue: result.value,
          },
        })
      } catch {
        failed.push(file)
      }
    }

    // Append the new tickets immediately so the user sees them.
    if (decoded.length > 0) {
      setTickets((prev) => [...prev, ...decoded.map((d) => d.ticket)])
      setImportSource('screenshot')
    }

    // Phase 2: OCR — extract holder/seat per ticket + global event metadata.
    // Sequential single worker to keep memory low on iPhone.
    const ocrResults: ExtractedTicketInfo[] = []
    if (decoded.length > 0) {
      let session: Awaited<ReturnType<typeof createOcrSession>> | null = null
      try {
        session = await createOcrSession()
        for (let i = 0; i < decoded.length; i++) {
          const item = decoded[i]
          if (!item) continue
          setImportStatus({
            kind: 'batch-ocr',
            current: i + 1,
            total: decoded.length,
          })
          try {
            const info = await session.recognize(item.file)
            ocrResults.push(info)
            // Stash raw text for the per-ticket debug panel — always set,
            // even if empty, so the user gets a "<vide>" panel instead of
            // wondering whether OCR ran at all.
            setOcrDebug((prev) => ({
              ...prev,
              [item.ticket.id]: info.rawText ?? '',
            }))
            // Patch this ticket with per-ticket OCR results
            const patch: Partial<Ticket> = {}
            if (info.holderName) patch.holderName = info.holderName
            if (info.seat) patch.seat = info.seat
            if (Object.keys(patch).length > 0) {
              setTickets((prev) =>
                prev.map((t) =>
                  t.id === item.ticket.id ? { ...t, ...patch } : t,
                ),
              )
            }
          } catch (err) {
            console.warn('[walleo] OCR failed for ticket', item.ticket.id, err)
            setOcrDebug((prev) => ({
              ...prev,
              [item.ticket.id]: `[OCR a échoué : ${
                err instanceof Error ? err.message : String(err)
              }]`,
            }))
          }
        }
      } catch (err) {
        console.warn('[walleo] Tesseract init failed', err)
        // Surface the failure to every ticket so the user sees what went
        // wrong instead of just silently missing the auto-fill.
        const reason = err instanceof Error ? err.message : String(err)
        setOcrDebug((prev) => {
          const next = { ...prev }
          for (const d of decoded) {
            next[d.ticket.id] = `[Tesseract n'a pas pu démarrer : ${reason}]`
          }
          return next
        })
      } finally {
        await session?.terminate().catch(() => {})
      }

      // Apply event-wide metadata from the first OCR result that has it.
      // Never overwrite values the user already typed.
      const globalInfo = ocrResults.find(
        (r) => r.eventName || r.eventDate || r.venue || r.organizer,
      )
      if (globalInfo) {
        if (globalInfo.eventName && !name) setName(globalInfo.eventName)
        if (globalInfo.eventDate && !eventDate) setEventDate(globalInfo.eventDate)
        if (globalInfo.venue && !venue) setVenue(globalInfo.venue)
        if (globalInfo.organizer && !organizer)
          setOrganizer(globalInfo.organizer)
      }
    }

    // Final status
    const enriched = ocrResults.filter(
      (r) => r.holderName || r.seat || r.eventName,
    ).length

    if (failed.length === 0) {
      const detail =
        enriched > 0
          ? ` (infos détectées sur ${enriched})`
          : ''
      setImportStatus({
        kind: 'success',
        message: `${decoded.length} billet${decoded.length > 1 ? 's' : ''} ajouté${decoded.length > 1 ? 's' : ''}${detail}.`,
      })
      return
    }

    // Queue the FIRST failed image into the cropper so the user can fix it
    const lastFailed = failed[0]
    if (lastFailed) {
      const objectUrl = URL.createObjectURL(lastFailed)
      setCropSource((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl)
        return { file: lastFailed, objectUrl, target: 'tickets' }
      })
    }
    setImportStatus({
      kind: 'error',
      message:
        decoded.length > 0
          ? `${decoded.length} ajouté${decoded.length > 1 ? 's' : ''}, ${failed.length} non reconnu${failed.length > 1 ? 's' : ''}. Recadre le premier.`
          : `${failed.length} photo${failed.length > 1 ? 's' : ''} sans code reconnu. Recadre la première.`,
    })
  }

  // ───────────────────────── Crop fallback ─────────────────────────

  const handleCropConfirm = async (region: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void> => {
    if (!cropSource) return
    try {
      const cropped = await cropImageRegion(cropSource.file, region)
      if (cropSource.target === 'loyalty') {
        const ok = await tryDecodeForLoyalty(cropped)
        if (ok) {
          setCropperOpen(false)
          URL.revokeObjectURL(cropSource.objectUrl)
          setCropSource(null)
        }
      } else {
        // tickets target: decode and append
        try {
          const result = await decodeImageBarcode(cropped)
          setTickets((prev) => [
            ...prev,
            {
              id: nanoid(),
              barcodeFormat: result.format,
              barcodeValue: result.value,
            },
          ])
          setImportStatus({
            kind: 'success',
            message: 'Billet ajouté.',
          })
          setCropperOpen(false)
          URL.revokeObjectURL(cropSource.objectUrl)
          setCropSource(null)
        } catch (err) {
          setImportStatus({
            kind: 'error',
            message:
              err instanceof Error ? err.message : 'Aucun code détecté.',
          })
        }
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

  // ─────────── Paste handler (Cmd+V single image) ───────────

  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            if (type === 'event') {
              void handleTicketFiles([file])
            } else {
              void handleLoyaltyFile(file)
            }
          }
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  // ─────────────────── Tickets management ───────────────────

  const updateTicket = (id: string, patch: Partial<Ticket>): void => {
    setTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    )
  }
  const removeTicket = (id: string): void => {
    setTickets((prev) => prev.filter((t) => t.id !== id))
  }
  const addEmptyTicket = (): void => {
    setTickets((prev) => [...prev, makeEmptyTicket()])
  }

  // ─────────────────────── Submit ────────────────────────

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      let topFormat: BarcodeFormat = barcodeFormat
      let topValue = barcodeValue.trim()

      if (type === 'event') {
        const firstTicket = tickets[0]
        if (firstTicket) {
          topFormat = firstTicket.barcodeFormat
          topValue = firstTicket.barcodeValue.trim()
        }
      }

      const cleanTickets =
        type === 'event'
          ? tickets
              .map((t) => ({
                ...t,
                barcodeValue: t.barcodeValue.trim(),
                holderName: t.holderName?.trim() || undefined,
                seat: t.seat?.trim() || undefined,
              }))
              .filter((t) => t.barcodeFormat === 'NONE' || t.barcodeValue)
          : undefined

      const payload = {
        type,
        name: name.trim(),
        brandColor,
        barcodeFormat: topFormat,
        barcodeValue: topValue,
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
        organizer:
          type === 'event' && organizer.trim() ? organizer.trim() : undefined,
        tickets:
          cleanTickets && cleanTickets.length > 0 ? cleanTickets : undefined,
      }

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
          ...(payload.organizer ? { organizer: payload.organizer } : {}),
          ...(payload.tickets ? { tickets: payload.tickets } : {}),
        })
        navigate(`/card/${card.id}`, { replace: true })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    name.trim().length > 0 &&
    (type === 'loyalty'
      ? barcodeFormat === 'NONE' || barcodeValue.trim().length > 0
      : tickets.length > 0 &&
        tickets.every(
          (t) => t.barcodeFormat === 'NONE' || t.barcodeValue.trim().length > 0,
        ))

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

  // ─────────────────── Render ────────────────────────

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
          {/* ── Type ── */}
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
              placeholder={
                type === 'loyalty' ? 'Carrefour' : 'Coldplay au Stade…'
              }
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
                    brandColor === c
                      ? 'border-walleo-yellow'
                      : 'border-transparent'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>

          {/* ── LOYALTY: single barcode + import ── */}
          {type === 'loyalty' && (
            <>
              <ImportSection
                title="Importer un code-barres"
                hint="Colle (Cmd+V) un screenshot ou choisis une image."
                multiple={false}
                inputRef={loyaltyFileRef}
                onFiles={(files) => {
                  const f = files[0]
                  if (f) void handleLoyaltyFile(f)
                }}
                status={importStatus}
                onCropManually={
                  cropSource ? () => setCropperOpen(true) : undefined
                }
              />

              <Field label="Format du code">
                <select
                  value={barcodeFormat}
                  onChange={(e) =>
                    setBarcodeFormat(e.target.value as BarcodeFormat)
                  }
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

              <Field label="N° de membre (lisible)">
                <input
                  value={memberNumber}
                  onChange={(e) => setMemberNumber(e.target.value)}
                  placeholder="0123 4567 8901"
                  className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
                />
              </Field>
            </>
          )}

          {/* ── EVENT: tickets list + multi-import ── */}
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
              <Field label="Émetteur">
                <input
                  value={organizer}
                  onChange={(e) => setOrganizer(e.target.value)}
                  placeholder="Ticketmaster"
                  className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base outline-none focus:border-walleo-yellow"
                />
              </Field>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    Billets
                    {tickets.length > 0 && (
                      <span className="ml-1 rounded-full bg-walleo-yellow/15 px-2 py-0.5 text-[10px] text-walleo-yellow">
                        {tickets.length}
                      </span>
                    )}
                  </span>
                </div>

                <ImportSection
                  title="Importer plusieurs billets"
                  hint="Sélectionne les photos / screenshots de tes 2, 5, 10 billets — chaque code détecté ajoute un billet."
                  multiple={true}
                  inputRef={ticketsFileRef}
                  onFiles={(files) => void handleTicketFiles(files)}
                  status={importStatus}
                  onCropManually={
                    cropSource && cropSource.target === 'tickets'
                      ? () => setCropperOpen(true)
                      : undefined
                  }
                />

                <div className="mt-3 space-y-3">
                  {tickets.map((t, idx) => (
                    <TicketEditor
                      key={t.id}
                      index={idx}
                      ticket={t}
                      ocrRawText={ocrDebug[t.id]}
                      onChange={(patch) => updateTicket(t.id, patch)}
                      onRemove={() => removeTicket(t.id)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addEmptyTicket}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-xs font-medium text-muted-foreground transition active:scale-[0.99]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter un billet manuellement
                </button>
              </div>
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

interface ImportSectionProps {
  title: string
  hint: string
  multiple: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onFiles: (files: File[]) => void
  status: ImportStatus
  onCropManually?: () => void
}

function ImportSection({
  title,
  hint,
  multiple,
  inputRef,
  onFiles,
  status,
  onCropManually,
}: ImportSectionProps) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-secondary/40 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-walleo-yellow/15 p-2 text-walleo-yellow">
          <ImagePlus className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={
              status.kind === 'loading' ||
              status.kind === 'batch-decode' ||
              status.kind === 'batch-ocr'
            }
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-walleo-yellow px-4 py-2 text-xs font-semibold text-walleo-black transition active:scale-95 disabled:opacity-50"
          >
            {status.kind === 'loading' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Détection…
              </>
            )}
            {status.kind === 'batch-decode' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Code-barres {status.current}/{status.total}…
              </>
            )}
            {status.kind === 'batch-ocr' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Lecture texte {status.current}/{status.total}…
              </>
            )}
            {status.kind !== 'loading' &&
              status.kind !== 'batch-decode' &&
              status.kind !== 'batch-ocr' && (
                <>{multiple ? 'Choisir des images' : 'Choisir une image'}</>
              )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple={multiple}
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length > 0) onFiles(files)
            }}
          />
          {status.kind === 'success' && (
            <p className="mt-2 text-xs text-walleo-yellow">{status.message}</p>
          )}
          {status.kind === 'error' && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-destructive">{status.message}</p>
              {onCropManually && (
                <button
                  type="button"
                  onClick={onCropManually}
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
  )
}

interface TicketEditorProps {
  index: number
  ticket: Ticket
  ocrRawText?: string
  onChange: (patch: Partial<Ticket>) => void
  onRemove: () => void
}

function TicketEditor({
  index,
  ticket,
  ocrRawText,
  onChange,
  onRemove,
}: TicketEditorProps) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Billet {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Supprimer ce billet"
          className="flex h-7 w-7 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 active:scale-95"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={ticket.barcodeFormat}
          onChange={(e) =>
            onChange({ barcodeFormat: e.target.value as BarcodeFormat })
          }
          className="rounded-lg border border-border bg-background px-2 py-2 text-xs outline-none focus:border-walleo-yellow"
        >
          {BARCODE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f === 'NONE' ? 'Aucun' : f}
            </option>
          ))}
        </select>
        <input
          value={ticket.holderName ?? ''}
          onChange={(e) => onChange({ holderName: e.target.value })}
          placeholder="Au nom de…"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-walleo-yellow"
        />
      </div>
      <input
        value={ticket.barcodeValue}
        onChange={(e) => onChange({ barcodeValue: e.target.value })}
        placeholder="Valeur du code"
        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-walleo-yellow"
      />
      <input
        value={ticket.seat ?? ''}
        onChange={(e) => onChange({ seat: e.target.value })}
        placeholder="Place / siège"
        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-walleo-yellow"
      />
      {ocrRawText !== undefined && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            Voir le texte lu (OCR)
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-background/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {ocrRawText.trim() || '(rien lu — image trop petite, peu contrastée, ou Tesseract n\'a pas tourné)'}
          </pre>
        </details>
      )}
    </div>
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

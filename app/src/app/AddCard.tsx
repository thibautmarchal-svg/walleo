import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useCardsStore } from '@/features/cards/store'
import type { BarcodeFormat, CardType } from '@/shared/db/types'

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

export function AddCard() {
  const navigate = useNavigate()
  const add = useCardsStore((s) => s.add)
  const [type, setType] = useState<CardType>('loyalty')
  const [name, setName] = useState('')
  const [brandColor, setBrandColor] = useState(PRESET_COLORS[0]!)
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormat>('QR')
  const [barcodeValue, setBarcodeValue] = useState('')
  const [memberNumber, setMemberNumber] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [venue, setVenue] = useState('')
  const [seat, setSeat] = useState('')
  const [organizer, setOrganizer] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const card = await add({
        type,
        name: name.trim(),
        brandColor,
        barcodeFormat,
        barcodeValue: barcodeValue.trim(),
        ...(type === 'loyalty' && memberNumber.trim()
          ? { memberNumber: memberNumber.trim() }
          : {}),
        ...(type === 'event'
          ? {
              ...(eventDate
                ? { eventDate: new Date(eventDate).toISOString() }
                : {}),
              ...(venue.trim() ? { venue: venue.trim() } : {}),
              ...(seat.trim() ? { seat: seat.trim() } : {}),
              ...(organizer.trim() ? { organizer: organizer.trim() } : {}),
            }
          : {}),
        source: 'manual',
      })
      navigate(`/card/${card.id}`, { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    name.trim().length > 0 &&
    (barcodeFormat === 'NONE' || barcodeValue.trim().length > 0)

  return (
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
        <h1 className="text-base font-semibold">Nouvelle carte</h1>
      </header>

      <form onSubmit={onSubmit} className="space-y-5 px-5 py-6 pb-32">
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
          className="safe-bottom fixed bottom-6 left-5 right-5 rounded-full bg-walleo-yellow px-5 py-3 text-base font-semibold text-walleo-black shadow-2xl shadow-walleo-yellow/30 transition active:scale-95 disabled:opacity-40"
        >
          {submitting ? 'Enregistrement…' : 'Enregistrer la carte'}
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

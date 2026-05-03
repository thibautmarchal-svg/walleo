import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Wallet as WalletIcon } from 'lucide-react'
import { useCardsStore } from '@/features/cards/store'
import { Barcode } from '@/features/barcode-display/Barcode'
import { useWakeLock } from '@/lib/hooks/useWakeLock'

export function CardDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const card = useCardsStore((s) => s.cards.find((c) => c.id === id))
  const remove = useCardsStore((s) => s.remove)

  useWakeLock(true)

  useEffect(() => {
    document.documentElement.style.setProperty('color-scheme', 'light')
    return () => {
      document.documentElement.style.setProperty('color-scheme', 'dark')
    }
  }, [])

  if (!card) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-base text-muted-foreground">Carte introuvable.</p>
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

  const isEvent = card.type === 'event'
  const dateLabel =
    isEvent && card.eventDate
      ? new Date(card.eventDate).toLocaleString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null

  const onDelete = async (): Promise<void> => {
    if (!confirm(`Supprimer "${card.name}" ?`)) return
    await remove(card.id)
    navigate('/')
  }

  return (
    <div className="flex min-h-full flex-col bg-white text-walleo-black">
      <header className="safe-top sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-walleo-black active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="truncate px-3 text-base font-semibold">{card.name}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/card/${card.id}/edit`)}
            aria-label="Modifier"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-walleo-black active:scale-95"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Supprimer"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-destructive active:scale-95"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-start gap-6 px-5 py-8">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_2px_24px_rgba(0,0,0,0.08)]">
          <Barcode
            format={card.barcodeFormat}
            value={card.barcodeValue}
            className="flex justify-center"
          />
          <p className="mt-4 break-all text-center font-mono text-xs text-neutral-500">
            {card.barcodeValue}
          </p>
        </div>

        <div className="w-full max-w-md space-y-3 text-sm">
          {card.memberNumber && (
            <DetailRow label="N° de membre" value={card.memberNumber} />
          )}
          {dateLabel && <DetailRow label="Date" value={dateLabel} />}
          {card.venue && <DetailRow label="Lieu" value={card.venue} />}
          {card.seat && <DetailRow label="Place" value={card.seat} />}
          {card.organizer && (
            <DetailRow label="Émetteur" value={card.organizer} />
          )}
          <DetailRow
            label="Format"
            value={card.barcodeFormat === 'NONE' ? 'Aucun' : card.barcodeFormat}
          />
        </div>

        {card.hasOriginalPkpass && (
          <button
            type="button"
            className="flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-walleo-black px-5 py-3 text-sm font-semibold text-white"
            onClick={() => alert('Re-export Wallet — Phase 3')}
          >
            <WalletIcon className="h-4 w-4" />
            Ajouter à Apple Wallet
          </button>
        )}
      </main>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-3">
      <span className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className="ml-4 max-w-[60%] truncate text-right font-medium text-walleo-black">
        {value}
      </span>
    </div>
  )
}

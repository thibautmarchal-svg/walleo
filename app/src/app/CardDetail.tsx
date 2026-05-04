import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Wallet as WalletIcon } from 'lucide-react'
import { useCardsStore } from '@/features/cards/store'
import { Barcode } from '@/features/barcode-display/Barcode'
import { useWakeLock } from '@/lib/hooks/useWakeLock'
import { exportPkpassToWallet } from '@/features/wallet-reexport/exportPkpass'
import { getEventTickets, type Ticket } from '@/shared/db/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'

export function CardDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const card = useCardsStore((s) => s.cards.find((c) => c.id === id))
  const remove = useCardsStore((s) => s.remove)
  const update = useCardsStore((s) => s.update)
  const [exportError, setExportError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

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
  const tickets = isEvent ? getEventTickets(card) : null
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

  const confirmDelete = async (): Promise<void> => {
    if (!card) return
    await remove(card.id)
    navigate('/')
  }

  const onExportPkpass = async (blob: Blob): Promise<void> => {
    setExportError(null)
    const result = await exportPkpassToWallet(blob, `${card.name}.pkpass`)
    if (!result.ok) {
      setExportError(result.message ?? 'Échec de l\'export.')
      return
    }
    await update(card.id, { lastWalletExportAt: Date.now() })
  }

  return (
    <div className="flex min-h-full flex-col bg-white text-walleo-black">
      <header className="safe-top sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-walleo-black active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="truncate px-3 text-base font-semibold">{card.name}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/card/${card.id}/edit`)}
            aria-label="Modifier"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-walleo-black active:scale-95"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            aria-label="Supprimer"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-destructive active:scale-95"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </header>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer "{card.name}" ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La carte et son code-barres
              seront effacés de cet appareil.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmDelete()}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="flex flex-1 flex-col items-center gap-6 py-8">
        {tickets ? (
          <TicketSwiper tickets={tickets} onExportPkpass={onExportPkpass} />
        ) : (
          <SingleBarcode
            format={card.barcodeFormat}
            value={card.barcodeValue}
          />
        )}

        <div className="w-full max-w-md space-y-3 px-5 text-sm">
          {card.memberNumber && (
            <DetailRow label="N° de membre" value={card.memberNumber} />
          )}
          {dateLabel && <DetailRow label="Date" value={dateLabel} />}
          {card.venue && <DetailRow label="Lieu" value={card.venue} />}
          {card.organizer && (
            <DetailRow label="Émetteur" value={card.organizer} />
          )}
          {!isEvent && (
            <DetailRow
              label="Format"
              value={
                card.barcodeFormat === 'NONE' ? 'Aucun' : card.barcodeFormat
              }
            />
          )}
        </div>

        {/* Loyalty card with original pkpass — rare case but supported */}
        {!isEvent && card.hasOriginalPkpass && card.originalPkpassBlob && (
          <button
            type="button"
            onClick={() =>
              card.originalPkpassBlob &&
              void onExportPkpass(card.originalPkpassBlob)
            }
            className="mx-5 flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-walleo-black px-5 py-3 text-sm font-semibold text-white active:scale-95"
          >
            <WalletIcon className="h-4 w-4" />
            Ajouter à Apple Wallet
          </button>
        )}

        {exportError && (
          <p className="mx-5 max-w-md rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-xs text-destructive">
            {exportError}
          </p>
        )}
      </main>
    </div>
  )
}

function SingleBarcode({
  format,
  value,
}: {
  format: Ticket['barcodeFormat']
  value: string
}) {
  return (
    <div className="w-full max-w-md px-5">
      <div className="rounded-3xl bg-white p-6 shadow-[0_2px_24px_rgba(0,0,0,0.08)]">
        <Barcode format={format} value={value} className="flex justify-center" />
        {value && format !== 'NONE' && (
          <p className="mt-5 break-all text-center font-mono text-base font-medium tracking-wider text-walleo-black">
            {value}
          </p>
        )}
      </div>
    </div>
  )
}

interface TicketSwiperProps {
  tickets: Ticket[]
  onExportPkpass: (blob: Blob) => Promise<void>
}

function TicketSwiper({ tickets, onExportPkpass }: TicketSwiperProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const isMulti = tickets.length > 1

  useEffect(() => {
    if (!isMulti) return
    const el = scrollRef.current
    if (!el) return
    let frame = 0
    const onScroll = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const idx = Math.round(el.scrollLeft / el.clientWidth)
        setActiveIdx(Math.max(0, Math.min(tickets.length - 1, idx)))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [isMulti, tickets.length])

  const goTo = (idx: number): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <div className="w-full">
      {isMulti && (
        <div className="mb-4 flex items-center justify-center gap-3 px-5">
          <span className="text-xs font-medium text-neutral-500">
            Billet {activeIdx + 1} sur {tickets.length}
          </span>
          <div className="flex gap-1.5" role="tablist" aria-label="Billets">
            {tickets.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={i === activeIdx}
                aria-label={`Aller au billet ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-2 rounded-full transition-all ${
                  i === activeIdx ? 'w-6 bg-walleo-black' : 'w-2 bg-neutral-300'
                }`}
              />
            ))}
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {tickets.map((t) => (
          <div
            key={t.id}
            className="flex w-full shrink-0 snap-center justify-center px-5"
          >
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_2px_24px_rgba(0,0,0,0.08)]">
              <Barcode
                format={t.barcodeFormat}
                value={t.barcodeValue}
                className="flex justify-center"
              />
              {t.barcodeValue && t.barcodeFormat !== 'NONE' && (
                <p className="mt-5 break-all text-center font-mono text-base font-medium tracking-wider text-walleo-black">
                  {t.barcodeValue}
                </p>
              )}
              {(t.holderName || t.seat) && (
                <div className="mt-4 space-y-2 border-t border-neutral-100 pt-4">
                  {t.holderName && (
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-500">Au nom de</span>
                      <span className="font-medium">{t.holderName}</span>
                    </div>
                  )}
                  {t.seat && (
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-500">Place</span>
                      <span className="text-right font-medium">{t.seat}</span>
                    </div>
                  )}
                </div>
              )}
              {t.hasOriginalPkpass && t.originalPkpassBlob && (
                <button
                  type="button"
                  onClick={() => {
                    if (t.originalPkpassBlob) {
                      void onExportPkpass(t.originalPkpassBlob)
                    }
                  }}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-walleo-black px-4 py-2.5 text-xs font-semibold text-white active:scale-95"
                >
                  <WalletIcon className="h-3.5 w-3.5" />
                  Ajouter à Apple Wallet
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
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

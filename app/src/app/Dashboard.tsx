import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Settings as SettingsIcon, Wallet, X } from 'lucide-react'
import { useCardsStore } from '@/features/cards/store'
import { CardTile } from '@/features/cards/CardTile'
import { cn } from '@/lib/utils'
import { AddMenu } from './AddMenu'

type Filter = 'all' | 'loyalty' | 'event' | 'upcoming'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'loyalty', label: 'Fidélité' },
  { value: 'event', label: 'Billets' },
  { value: 'upcoming', label: 'À venir' },
]

export function Dashboard() {
  const cards = useCardsStore((s) => s.cards)
  const loading = useCardsStore((s) => s.loading)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  const filtered = useMemo(() => {
    let result = cards

    if (filter === 'upcoming') {
      const now = Date.now()
      result = result
        .filter(
          (c) =>
            c.type === 'event' && c.eventDate && Date.parse(c.eventDate) >= now,
        )
        .sort(
          (a, b) =>
            Date.parse(a.eventDate ?? '') - Date.parse(b.eventDate ?? ''),
        )
    } else if (filter !== 'all') {
      result = result.filter((c) => c.type === filter)
    }

    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter((c) => {
        const ticketStrings = c.tickets
          ? c.tickets
              .flatMap((t) => [t.holderName, t.seat, t.barcodeValue])
              .filter(Boolean)
          : []
        const haystack = [
          c.name,
          c.memberNumber,
          c.venue,
          c.seat,
          c.organizer,
          c.barcodeValue,
          ...ticketStrings,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
    }

    return result
  }, [cards, filter, search])

  return (
    <div className="min-h-full bg-background">
      <header className="safe-top sticky top-0 z-10 border-b border-border bg-background/80 px-5 py-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-6 w-6 text-walleo-yellow" />
            <h1 className="text-xl font-bold tracking-tight">Walleo</h1>
            <span
              className="ml-1 rounded-full bg-secondary px-2 py-0.5 font-mono text-[9px] text-muted-foreground"
              title={`Build ${__BUILD_DATE__}`}
            >
              {__BUILD_HASH__}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {cards.length} {cards.length > 1 ? 'cartes' : 'carte'}
            </span>
            <Link
              to="/settings"
              aria-label="Paramètres"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition active:scale-95"
            >
              <SettingsIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            inputMode="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom, lieu, n°)…"
            aria-label="Rechercher une carte"
            className="w-full rounded-full border border-border bg-secondary py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-walleo-yellow focus:ring-2 focus:ring-walleo-yellow/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-background"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="mt-3 flex gap-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition',
                filter === f.value
                  ? 'bg-walleo-yellow text-walleo-black'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
              )}
            >
              {f.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="px-5 py-5 pb-32">
        {loading && (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Wallet className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-base text-muted-foreground">
              {search.trim()
                ? `Aucun résultat pour « ${search.trim()} ».`
                : 'Aucune carte pour ce filtre.'}
            </p>
            {search.trim() ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="mt-4 rounded-full border border-border bg-secondary px-5 py-2 text-sm font-medium text-foreground transition active:scale-[0.97]"
              >
                Effacer la recherche
              </button>
            ) : (
              <Link
                to="/add"
                className="mt-4 rounded-full bg-walleo-yellow px-5 py-2 text-sm font-semibold text-walleo-black transition active:scale-[0.97]"
              >
                Ajouter une carte
              </Link>
            )}
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <CardTile key={c.id} card={c} />
            ))}
          </div>
        )}
      </main>

      <button
        type="button"
        onClick={() => setAddMenuOpen(true)}
        aria-label="Ajouter une carte"
        style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        className="fixed right-6 flex h-14 w-14 items-center justify-center rounded-full bg-walleo-yellow text-walleo-black shadow-2xl shadow-walleo-yellow/30 transition active:scale-95"
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} />
      </button>

      <AddMenu open={addMenuOpen} onClose={() => setAddMenuOpen(false)} />
    </div>
  )
}

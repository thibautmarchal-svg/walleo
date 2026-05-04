import { Link } from 'react-router-dom'
import { Calendar, Tag, Users } from 'lucide-react'
import type { Card } from '@/shared/db/types'

interface CardTileProps {
  card: Card
}

export function CardTile({ card }: CardTileProps) {
  const isEvent = card.type === 'event'
  const ticketCount = isEvent && card.tickets ? card.tickets.length : 0
  const subtitle = isEvent
    ? card.venue ?? card.organizer ?? 'Événement'
    : card.memberNumber ?? 'Carte de fidélité'
  // Pick black or white text based on the brand color's luminance — pure
  // white on a yellow brand (#FFD60A) drops to ~1.2:1 contrast (well below
  // WCAG AA 4.5:1). Computing luminance ourselves keeps the choice CSS-free.
  const textOnCard = readableTextColor(card.brandColor)

  const dateLabel =
    isEvent && card.eventDate
      ? new Date(card.eventDate).toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : null

  return (
    <Link
      to={`/card/${card.id}`}
      className="group relative block aspect-[1.586/1] overflow-hidden rounded-2xl shadow-lg transition active:scale-[0.98]"
      style={{
        background: `linear-gradient(135deg, ${card.brandColor} 0%, ${shade(card.brandColor, -25)} 100%)`,
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/30" />
      <div
        className={`relative flex h-full flex-col justify-between p-5 ${
          textOnCard === 'black' ? 'text-walleo-black' : 'text-white'
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm">
            {isEvent ? (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Billet
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Tag className="h-3 w-3" /> Fidélité
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {ticketCount > 1 && (
              <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">
                <Users className="h-3 w-3" />
                {ticketCount} places
              </div>
            )}
            {dateLabel && (
              <div className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">
                {dateLabel}
              </div>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold leading-tight tracking-tight line-clamp-2">
            {card.name}
          </h3>
          <p className="text-xs/5 opacity-80 line-clamp-1">{subtitle}</p>
        </div>
      </div>
    </Link>
  )
}

/** Lighten/darken a hex color by a percentage (-100 to 100). */
function shade(hex: string, percent: number): string {
  const cleaned = hex.replace('#', '')
  const num = parseInt(cleaned, 16)
  const amount = Math.round(2.55 * percent)
  const r = clamp((num >> 16) + amount)
  const g = clamp(((num >> 8) & 0xff) + amount)
  const b = clamp((num & 0xff) + amount)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, n))
}

/** Returns 'black' or 'white' for the most readable text colour on a given
 *  hex background. Uses sRGB relative luminance (WCAG formula). */
function readableTextColor(hex: string): 'black' | 'white' {
  const cleaned = hex.replace('#', '')
  const r = parseInt(cleaned.slice(0, 2), 16) / 255
  const g = parseInt(cleaned.slice(2, 4), 16) / 255
  const b = parseInt(cleaned.slice(4, 6), 16) / 255
  // Approximate luminance — gamma simplification is fine for picking text
  // colour, we don't need WCAG-exact contrast ratios here.
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55 ? 'black' : 'white'
}

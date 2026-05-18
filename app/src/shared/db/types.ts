/**
 * Domain types for Walleo.
 *
 * A "Card" is the unified entity for both loyalty cards and event tickets —
 * the discriminator is `type`.
 *
 * Loyalty cards have a single barcode at the top level.
 * Event cards have one OR MANY barcodes via `tickets[]` (e.g. concert with
 * children, theatre with spouse). Top-level `barcodeFormat`/`barcodeValue`
 * stay populated as a fallback / quick-access mirror of `tickets[0]` for
 * backwards compatibility, but `tickets[]` is the source of truth when set.
 */

export type CardType = 'loyalty' | 'event'

export type BarcodeFormat =
  | 'QR'
  | 'EAN13'
  | 'CODE128'
  | 'PDF417'
  | 'AZTEC'
  | 'NONE'

export type CardSource =
  | 'manual'
  | 'camera'
  | 'screenshot'
  | 'photo-ocr'
  | 'email'
  | 'pdf'

/** A user-attached PDF / image (festival map, paper ticket scan,
 *  parking voucher…). Stored as a Blob in IndexedDB, never leaves the
 *  device. */
export interface Attachment {
  id: string
  filename: string
  mimeType: string
  /** Size in bytes — duplicated from blob.size for cheap display. */
  size: number
  blob: Blob
  addedAt: number
}

export interface Ticket {
  id: string
  barcodeFormat: BarcodeFormat
  barcodeValue: string
  holderName?: string // ex: "Thibaut", "Lucas", "Mia"
  seat?: string // ex: "Bloc A12 — Rang 14 — Siège 22"
  hasOriginalPkpass?: boolean
  originalPkpassBlob?: Blob
}

export interface Card {
  id: string
  type: CardType
  name: string
  brandColor: string

  logoUrl?: string

  // Single barcode (loyalty) / fallback for events without `tickets[]`
  barcodeFormat: BarcodeFormat
  barcodeValue: string

  // loyalty-specific
  memberNumber?: string

  // event-specific
  eventDate?: string // ISO 8601 — start date for multi-day events
  /** Optional end date for multi-day events (festivals, weekends).
   *  When set, the event is considered "past" only after eventEndDate. */
  eventEndDate?: string
  venue?: string
  seat?: string // legacy / single-seat events; prefer Ticket.seat for multi
  organizer?: string
  /** Multiple tickets for one event. When set + non-empty, takes priority
   *  over the top-level barcode for display. */
  tickets?: Ticket[]

  // metadata
  createdAt: number
  updatedAt: number
  source: CardSource

  // .pkpass — single-ticket fallback (loyalty cards never have one)
  hasOriginalPkpass?: boolean
  originalPkpassBlob?: Blob
  lastWalletExportAt?: number

  notes?: string

  /** Free-form user-uploaded files (PDFs, images) attached to the card. */
  attachments?: Attachment[]
}

export type NewCardInput = Omit<Card, 'id' | 'createdAt' | 'updatedAt'>

/** Returns true when an event card's date is in the past.
 *  Uses eventEndDate if set (multi-day events), else eventDate.
 *  Returns false for loyalty cards or events without dates. */
export function isPastEvent(card: Card, now: number = Date.now()): boolean {
  if (card.type !== 'event') return false
  const cutoff = card.eventEndDate ?? card.eventDate
  if (!cutoff) return false
  // Add 23h59 to compare day-end, so an event on today's date isn't archived
  // before the day is actually over.
  const dt = new Date(cutoff)
  dt.setHours(23, 59, 59, 999)
  return dt.getTime() < now
}

/** Returns the active list of tickets for an event card.
 *  Always returns at least one ticket — falls back to the top-level barcode
 *  for legacy events that haven't been migrated to `tickets[]` yet. */
export function getEventTickets(card: Card): Ticket[] {
  if (card.tickets && card.tickets.length > 0) return card.tickets
  return [
    {
      id: `${card.id}-legacy`,
      barcodeFormat: card.barcodeFormat,
      barcodeValue: card.barcodeValue,
      seat: card.seat,
      hasOriginalPkpass: card.hasOriginalPkpass,
      originalPkpassBlob: card.originalPkpassBlob,
    },
  ]
}

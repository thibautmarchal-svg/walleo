/**
 * Domain types for Walleo.
 *
 * A "Card" is the unified entity for both loyalty cards and event tickets —
 * the discriminator is `type`. Optional fields are populated based on the type.
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

export interface Card {
  id: string
  type: CardType
  name: string
  brandColor: string

  logoUrl?: string

  barcodeFormat: BarcodeFormat
  barcodeValue: string

  // loyalty-specific
  memberNumber?: string

  // event-specific
  eventDate?: string // ISO 8601
  venue?: string
  seat?: string
  organizer?: string

  // metadata
  createdAt: number
  updatedAt: number
  source: CardSource

  // .pkpass — only present when received signed from a provider
  hasOriginalPkpass?: boolean
  originalPkpassBlob?: Blob
  lastWalletExportAt?: number

  notes?: string
}

export type NewCardInput = Omit<Card, 'id' | 'createdAt' | 'updatedAt'>

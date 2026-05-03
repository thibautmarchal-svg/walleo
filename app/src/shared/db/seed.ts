import { nanoid } from 'nanoid'
import { db } from './db'
import type { Card } from './types'

/**
 * Seeds the local DB with example cards on first load.
 * Idempotent: only runs if the cards table is empty.
 */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.cards.count()
  if (count > 0) return

  const now = Date.now()
  const seed: Card[] = [
    {
      id: nanoid(),
      type: 'loyalty',
      name: 'Carrefour',
      brandColor: '#0E4A8A',
      barcodeFormat: 'EAN13',
      barcodeValue: '9780201379624',
      memberNumber: '0123 4567 8901',
      createdAt: now,
      updatedAt: now,
      source: 'manual',
    },
    {
      id: nanoid(),
      type: 'loyalty',
      name: 'Decathlon',
      brandColor: '#0082C3',
      barcodeFormat: 'CODE128',
      barcodeValue: 'DKT-2026-00012345',
      memberNumber: '2026-00012345',
      createdAt: now,
      updatedAt: now,
      source: 'manual',
    },
    {
      id: nanoid(),
      type: 'loyalty',
      name: 'FNAC',
      brandColor: '#E8B71D',
      barcodeFormat: 'QR',
      barcodeValue: 'fnac://member/THIBAUT-9982',
      memberNumber: 'THIBAUT-9982',
      createdAt: now,
      updatedAt: now,
      source: 'manual',
    },
    {
      id: nanoid(),
      type: 'event',
      name: 'Coldplay — Music of the Spheres',
      brandColor: '#7C3AED',
      barcodeFormat: 'QR',
      barcodeValue: 'TM-COLDPLAY-2026-PARIS-A12-RANG14-S22',
      eventDate: new Date(now + 1000 * 60 * 60 * 24 * 21).toISOString(),
      venue: 'Stade de France, Saint-Denis',
      seat: 'Bloc A12 — Rang 14 — Siège 22',
      organizer: 'Ticketmaster',
      createdAt: now,
      updatedAt: now,
      source: 'manual',
    },
    {
      id: nanoid(),
      type: 'event',
      name: 'TGV INOUI 8409',
      brandColor: '#0F172A',
      barcodeFormat: 'AZTEC',
      barcodeValue: 'SNCF-TKT-EU-9923-A409',
      eventDate: new Date(now + 1000 * 60 * 60 * 24 * 5).toISOString(),
      venue: 'Paris Gare de Lyon → Marseille Saint-Charles',
      seat: 'Voiture 12 — Place 47',
      organizer: 'SNCF Connect',
      createdAt: now,
      updatedAt: now,
      source: 'manual',
    },
  ]

  await db.cards.bulkAdd(seed)
}

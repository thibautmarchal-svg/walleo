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
      organizer: 'Ticketmaster',
      tickets: [
        {
          id: nanoid(),
          barcodeFormat: 'QR',
          barcodeValue: 'TM-COLDPLAY-2026-PARIS-A12-R14-S22',
          holderName: 'Thibaut',
          seat: 'Bloc A12 — Rang 14 — Siège 22',
        },
        {
          id: nanoid(),
          barcodeFormat: 'QR',
          barcodeValue: 'TM-COLDPLAY-2026-PARIS-A12-R14-S23',
          holderName: 'Lucas',
          seat: 'Bloc A12 — Rang 14 — Siège 23',
        },
        {
          id: nanoid(),
          barcodeFormat: 'QR',
          barcodeValue: 'TM-COLDPLAY-2026-PARIS-A12-R14-S24',
          holderName: 'Mia',
          seat: 'Bloc A12 — Rang 14 — Siège 24',
        },
      ],
      createdAt: now,
      updatedAt: now,
      source: 'manual',
    },
    {
      id: nanoid(),
      type: 'event',
      name: 'Cyrano de Bergerac — Comédie-Française',
      brandColor: '#0F172A',
      barcodeFormat: 'QR',
      barcodeValue: 'CF-CYRANO-2026-OCT-12-PARIS-ORC-G9',
      eventDate: new Date(now + 1000 * 60 * 60 * 24 * 9).toISOString(),
      venue: 'Comédie-Française, Salle Richelieu, Paris',
      organizer: 'Comédie-Française',
      tickets: [
        {
          id: nanoid(),
          barcodeFormat: 'QR',
          barcodeValue: 'CF-CYRANO-2026-ORC-G09',
          holderName: 'Thibaut',
          seat: 'Orchestre — Rang G — Siège 9',
        },
        {
          id: nanoid(),
          barcodeFormat: 'QR',
          barcodeValue: 'CF-CYRANO-2026-ORC-G10',
          holderName: 'Marie',
          seat: 'Orchestre — Rang G — Siège 10',
        },
      ],
      createdAt: now,
      updatedAt: now,
      source: 'manual',
    },
    {
      id: nanoid(),
      type: 'event',
      name: 'TGV INOUI 8409',
      brandColor: '#0EA5E9',
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

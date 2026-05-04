import Dexie, { type EntityTable } from 'dexie'
import type { Card } from './types'

class WalleoDB extends Dexie {
  cards!: EntityTable<Card, 'id'>

  constructor() {
    super('walleo')
    this.version(1).stores({
      cards: 'id, type, name, eventDate, createdAt, updatedAt',
    })
    // v2: index eventEndDate for multi-day events. Adding a non-required
    // field doesn't need a data migration — Dexie just adds the index.
    this.version(2).stores({
      cards: 'id, type, name, eventDate, eventEndDate, createdAt, updatedAt',
    })
  }
}

export const db = new WalleoDB()

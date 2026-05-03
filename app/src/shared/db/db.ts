import Dexie, { type EntityTable } from 'dexie'
import type { Card } from './types'

class WalleoDB extends Dexie {
  cards!: EntityTable<Card, 'id'>

  constructor() {
    super('walleo')
    this.version(1).stores({
      cards: 'id, type, name, eventDate, createdAt, updatedAt',
    })
  }
}

export const db = new WalleoDB()

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { db } from '@/shared/db/db'
import type { Card, NewCardInput } from '@/shared/db/types'

interface CardsState {
  cards: Card[]
  loading: boolean
  loadAll: () => Promise<void>
  add: (input: NewCardInput) => Promise<Card>
  update: (id: string, patch: Partial<Card>) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => Card | undefined
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: [],
  loading: true,

  loadAll: async () => {
    const cards = await db.cards.orderBy('updatedAt').reverse().toArray()
    set({ cards, loading: false })
  },

  add: async (input) => {
    const now = Date.now()
    const card: Card = { ...input, id: nanoid(), createdAt: now, updatedAt: now }
    await db.cards.add(card)
    set({ cards: [card, ...get().cards] })
    return card
  },

  update: async (id, patch) => {
    const updatedAt = Date.now()
    await db.cards.update(id, { ...patch, updatedAt })
    set({
      cards: get().cards.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt } : c,
      ),
    })
  },

  remove: async (id) => {
    await db.cards.delete(id)
    set({ cards: get().cards.filter((c) => c.id !== id) })
  },

  getById: (id) => get().cards.find((c) => c.id === id),
}))

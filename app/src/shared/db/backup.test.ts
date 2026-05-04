/**
 * Unit tests for the backup round-trip (export → import).
 *
 * Dexie uses fake-indexeddb (injected via test-setup.ts) — no real browser
 * IndexedDB required.
 *
 * Each test resets the DB so tests are isolated.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import { exportBackup, importBackup } from './backup'
import type { Card } from './types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = Date.now()
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    type: 'loyalty',
    name: 'Test Card',
    brandColor: '#0E4A8A',
    barcodeFormat: 'QR',
    barcodeValue: 'TEST-VALUE-123',
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    ...overrides,
  }
}

beforeEach(async () => {
  await db.cards.clear()
})

// ── Round-trip ───────────────────────────────────────────────────────────────

describe('exportBackup', () => {
  it('exports an empty database', async () => {
    const file = await exportBackup()
    expect(file.app).toBe('walleo')
    expect(file.version).toBeGreaterThanOrEqual(1)
    expect(file.cards).toHaveLength(0)
    expect(typeof file.exportedAt).toBe('string')
  })

  it('exports all cards', async () => {
    const c1 = makeCard({ id: 'c1', name: 'Carrefour' })
    const c2 = makeCard({ id: 'c2', name: 'Decathlon', type: 'event' })
    await db.cards.bulkAdd([c1, c2])

    const file = await exportBackup()
    expect(file.cards).toHaveLength(2)
    const names = file.cards.map((c) => c.name)
    expect(names).toContain('Carrefour')
    expect(names).toContain('Decathlon')
  })
})

describe('importBackup — strategy "replace"', () => {
  it('replaces existing DB content with backup cards', async () => {
    // Pre-populate the DB with an existing card
    await db.cards.add(makeCard({ id: 'old-card', name: 'Old Card' }))
    expect(await db.cards.count()).toBe(1)

    // Build a backup with 2 different cards
    const c1 = makeCard({ id: 'new-1', name: 'New Card A' })
    const c2 = makeCard({ id: 'new-2', name: 'New Card B' })
    await db.cards.clear()
    await db.cards.bulkAdd([c1, c2])
    const file = await exportBackup()

    // Re-add the old card to simulate the DB state before import
    await db.cards.clear()
    await db.cards.add(makeCard({ id: 'old-card', name: 'Old Card' }))

    // Import with replace strategy
    const result = await importBackup(file, 'replace')
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)

    const allCards = await db.cards.toArray()
    expect(allCards).toHaveLength(2)
    const names = allCards.map((c) => c.name)
    expect(names).toContain('New Card A')
    expect(names).toContain('New Card B')
    expect(names).not.toContain('Old Card')
  })

  it('round-trip: export → clear → import → identical records', async () => {
    const cards = [
      makeCard({ id: 'rt-1', name: 'Alpha' }),
      makeCard({ id: 'rt-2', name: 'Beta', type: 'event', eventDate: '2026-06-01T20:00:00.000Z' }),
      makeCard({ id: 'rt-3', name: 'Gamma', barcodeFormat: 'EAN13', barcodeValue: '9780201379624' }),
    ]
    await db.cards.bulkAdd(cards)

    const file = await exportBackup()
    await db.cards.clear()
    await importBackup(file, 'replace')

    const restored = await db.cards.orderBy('id').toArray()
    expect(restored).toHaveLength(3)
    expect(restored.map((c) => c.name).sort()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(restored.find((c) => c.id === 'rt-2')?.eventDate).toBe('2026-06-01T20:00:00.000Z')
  })
})

describe('importBackup — strategy "merge"', () => {
  it('skips cards already present (same id)', async () => {
    const existing = makeCard({ id: 'shared-id', name: 'Original Name' })
    await db.cards.add(existing)

    // Build backup that contains the same id + a new one
    await db.cards.clear()
    await db.cards.bulkAdd([
      { ...existing, name: 'Should Be Skipped' },
      makeCard({ id: 'new-one', name: 'New One' }),
    ])
    const file = await exportBackup()

    // Restore original state
    await db.cards.clear()
    await db.cards.add(existing)

    const result = await importBackup(file, 'merge')
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)

    const all = await db.cards.toArray()
    expect(all).toHaveLength(2)
    // Original name must be preserved (not overwritten)
    expect(all.find((c) => c.id === 'shared-id')?.name).toBe('Original Name')
    expect(all.find((c) => c.id === 'new-one')?.name).toBe('New One')
  })
})

// ── Guard: schema validation ─────────────────────────────────────────────────

describe('importBackup — guard cases', () => {
  it('throws when app !== "walleo"', async () => {
    const file = await exportBackup()
    // Manually corrupt the app field — cast through unknown to bypass TS type check
    const corrupted = {
      ...file,
      app: 'other',
    } as unknown as Parameters<typeof importBackup>[0]
    await expect(importBackup(corrupted, 'replace')).rejects.toThrow(
      /pas un backup Walleo/i,
    )
  })

  it('throws when version is newer than the app supports', async () => {
    const file = await exportBackup()
    const future = { ...file, version: 9999 }
    await expect(importBackup(future, 'replace')).rejects.toThrow(
      /version.*non support/i,
    )
  })

  it('throws when cards array exceeds 10 000', async () => {
    const file = await exportBackup()
    const huge = {
      ...file,
      // Cast via unknown — we're intentionally sending malformed data to test
      // the guard. The cards here are Card objects, not SerializedCard, but
      // assertValidBackup only inspects id/type/brandColor fields which exist.
      cards: Array.from({ length: 10_001 }, (_, i) =>
        makeCard({ id: `bulk-${i}`, name: `Card ${i}` }),
      ),
    } as unknown as Parameters<typeof importBackup>[0]
    await expect(importBackup(huge, 'replace')).rejects.toThrow(
      /trop volumineux/i,
    )
  })

  it('throws when a card has an invalid brandColor', async () => {
    const file = await exportBackup()
    const bad = {
      ...file,
      cards: [
        {
          ...makeCard({ id: 'bad-color' }),
          brandColor: 'notahex',
        },
      ],
    } as unknown as Parameters<typeof importBackup>[0]
    await expect(importBackup(bad, 'replace')).rejects.toThrow(
      /brandColor/i,
    )
  })

  it('throws when a card has an unknown type', async () => {
    const file = await exportBackup()
    const bad = {
      ...file,
      cards: [
        {
          ...makeCard({ id: 'bad-type' }),
          // Intentionally wrong type to test the guard
          type: 'membership' as unknown as 'loyalty',
        },
      ],
    } as unknown as Parameters<typeof importBackup>[0]
    await expect(importBackup(bad, 'replace')).rejects.toThrow(
      /type de carte inconnu/i,
    )
  })
})

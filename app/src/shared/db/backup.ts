import { db } from './db'
import type { Card, Ticket } from './types'

const BACKUP_VERSION = 2

interface SerializedPkpass {
  dataUrl: string
  type: string
}

interface SerializedTicket extends Omit<Ticket, 'originalPkpassBlob'> {
  originalPkpassBlob?: SerializedPkpass
}

interface SerializedCard
  extends Omit<Card, 'originalPkpassBlob' | 'tickets'> {
  originalPkpassBlob?: SerializedPkpass
  tickets?: SerializedTicket[]
}

export interface BackupFile {
  version: number
  exportedAt: string
  app: 'walleo'
  cards: SerializedCard[]
}

export async function exportBackup(): Promise<BackupFile> {
  const cards = await db.cards.toArray()
  const serialized = await Promise.all(cards.map(serializeCard))
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'walleo',
    cards: serialized,
  }
}

async function serializeCard(c: Card): Promise<SerializedCard> {
  const { originalPkpassBlob, tickets, ...rest } = c
  const out: SerializedCard = { ...rest }
  if (originalPkpassBlob) {
    out.originalPkpassBlob = await serializeBlob(originalPkpassBlob)
  }
  if (tickets) {
    out.tickets = await Promise.all(tickets.map(serializeTicket))
  }
  return out
}

async function serializeTicket(t: Ticket): Promise<SerializedTicket> {
  const { originalPkpassBlob, ...rest } = t
  if (!originalPkpassBlob) return rest
  return { ...rest, originalPkpassBlob: await serializeBlob(originalPkpassBlob) }
}

async function serializeBlob(blob: Blob): Promise<SerializedPkpass> {
  return {
    dataUrl: await blobToDataUrl(blob),
    type: blob.type || 'application/vnd.apple.pkpass',
  }
}

export interface ImportResult {
  imported: number
  skipped: number
}

export async function importBackup(
  file: BackupFile,
  strategy: 'replace' | 'merge',
): Promise<ImportResult> {
  if (file.app !== 'walleo' || typeof file.version !== 'number') {
    throw new Error('Fichier non reconnu (pas un backup Walleo).')
  }
  if (file.version > BACKUP_VERSION) {
    throw new Error(
      `Backup version ${file.version} non supportée par cette version de l'app.`,
    )
  }

  const restored = await Promise.all(file.cards.map(deserializeCard))

  if (strategy === 'replace') {
    await db.cards.clear()
    await db.cards.bulkAdd(restored)
    return { imported: restored.length, skipped: 0 }
  }

  const existingIds = new Set(await db.cards.toCollection().primaryKeys())
  const fresh = restored.filter((c) => !existingIds.has(c.id))
  await db.cards.bulkAdd(fresh)
  return { imported: fresh.length, skipped: restored.length - fresh.length }
}

async function deserializeCard(s: SerializedCard): Promise<Card> {
  const { originalPkpassBlob, tickets, ...rest } = s
  const out: Card = { ...(rest as Card) }
  if (originalPkpassBlob) {
    out.originalPkpassBlob = await deserializeBlob(originalPkpassBlob)
  }
  if (tickets) {
    out.tickets = await Promise.all(tickets.map(deserializeTicket))
  }
  return out
}

async function deserializeTicket(s: SerializedTicket): Promise<Ticket> {
  const { originalPkpassBlob, ...rest } = s
  if (!originalPkpassBlob) return rest
  return { ...rest, originalPkpassBlob: await deserializeBlob(originalPkpassBlob) }
}

async function deserializeBlob(s: SerializedPkpass): Promise<Blob> {
  const response = await fetch(s.dataUrl)
  const buffer = await response.arrayBuffer()
  return new Blob([buffer], { type: s.type })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

export function downloadBackup(file: BackupFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const date = new Date().toISOString().slice(0, 10)
  const a = document.createElement('a')
  a.href = url
  a.download = `walleo-backup-${date}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

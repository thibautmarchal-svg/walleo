import { db } from './db'
import type { Attachment, Card, Ticket } from './types'

const BACKUP_VERSION = 3

interface SerializedPkpass {
  dataUrl: string
  type: string
}

interface SerializedAttachment extends Omit<Attachment, 'blob'> {
  dataUrl: string
}

interface SerializedTicket extends Omit<Ticket, 'originalPkpassBlob'> {
  originalPkpassBlob?: SerializedPkpass
}

interface SerializedCard
  extends Omit<Card, 'originalPkpassBlob' | 'tickets' | 'attachments'> {
  originalPkpassBlob?: SerializedPkpass
  tickets?: SerializedTicket[]
  attachments?: SerializedAttachment[]
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
  const { originalPkpassBlob, tickets, attachments, ...rest } = c
  const out: SerializedCard = { ...rest }
  if (originalPkpassBlob) {
    out.originalPkpassBlob = await serializeBlob(originalPkpassBlob)
  }
  if (tickets) {
    out.tickets = await Promise.all(tickets.map(serializeTicket))
  }
  if (attachments && attachments.length > 0) {
    out.attachments = await Promise.all(attachments.map(serializeAttachment))
  }
  return out
}

async function serializeAttachment(
  a: Attachment,
): Promise<SerializedAttachment> {
  const { blob, ...rest } = a
  return { ...rest, dataUrl: await blobToDataUrl(blob) }
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

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/
const MAX_BACKUP_CARDS = 10_000

function assertValidBackup(file: unknown): asserts file is BackupFile {
  if (
    !file ||
    typeof file !== 'object' ||
    (file as BackupFile).app !== 'walleo' ||
    typeof (file as BackupFile).version !== 'number' ||
    !Array.isArray((file as BackupFile).cards)
  ) {
    throw new Error('Fichier non reconnu (pas un backup Walleo).')
  }
  const cards = (file as BackupFile).cards
  if (cards.length > MAX_BACKUP_CARDS) {
    throw new Error(
      `Backup trop volumineux (${cards.length} cartes, max ${MAX_BACKUP_CARDS}).`,
    )
  }
  for (const c of cards) {
    if (!c || typeof c !== 'object') {
      throw new Error('Backup invalide : carte mal formée.')
    }
    if (typeof c.id !== 'string' || c.id.length === 0) {
      throw new Error('Backup invalide : id de carte manquant.')
    }
    if (c.type !== 'loyalty' && c.type !== 'event') {
      throw new Error(`Backup invalide : type de carte inconnu (${c.type}).`)
    }
    if (typeof c.brandColor !== 'string' || !HEX_COLOR_RE.test(c.brandColor)) {
      throw new Error(
        `Backup invalide : brandColor non-hex (${c.brandColor}).`,
      )
    }
  }
}

export async function importBackup(
  file: BackupFile,
  strategy: 'replace' | 'merge',
): Promise<ImportResult> {
  assertValidBackup(file)
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
  const { originalPkpassBlob, tickets, attachments, ...rest } = s
  const out: Card = { ...(rest as Card) }
  if (originalPkpassBlob) {
    out.originalPkpassBlob = await deserializeBlob(originalPkpassBlob)
  }
  if (tickets) {
    out.tickets = await Promise.all(tickets.map(deserializeTicket))
  }
  if (attachments && attachments.length > 0) {
    out.attachments = await Promise.all(
      attachments.map(deserializeAttachment),
    )
  }
  return out
}

async function deserializeAttachment(
  s: SerializedAttachment,
): Promise<Attachment> {
  const { dataUrl, ...rest } = s
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('Backup invalide : pièce jointe non-data:.')
  }
  const response = await fetch(dataUrl)
  const buffer = await response.arrayBuffer()
  return { ...rest, blob: new Blob([buffer], { type: rest.mimeType }) }
}

async function deserializeTicket(s: SerializedTicket): Promise<Ticket> {
  const { originalPkpassBlob, ...rest } = s
  if (!originalPkpassBlob) return rest
  return { ...rest, originalPkpassBlob: await deserializeBlob(originalPkpassBlob) }
}

async function deserializeBlob(s: SerializedPkpass): Promise<Blob> {
  // Strict scheme guard — without this, a malicious backup could put
  // an http(s):// URL in dataUrl and `fetch` would happily make an
  // outbound request, leaking which device imported the backup and
  // breaking the "no data leaves the device" rule.
  if (typeof s.dataUrl !== 'string' || !s.dataUrl.startsWith('data:')) {
    throw new Error('Backup invalide : URL de pièce jointe non-data:.')
  }
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

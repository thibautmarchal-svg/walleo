import { db } from './db'
import type { Card } from './types'

const BACKUP_VERSION = 1

interface SerializedCard extends Omit<Card, 'originalPkpassBlob'> {
  originalPkpassBlob?: { dataUrl: string; type: string }
}

export interface BackupFile {
  version: number
  exportedAt: string
  app: 'walleo'
  cards: SerializedCard[]
}

export async function exportBackup(): Promise<BackupFile> {
  const cards = await db.cards.toArray()
  const serialized = await Promise.all(
    cards.map(async (c): Promise<SerializedCard> => {
      const { originalPkpassBlob, ...rest } = c
      if (!originalPkpassBlob) return rest
      const dataUrl = await blobToDataUrl(originalPkpassBlob)
      return {
        ...rest,
        originalPkpassBlob: {
          dataUrl,
          type: originalPkpassBlob.type || 'application/vnd.apple.pkpass',
        },
      }
    }),
  )
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'walleo',
    cards: serialized,
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

  const restored = await Promise.all(
    file.cards.map(async (c): Promise<Card> => {
      const { originalPkpassBlob, ...rest } = c
      if (!originalPkpassBlob) return rest as Card
      const blob = await dataUrlToBlob(
        originalPkpassBlob.dataUrl,
        originalPkpassBlob.type,
      )
      return { ...(rest as Card), originalPkpassBlob: blob }
    }),
  )

  if (strategy === 'replace') {
    await db.cards.clear()
    await db.cards.bulkAdd(restored)
    return { imported: restored.length, skipped: 0 }
  }

  // merge — skip cards whose ID already exists locally
  const existingIds = new Set(await db.cards.toCollection().primaryKeys())
  const fresh = restored.filter((c) => !existingIds.has(c.id))
  await db.cards.bulkAdd(fresh)
  return { imported: fresh.length, skipped: restored.length - fresh.length }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string, type: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  const buffer = await response.arrayBuffer()
  return new Blob([buffer], { type })
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

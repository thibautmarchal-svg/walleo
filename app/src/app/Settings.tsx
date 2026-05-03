import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Database,
  Download,
  HardDrive,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCardsStore } from '@/features/cards/store'
import {
  downloadBackup,
  exportBackup,
  importBackup,
  type BackupFile,
} from '@/shared/db/backup'
import { db } from '@/shared/db/db'

interface StorageStats {
  cards: number
  usageMB?: number
  quotaMB?: number
}

type ActionStatus =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

export function Settings() {
  const navigate = useNavigate()
  const cards = useCardsStore((s) => s.cards)
  const loadAll = useCardsStore((s) => s.loadAll)
  const [stats, setStats] = useState<StorageStats>({ cards: cards.length })
  const [status, setStatus] = useState<ActionStatus>({ kind: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const collect = async (): Promise<void> => {
      const next: StorageStats = { cards: cards.length }
      if ('storage' in navigator && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate()
          if (est.usage !== undefined) next.usageMB = est.usage / 1024 / 1024
          if (est.quota !== undefined) next.quotaMB = est.quota / 1024 / 1024
        } catch {
          // ignore
        }
      }
      setStats(next)
    }
    void collect()
  }, [cards.length])

  const onExport = async (): Promise<void> => {
    setStatus({ kind: 'idle' })
    try {
      const file = await exportBackup()
      downloadBackup(file)
      setStatus({
        kind: 'success',
        message: `${file.cards.length} cartes exportées.`,
      })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Échec de l\'export.',
      })
    }
  }

  const onImportClick = (): void => fileRef.current?.click()

  const onImportFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setStatus({ kind: 'idle' })
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as BackupFile
      const choice = window.prompt(
        'Tape "remplacer" pour écraser toutes tes cartes locales, ou "fusionner" pour ajouter celles qui ne sont pas déjà présentes.',
        'fusionner',
      )
      if (choice === null) return
      const strategy =
        choice.trim().toLowerCase().startsWith('rem') ? 'replace' : 'merge'
      const result = await importBackup(parsed, strategy)
      await loadAll()
      setStatus({
        kind: 'success',
        message:
          strategy === 'replace'
            ? `Base remplacée : ${result.imported} cartes importées.`
            : `${result.imported} cartes ajoutées (${result.skipped} déjà présentes).`,
      })
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Impossible d\'importer ce fichier.',
      })
    }
  }

  const onReset = async (): Promise<void> => {
    const confirmation = window.prompt(
      'Cette action supprime TOUTES tes cartes localement. Tape "EFFACER" pour confirmer.',
      '',
    )
    if (confirmation !== 'EFFACER') return
    await db.cards.clear()
    await loadAll()
    setStatus({ kind: 'success', message: 'Toutes les cartes ont été supprimées.' })
  }

  return (
    <div className="min-h-full bg-background">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Retour"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold">Paramètres</h1>
      </header>

      <main
        className="space-y-6 px-5 py-6"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        <Section title="Stockage local">
          <Row icon={<Database className="h-4 w-4" />} label="Cartes">
            <span className="font-mono text-sm">{stats.cards}</span>
          </Row>
          {stats.usageMB !== undefined && (
            <Row icon={<HardDrive className="h-4 w-4" />} label="Utilisé">
              <span className="font-mono text-sm">
                {stats.usageMB.toFixed(2)} Mo
                {stats.quotaMB ? ` / ${stats.quotaMB.toFixed(0)} Mo` : ''}
              </span>
            </Row>
          )}
        </Section>

        <Section title="Sauvegarde">
          <p className="text-xs text-muted-foreground">
            Exporte un fichier JSON contenant toutes tes cartes et leurs
            éventuels <code className="font-mono">.pkpass</code> d'origine.
            Ré-importe-le sur un autre appareil pour récupérer ta base.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onExport}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-walleo-yellow px-4 py-3 text-sm font-semibold text-walleo-black active:scale-95"
            >
              <Download className="h-4 w-4" />
              Exporter (JSON)
            </button>
            <button
              type="button"
              onClick={onImportClick}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-semibold text-foreground active:scale-95"
            >
              <Upload className="h-4 w-4" />
              Importer (JSON)
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={onImportFile}
            />
          </div>
        </Section>

        <Section title="Zone dangereuse">
          <p className="text-xs text-muted-foreground">
            Supprime toutes les cartes localement. Aucune sauvegarde
            automatique — exporte d'abord.
          </p>
          <button
            type="button"
            onClick={onReset}
            className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
            Tout effacer
          </button>
        </Section>

        {status.kind === 'success' && (
          <p className="rounded-xl border border-walleo-yellow/40 bg-walleo-yellow/10 px-4 py-3 text-sm text-walleo-yellow">
            {status.message}
          </p>
        )}
        {status.kind === 'error' && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {status.message}
          </p>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          Walleo · 100 % local · v0.1
        </p>
      </main>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </div>
  )
}

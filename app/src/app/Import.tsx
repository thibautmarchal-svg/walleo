import { useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
  Mail,
  Paperclip,
  Wallet,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import {
  parseEventText,
  type ParseResult,
  type ProviderId,
} from '@/features/parser/parseEvent'
import {
  parsePdfFile,
  validatePkpassBlob,
  type PdfPageBarcode,
  type PdfProgressPhase,
} from '@/features/pdf-import/parsePdf'
import type { CardSource, Ticket } from '@/shared/db/types'

type Mode = 'email' | 'pdf'

interface PreviewState {
  result: ParseResult
  source: CardSource
  pkpassBlob?: Blob
  /** Raw text fed into the parser — exposed via a debug toggle so the
   *  user can see exactly what pdfjs / the email body produced. */
  rawText: string
  /** Only set in PDF mode. */
  numPages?: number
  ocrUsed?: boolean
  perPageBarcodes?: PdfPageBarcode[]
}

interface ParseProgress {
  current: number
  total: number
  phase: PdfProgressPhase
}

const PHASE_LABELS: Record<PdfProgressPhase, string> = {
  load: 'Chargement du module PDF',
  'extract-text': 'Lecture du texte',
  render: 'Rendu de la page',
  ocr: 'Lecture OCR',
  barcode: 'Code-barres',
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  ticketmaster: 'Ticketmaster',
  fnac: 'FNAC Spectacles',
  seeTickets: 'See Tickets',
  eventim: 'Eventim',
  sncf: 'SNCF Connect',
  'comedie-francaise': 'Comédie-Française',
  unknown: 'Format inconnu',
}

export function Import() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('email')
  const [emailText, setEmailText] = useState('')
  const [pkpassBlob, setPkpassBlob] = useState<Blob | undefined>(undefined)
  const [pkpassError, setPkpassError] = useState<string | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState<ParseProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const pkpassRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)

  const onPkpassFile = async (
    e: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setPkpassError(null)
    const ok = await validatePkpassBlob(f)
    if (!ok) {
      setPkpassError('Ce fichier ne ressemble pas à un .pkpass valide.')
      return
    }
    setPkpassBlob(f)
  }

  const onPdfFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) setPdfFile(f)
  }

  const onParse = async (): Promise<void> => {
    setError(null)
    setPreview(null)
    setProgress(null)
    setParsing(true)
    try {
      if (mode === 'email') {
        if (!emailText.trim()) {
          setError('Colle le texte de ton email.')
          return
        }
        const result = parseEventText(emailText)
        console.info(
          `[walleo] Email parsed: ${emailText.length} chars, provider=${result.provider}, ${result.tickets.length} tickets`,
        )
        setPreview({
          result,
          source: 'email',
          pkpassBlob,
          rawText: emailText,
        })
      } else {
        if (!pdfFile) {
          setError('Choisis un PDF.')
          return
        }
        const pdf = await parsePdfFile(pdfFile, {
          onProgress: (current, total, phase) =>
            setProgress({ current, total, phase }),
        })
        console.info(
          `[walleo] PDF parsed: ${pdf.numPages} pages, ${pdf.text.length} chars text, ${pdf.attachments.length} attachments, ocrUsed=${pdf.ocrUsed}, ${pdf.perPageBarcodes.length} barcodes`,
        )
        const result = parseEventText(pdf.text)
        console.info(
          `[walleo] Heuristics: provider=${result.provider}, ${result.tickets.length} tickets, event=${JSON.stringify(result.event)}`,
        )
        const pkpassAtt = pdf.attachments.find((a) => a.isPkpass)
        setPreview({
          result,
          source: 'pdf',
          pkpassBlob: pkpassAtt?.blob,
          rawText: pdf.text,
          numPages: pdf.numPages,
          ocrUsed: pdf.ocrUsed,
          perPageBarcodes: pdf.perPageBarcodes,
        })
      }
    } catch (e) {
      console.error('[walleo] Import parse failed', e)
      setError(
        e instanceof Error
          ? `Échec de l'analyse : ${e.message}`
          : "Erreur d'analyse.",
      )
    } finally {
      setProgress(null)
      setParsing(false)
    }
  }

  const onConfirm = (): void => {
    if (!preview) return
    const { result, source, pkpassBlob: pkpass, perPageBarcodes } = preview

    // Build the ticket list. Priority order:
    //   1. perPageBarcodes from PDF render+OCR fallback — each PDF page
    //      that yielded a barcode becomes one ticket. Holder/seat are
    //      filled from the heuristics if a parsed ticket exists at the
    //      same index.
    //   2. parseEventText heuristics on the raw text — when the text
    //      layer worked.
    //   3. pkpass-only ticket — if we have a Wallet pass but no barcode.
    const tickets: Ticket[] = (() => {
      if (perPageBarcodes && perPageBarcodes.length > 0) {
        return perPageBarcodes.map((bc, i) => {
          const meta = result.tickets[i]
          return {
            id: nanoid(),
            barcodeFormat: bc.format,
            barcodeValue: bc.value,
            holderName: meta?.holderName,
            seat: meta?.seat,
            ...(i === 0 && pkpass
              ? {
                  hasOriginalPkpass: true,
                  originalPkpassBlob: pkpass,
                }
              : {}),
          }
        })
      }
      if (result.tickets.length > 0) {
        return result.tickets.map((t, i) => ({
          id: nanoid(),
          barcodeFormat: t.barcodeFormat ?? 'NONE',
          barcodeValue: t.barcodeValue ?? '',
          holderName: t.holderName,
          seat: t.seat,
          ...(i === 0 && pkpass
            ? {
                hasOriginalPkpass: true,
                originalPkpassBlob: pkpass,
              }
            : {}),
        }))
      }
      if (pkpass) {
        return [
          {
            id: nanoid(),
            barcodeFormat: 'NONE' as const,
            barcodeValue: '',
            hasOriginalPkpass: true,
            originalPkpassBlob: pkpass,
          },
        ]
      }
      return []
    })()

    navigate('/add', {
      state: {
        prefill: {
          type: 'event',
          name: result.event.name,
          eventDate: result.event.date,
          venue: result.event.venue,
          organizer: result.event.organizer,
          tickets,
          source,
        },
      },
    })
  }

  return (
    <div className="min-h-full bg-background">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold">Importer un email / PDF</h1>
      </header>

      <main
        className="space-y-5 px-5 py-6"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        {/* Mode tabs */}
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={mode === 'email'}
            onClick={() => setMode('email')}
            icon={<Mail className="h-4 w-4" />}
            label="Email (texte)"
          />
          <ModeButton
            active={mode === 'pdf'}
            onClick={() => setMode('pdf')}
            icon={<FileText className="h-4 w-4" />}
            label="PDF"
          />
        </div>

        {mode === 'email' && (
          <>
            <label className="block">
              <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Texte de l'email
              </span>
              <textarea
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                placeholder="Colle ici le texte complet du mail Ticketmaster, FNAC, See Tickets…"
                rows={10}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-3 font-mono text-xs outline-none focus:border-walleo-yellow"
              />
            </label>

            <div className="rounded-2xl border border-dashed border-border bg-secondary/40 p-4">
              <p className="text-sm font-medium">
                Pièce jointe <code className="font-mono">.pkpass</code>{' '}
                <span className="text-xs text-muted-foreground">
                  (optionnel)
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Si l'email contient un fichier <code>.pkpass</code> en pièce
                jointe, ajoute-le ici pour pouvoir le ré-injecter dans Apple
                Wallet plus tard.
              </p>
              <button
                type="button"
                onClick={() => pkpassRef.current?.click()}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-2 text-xs font-semibold transition active:scale-95"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {pkpassBlob ? 'Remplacer le .pkpass' : 'Joindre un .pkpass'}
              </button>
              <input
                ref={pkpassRef}
                type="file"
                accept=".pkpass,application/vnd.apple.pkpass"
                hidden
                onChange={onPkpassFile}
              />
              {pkpassBlob && !pkpassError && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-walleo-yellow">
                  <Wallet className="h-3.5 w-3.5" />
                  pkpass joint ({(pkpassBlob.size / 1024).toFixed(0)} Ko).
                </p>
              )}
              {pkpassError && (
                <p className="mt-2 text-xs text-destructive">{pkpassError}</p>
              )}
            </div>
          </>
        )}

        {mode === 'pdf' && (
          <div className="rounded-2xl border border-dashed border-border bg-secondary/40 p-4">
            <p className="text-sm font-medium">Choisir un PDF</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Walleo extrait le texte (date, lieu, places…) et détecte
              automatiquement les <code>.pkpass</code> en pièces jointes.
            </p>
            <button
              type="button"
              onClick={() => pdfRef.current?.click()}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-walleo-yellow px-4 py-2 text-xs font-semibold text-walleo-black transition active:scale-95"
            >
              <FileText className="h-3.5 w-3.5" />
              {pdfFile ? 'Changer de PDF' : 'Choisir un PDF'}
            </button>
            <input
              ref={pdfRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={onPdfFile}
            />
            {pdfFile && (
              <p className="mt-2 text-xs text-muted-foreground">
                {pdfFile.name} · {(pdfFile.size / 1024 / 1024).toFixed(2)} Mo
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onParse}
          disabled={
            parsing ||
            (mode === 'email' && !emailText.trim()) ||
            (mode === 'pdf' && !pdfFile)
          }
          className="flex w-full items-center justify-center gap-2 rounded-full bg-walleo-yellow px-5 py-3 text-sm font-semibold text-walleo-black shadow-2xl shadow-walleo-yellow/30 transition active:scale-95 disabled:opacity-40"
        >
          {parsing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress
                ? `${PHASE_LABELS[progress.phase]} ${progress.current}/${progress.total}…`
                : 'Analyse en cours…'}
            </>
          ) : (
            <>Analyser</>
          )}
        </button>

        {error && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {preview && (
          <Preview
            preview={preview}
            providerLabel={
              PROVIDER_LABELS[preview.result.provider] ?? 'Inconnu'
            }
            onConfirm={onConfirm}
          />
        )}
      </main>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition ${
        active
          ? 'border-walleo-yellow bg-walleo-yellow/10 text-walleo-yellow'
          : 'border-border bg-secondary text-secondary-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function Preview({
  preview,
  providerLabel,
  onConfirm,
}: {
  preview: PreviewState
  providerLabel: string
  onConfirm: () => void
}) {
  const { result, pkpassBlob } = preview
  const e = result.event
  const fmtDate = e.date
    ? new Date(e.date).toLocaleString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Résultat
        </h2>
        <span className="rounded-full bg-walleo-yellow/15 px-2.5 py-0.5 text-[11px] font-medium text-walleo-yellow">
          {providerLabel}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <PreviewRow label="Événement" value={e.name} />
        <PreviewRow label="Date" value={fmtDate ?? undefined} />
        <PreviewRow label="Lieu" value={e.venue} />
        <PreviewRow label="Émetteur" value={e.organizer} />
        <PreviewRow
          label="Billets"
          value={
            result.tickets.length > 0
              ? `${result.tickets.length} billet${result.tickets.length > 1 ? 's' : ''}`
              : 'Aucun (à ajouter à la main)'
          }
        />
        {pkpassBlob && (
          <PreviewRow
            label=".pkpass"
            value={`Joint (${(pkpassBlob.size / 1024).toFixed(0)} Ko)`}
          />
        )}
      </div>

      {result.tickets.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {result.tickets.slice(0, 6).map((t, i) => (
            <p
              key={i}
              className="rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="font-mono text-foreground">#{i + 1}</span>{' '}
              {t.holderName ?? '—'} · {t.seat ?? '—'}
            </p>
          ))}
          {result.tickets.length > 6 && (
            <p className="text-xs text-muted-foreground">
              + {result.tickets.length - 6} autres billets…
            </p>
          )}
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {result.warnings.map((w, i) => (
            <p
              key={i}
              className="text-xs text-muted-foreground"
            >
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
          Voir le texte extrait ({preview.rawText.length} caractères
          {preview.numPages !== undefined ? `, ${preview.numPages} pages` : ''})
        </summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {preview.rawText.trim() ||
            "(aucun texte — ce PDF est peut-être une image scannée sans couche de texte)"}
        </pre>
      </details>

      <button
        type="button"
        onClick={onConfirm}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-walleo-yellow px-5 py-3 text-sm font-semibold text-walleo-black transition active:scale-95"
      >
        Vérifier puis enregistrer
        <ArrowRight className="h-4 w-4" />
      </button>
    </section>
  )
}

function PreviewRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-right text-sm font-medium ${value ? '' : 'text-muted-foreground/60'}`}
      >
        {value ?? '—'}
      </span>
    </div>
  )
}


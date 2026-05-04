/**
 * Generic event-text parser. Works on:
 *   - Pasted email body text
 *   - Text extracted from a PDF
 *   - Tesseract OCR output of a ticket photo
 *
 * Strategy
 *   1. Detect the provider via signatures (sender, mentions, references).
 *   2. Extract event-wide metadata (name, date, venue, organizer).
 *   3. Try to split the text into per-ticket blocks (markers: "Billet 1",
 *      "Ticket 1", "Pass 1", or repeated "Bloc/Rang/Place" patterns).
 *   4. For each block, extract holder + seat + best-effort barcode value.
 *
 * Heuristics are deliberately conservative — they only fill a field when
 * the pattern is unambiguous, so the form pre-fill never overwrites real
 * user input with garbage.
 */

import type { BarcodeFormat } from '@/shared/db/types'

export type ProviderId =
  | 'ticketmaster'
  | 'fnac'
  | 'seeTickets'
  | 'eventim'
  | 'sncf'
  | 'comedie-francaise'
  | 'unknown'

export interface ParsedEvent {
  name?: string
  /** Local datetime "YYYY-MM-DDTHH:mm" ready for <input type="datetime-local"> */
  date?: string
  venue?: string
  organizer?: string
}

export interface ParsedTicket {
  holderName?: string
  seat?: string
  /** Numeric reference / barcode value if it appears in plain text */
  barcodeValue?: string
  barcodeFormat?: BarcodeFormat
}

export interface ParseResult {
  provider: ProviderId
  /** Approximate confidence in 0-1 — fraction of fields we could fill. */
  confidence: number
  event: ParsedEvent
  tickets: ParsedTicket[]
  warnings: string[]
}

// ─────────────────────── Provider detection ───────────────────────

const PROVIDER_SIGNATURES: Array<{ id: ProviderId; patterns: RegExp[] }> = [
  {
    id: 'ticketmaster',
    patterns: [/ticketmaster\.(fr|com|de|be)/i, /ticketmaster/i],
  },
  {
    id: 'fnac',
    patterns: [
      /fnacspectacles\.com/i,
      /\bFNAC\s+Spectacles?\b/i,
      /\bN°\s+(?:de\s+)?dossier\s*[:#]\s*\d{6,}/i,
    ],
  },
  {
    id: 'seeTickets',
    patterns: [/seetickets\.(fr|com|be)/i, /\bSee\s+Tickets\b/i],
  },
  {
    id: 'eventim',
    patterns: [/eventim\.[a-z]{2,3}/i, /\bEventim\b/i, /\bBestellnummer\b/i],
  },
  {
    id: 'sncf',
    patterns: [
      /sncf-?connect\.com/i,
      /\bSNCF(?:\s+Connect)?\b/i,
      /\bTGV\s+INOUI\b/i,
    ],
  },
  {
    id: 'comedie-francaise',
    patterns: [/comedie-francaise\.fr/i, /\bComédie[-\s]?Française\b/i],
  },
]

export function detectProvider(text: string): ProviderId {
  for (const { id, patterns } of PROVIDER_SIGNATURES) {
    if (patterns.some((p) => p.test(text))) return id
  }
  return 'unknown'
}

// ─────────────────────── Public entry point ───────────────────────

function safe<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    console.warn(`[walleo/parser] ${label} failed`, err)
    return fallback
  }
}

export function parseEventText(text: string): ParseResult {
  const provider = safe('detectProvider', () => detectProvider(text), 'unknown' as ProviderId)
  const event = safe('extractEvent', () => extractEvent(text, provider), {})
  const tickets = safe('extractTickets', () => extractTickets(text, provider), [])
  const warnings: string[] = []

  // Clean up: if we got NO event metadata AND no tickets, surface a warning
  const eventScore =
    (event.name ? 1 : 0) +
    (event.date ? 1 : 0) +
    (event.venue ? 1 : 0) +
    (event.organizer ? 1 : 0)
  const ticketsScore = tickets.length > 0 ? 2 : 0
  const totalScore = eventScore + ticketsScore // out of 6

  if (totalScore === 0) {
    warnings.push(
      "Aucune info reconnue automatiquement. Vérifie ou complète à la main.",
    )
  } else if (totalScore < 2) {
    warnings.push(
      'Peu d\'infos détectées. Pense à vérifier avant de sauvegarder.',
    )
  }

  return {
    provider,
    confidence: totalScore / 6,
    event,
    tickets,
    warnings,
  }
}

// ─────────────────────── Event-level extraction ───────────────────────

function extractEvent(text: string, provider: ProviderId): ParsedEvent {
  return {
    name: extractEventName(text, provider),
    date: extractDate(text),
    venue: extractVenue(text),
    organizer: extractOrganizer(text, provider),
  }
}

const FR_MONTHS: Record<string, number> = {
  janvier: 0,
  janv: 0,
  février: 1,
  fevrier: 1,
  févr: 1,
  fevr: 1,
  mars: 2,
  avril: 3,
  avr: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  juil: 6,
  août: 7,
  aout: 7,
  septembre: 8,
  sept: 8,
  octobre: 9,
  oct: 9,
  novembre: 10,
  nov: 10,
  décembre: 11,
  decembre: 11,
  déc: 11,
  dec: 11,
}

const EN_MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

const KNOWN_VENUES = [
  'Stade de France',
  'Parc des Princes',
  'AccorHotels Arena',
  'Accor Arena',
  'Bercy',
  'Olympia',
  'Zénith de Paris',
  'Zénith',
  'Casino de Paris',
  'Comédie-Française',
  'Salle Richelieu',
  'Opéra Bastille',
  'Opéra Garnier',
  'Salle Pleyel',
  'Théâtre du Châtelet',
  'Théâtre de la Ville',
  "Théâtre de l'Atelier",
  'La Cigale',
  'Le Bataclan',
  'Le Trianon',
  'Élysée Montmartre',
  'Forest National',
  'Cirque Royal',
  'Palais 12',
  'Ancienne Belgique',
  'Sportpaleis',
  'Lotto Arena',
  'Vorst Nationaal',
  'Halle Tony Garnier',
  'Stade Pierre Mauroy',
  'Arena Lille',
  'Arkéa Arena',
  'Stade Vélodrome',
  'Allianz Riviera',
  'Groupama Stadium',
  'Matmut Atlantique',
  "Cité Internationale Universitaire",
]

const PROVIDER_LABELS: Record<ProviderId, string | undefined> = {
  ticketmaster: 'Ticketmaster',
  fnac: 'FNAC Spectacles',
  seeTickets: 'See Tickets',
  eventim: 'Eventim',
  sncf: 'SNCF Connect',
  'comedie-francaise': 'Comédie-Française',
  unknown: undefined,
}

function extractDate(text: string): string | undefined {
  // Strip "Date de commande : <date>" (and English equivalent) — that's
  // the ORDER date, not the EVENT date. Ticketmaster Belgium prints it
  // on every PDF page so it would otherwise win.
  const cleaned = text
    .replace(/Date\s+de\s+commande\s*:\s*[^\n\r]*/gi, '')
    .replace(/Order\s+date\s*:\s*[^\n\r]*/gi, '')
    .replace(/Date\s+d['']achat\s*:\s*[^\n\r]*/gi, '')
  // Accepts both "18 mai 2026" and "ven. 02 avr. 2027 - 20:00"
  const FR_MONTH_RE =
    '(?:janvier|janv\\.?|février|fevrier|févr\\.?|fevr\\.?|mars|avril|avr\\.?|mai|juin|juillet|juil\\.?|août|aout|septembre|sept\\.?|octobre|oct\\.?|novembre|nov\\.?|décembre|decembre|déc\\.?|dec\\.?)'
  const frFull = new RegExp(
    `\\b(\\d{1,2})\\s+(${FR_MONTH_RE})\\s+(\\d{4})(?:[^\\d]{1,15}(\\d{1,2})\\s*[h:.]\\s*(\\d{2}))?`,
    'i',
  ).exec(cleaned)
  if (frFull) {
    const [, dStr, monStr, yStr, hStr, miStr] = frFull
    const day = parseInt(dStr ?? '0', 10)
    const monKey = (monStr ?? '').toLowerCase().replace(/\.$/, '')
    const month = FR_MONTHS[monKey] ?? 0
    const year = parseInt(yStr ?? '0', 10)
    const hour = hStr ? parseInt(hStr, 10) : 20
    const minute = miStr ? parseInt(miStr, 10) : 0
    if (year > 2000 && day >= 1 && day <= 31)
      return formatLocal(year, month, day, hour, minute)
  }

  const enFull =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2}),?\s+(\d{4})(?:[^\d]{1,12}(\d{1,2}):?(\d{2})?\s*(am|pm)?)?/i.exec(
      cleaned,
    )
  if (enFull) {
    const [, monStr, dStr, yStr, hStr, miStr, ampm] = enFull
    const month = EN_MONTHS[(monStr ?? '').toLowerCase()] ?? 0
    const day = parseInt(dStr ?? '0', 10)
    const year = parseInt(yStr ?? '0', 10)
    let hour = hStr ? parseInt(hStr, 10) : 20
    const minute = miStr ? parseInt(miStr, 10) : 0
    if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12
    if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0
    if (year > 2000 && day >= 1 && day <= 31)
      return formatLocal(year, month, day, hour, minute)
  }

  const numeric =
    /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[^\d]{1,12}(\d{1,2}):(\d{2}))?/.exec(cleaned)
  if (numeric) {
    const [, dStr, monStr, yStr, hStr, miStr] = numeric
    const day = parseInt(dStr ?? '0', 10)
    const month = parseInt(monStr ?? '0', 10) - 1
    const year = parseInt(yStr ?? '0', 10)
    const hour = hStr ? parseInt(hStr, 10) : 20
    const minute = miStr ? parseInt(miStr, 10) : 0
    if (year > 2000 && day >= 1 && day <= 31 && month >= 0 && month <= 11)
      return formatLocal(year, month, day, hour, minute)
  }

  return undefined
}

function formatLocal(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
): string {
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${y}-${pad(m + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}`
}

function extractVenue(text: string): string | undefined {
  const lower = text.toLowerCase()
  const sorted = [...KNOWN_VENUES].sort((a, b) => b.length - a.length)
  for (const v of sorted) {
    if (lower.includes(v.toLowerCase())) return v
  }
  return undefined
}

function extractOrganizer(
  text: string,
  provider: ProviderId,
): string | undefined {
  const fromProvider = PROVIDER_LABELS[provider]
  if (fromProvider) return fromProvider
  // Heuristic: look for known issuer mentions
  const ORG_LIST = [
    'Ticketmaster',
    'FNAC Spectacles',
    'FNAC',
    'See Tickets',
    'Eventim',
    'Live Nation',
    'AEG Presents',
    'PIAS',
    'Greenhouse Talent',
    'SNCF Connect',
    'SNCF',
    'Air France',
    'Comédie-Française',
  ]
  const lower = text.toLowerCase()
  const sorted = [...ORG_LIST].sort((a, b) => b.length - a.length)
  for (const o of sorted) {
    if (lower.includes(o.toLowerCase())) return o
  }
  return undefined
}

const METADATA_LINE_RE =
  /^(?:bloc|block|carré|catégorie|cat\.|section|rang|row|siège|seat|place|date|heure|hour|email|commande|order|n°|number|client|barcode|code|qr|tax|prix|price|tva|vat|total|montant|amount|réf|ref|address|adresse|tel|tél|phone|tickets?|billet|admission|au\s+nom\s+de|holder|titulaire|porteur|passenger|votre\s+commande|order\s+number|customer|assis\s+numéroté)\b/i

/** iOS / Android status bar line at the top of a screenshot:
 *  "21:09 4    «1! 7 ED" / "100%" / "9:41 AM" / etc. */
const STATUS_BAR_RE = /^\d{1,2}:\d{2}|\b\d{1,3}\s*%/

/** Common in-app UI labels we don't want to confuse with the event title */
const UI_LABEL_RE =
  /^(?:Aide|Help|Continuer|Continue|Suivant|Next|Annuler|Cancel|Bas|Beneden|Haut|Boven|Terminer|Done|Fermer|Close|Ajouter\s+à|Add\s+to|Retour|Back|Partager|Share|de\s+\d+|\d+\s+de\s+\d+)\b/i

function lineContainsDate(line: string): boolean {
  if (
    /\b\d{1,2}\s+(?:janvier|janv\.?|février|fevrier|févr\.?|fevr\.?|mars|avril|avr\.?|mai|juin|juillet|juil\.?|août|aout|septembre|sept\.?|octobre|oct\.?|novembre|nov\.?|décembre|decembre|déc\.?|dec\.?)\s+\d{4}/i.test(
      line,
    )
  )
    return true
  if (/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/.test(line)) return true
  return false
}

function extractEventName(
  text: string,
  provider: ProviderId,
): string | undefined {
  void provider

  // 1. Provider-specific: "Vous allez voir : XXX" or "Concert: XXX"
  const labelled =
    /(?:Vous\s+allez\s+(?:voir|assister\s+à)|Spectacle|Concert|Événement|Event|Show|Match)\s*[:—-]?\s*([^\n\r]{4,80})/i.exec(
      text,
    )
  if (labelled?.[1]) {
    const cleaned = labelled[1].trim().replace(/[—-]\s*$/, '').trim()
    if (cleaned.length >= 4) return cleaned
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 5 && l.length <= 100)

  const cleanLines = lines.filter(
    (l) =>
      !METADATA_LINE_RE.test(l) &&
      !STATUS_BAR_RE.test(l) &&
      !UI_LABEL_RE.test(l) &&
      !lineContainsDate(l) &&
      !/@/.test(l) &&
      !/^(?:www\.|http)/i.test(l),
  )

  // 2. "<Event Name 20YY> | <Pass Type>" — Ticketmaster Belgium prints
  //    e.g. "Les Solidarités 2026 | Pass 3 jours" on its own line.
  for (const line of cleanLines) {
    if (!line.includes('|')) continue
    if (!/\b20\d{2}\b/.test(line)) continue
    if (line.length >= 8 && line.length <= 100) return line
  }

  // 3. "Artist - Title" pattern — very common on event tickets, scan
  //    each line. Both halves must start with a capital letter and
  //    contain only letters / spaces / apostrophes.
  const titleRe =
    /([\p{Lu}][\p{L}'-]+(?:\s+[\p{L}'-]+){0,5})\s+[-–—]\s+([\p{Lu}][\p{L}'-]+(?:\s+[\p{L}'-]+){0,8})/u
  for (const line of cleanLines) {
    const m = titleRe.exec(line)
    if (m?.[1] && m[2]) {
      const left = m[1].trim()
      const right = m[2].trim()
      if (left.length >= 2 && right.length >= 2) {
        return `${left} - ${right}`
      }
    }
  }

  // 3. Fallback — longest title-case line that's not metadata, status,
  //    UI, or a date line.
  const candidates = cleanLines.filter(
    (l) => /[A-Z]/.test(l) && !/^\d+[\s\d:./-]*$/.test(l),
  )

  candidates.sort((a, b) => b.length - a.length)
  return candidates[0]
}

// ─────────────────────── Ticket-level extraction ───────────────────────

function extractTickets(text: string, provider: ProviderId): ParsedTicket[] {
  // First: try to split into per-ticket blocks
  const blocks = splitIntoTicketBlocks(text)
  if (blocks.length > 1) {
    return blocks
      .map((block) => parseTicketBlock(block, provider))
      .filter((t) => t.holderName || t.seat || t.barcodeValue)
  }

  // No clear split — try to extract one ticket from whole text
  const single = parseTicketBlock(text, provider)
  if (single.holderName || single.seat || single.barcodeValue) return [single]
  return []
}

const TICKET_HEADER_RE =
  /^(?:Billet|Ticket|Pass|Place|E[-\s]?ticket)\s*(?:n°|#|N\.?\s*°?|n)?\s*\d{1,3}\s*(?:\/\s*\d{1,3})?(?:\s*[-—:].*)?$/im

/** Ticketmaster Belgium prints one of these per ticket page in the
 *  PDF (GA---NNNNN  ESPxxx  ESP  *REFERENCE*). Used as a per-ticket
 *  separator for parsing 6-pass-in-one-PDF imports. */
const TM_BE_TICKET_RE =
  /^GA[-]+\d{3,}\s+[A-Z][A-Z0-9]{1,10}\s+[A-Z]{1,5}\s+\*[^*\s][^*]{2,30}\*\s*$/m

function splitIntoTicketBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const indices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l === undefined) continue
    if (TICKET_HEADER_RE.test(l) || TM_BE_TICKET_RE.test(l)) indices.push(i)
  }
  if (indices.length < 2) return []

  const blocks: string[] = []
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i]!
    const end = indices[i + 1] ?? lines.length
    blocks.push(lines.slice(start, end).join('\n'))
  }
  return blocks
}

function parseTicketBlock(block: string, provider: ProviderId): ParsedTicket {
  void provider
  return {
    holderName: extractHolderName(block),
    seat: extractSeat(block),
    barcodeValue: extractBarcodeValue(block),
  }
}

function extractSeat(text: string): string | undefined {
  // 0. Belgian Ticketmaster columnar layout: a "SECTION RANGÉE SIÈGE"
  //    header followed by values laid out in columns. OCR linearizes
  //    columns into rows, so we read positionally instead of by label.
  const columnar = extractColumnarVenuePlace(text)
  if (columnar) return columnar

  // 1. Tolerate OCR artifacts: leading punctuation noise, weird quotes,
  //    and arbitrary whitespace between label and value. The captured
  //    value must end on a word boundary — otherwise `RANGÉE  SIÈGE`
  //    would capture the S of SIÈGE as the row letter.
  const blocM =
    /(?:^|\s|[.,:;])(?:Bloc(?:k)?|Carré|Section|Catégorie|Cat\.?|Cat[ée]g\.?)\s*[:°#]?\s*([A-Z]?\d+[A-Z]?)\b/i.exec(
      text,
    )
  const rangM =
    /(?:^|\s|[.,:;])(?:Rang(?:ée)?|Row|Ligne)\s*[:°#]?\s*(\d+|[A-Z])(?=\W|$)/i.exec(
      text,
    )
  const seatM =
    /(?:^|\s|[.,:;])(?:Siège|Sieg|Seat|Place(?:\s+n°)?|Numéro\s+de\s+place|Seat\s+no|N°\s*de\s*place)\s*[:°#]?\s*(\d+)\b/i.exec(
      text,
    )

  const parts: string[] = []
  if (blocM?.[1]) parts.push(`Bloc ${blocM[1]}`)
  if (rangM?.[1]) parts.push(`Rang ${rangM[1]}`)
  if (seatM?.[1]) parts.push(`Siège ${seatM[1]}`)
  if (parts.length > 0) return parts.join(' — ')

  const sncfM = /Voiture\s*[:°#]?\s*(\d+).{0,40}?Place\s*[:°#]?\s*(\d+)/i.exec(
    text,
  )
  if (sncfM) return `Voiture ${sncfM[1]} — Place ${sncfM[2]}`

  const theatreM =
    /\b(Orchestre|Mezzanine|Balcon|Corbeille|Parterre|Loge)\b.{0,40}?(?:Rang|Row)?\s*([A-Z]?\d{1,3}|[A-Z])(?:.{0,30}?(?:Siège|Seat|Place)\s*(\d+))?/i.exec(
      text,
    )
  if (theatreM) {
    const out = [theatreM[1]!]
    if (theatreM[2]) out.push(`Rang ${theatreM[2]}`)
    if (theatreM[3]) out.push(`Siège ${theatreM[3]}`)
    return out.join(' — ')
  }

  // Slash-delimited e.g. "A12 / 14 / 22" near "Bloc/Rang/Place" header
  const slashM =
    /(?:Bloc\s*\/\s*Rang\s*\/\s*Place|Block\/Row\/Seat)\s*[:#]?\s*([A-Z]?\d+)\s*\/\s*(\d+|[A-Z])\s*\/\s*(\d+)/i.exec(
      text,
    )
  if (slashM) {
    return `Bloc ${slashM[1]} — Rang ${slashM[2]} — Siège ${slashM[3]}`
  }

  return undefined
}

/**
 * Belgian Ticketmaster (and similar) layouts:
 *
 *     SECTION        RANGÉE         SIÈGE
 *     Parterre
 *     14            271
 *     A
 *
 * After OCR the columns are linearized into rows; we use the header line
 * as an anchor, then read the next ~6 lines positionally:
 *   - first known section keyword (Parterre / Orchestre / Balcon / …)
 *   - first capital-letter line on its own = sub-section letter
 *   - first two numbers in document order: row, then seat
 */
function extractColumnarVenuePlace(text: string): string | undefined {
  const headerRe =
    /(?:^|\n).{0,5}(?:SECTION|SECTEUR)[ \t]+(?:RANG[ÉE]+E?|ROW)[ \t]+(?:SIÈGE|SEAT|PLACE)[^\n]*\n/i
  const headerMatch = headerRe.exec(text)
  if (!headerMatch) return undefined

  const headerEnd = headerMatch.index + headerMatch[0].length
  const chunk = text.slice(headerEnd, headerEnd + 250)
  const lines = chunk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)

  const sectionRe =
    /\b(Parterre|Orchestre|Balcon|Corbeille|Mezzanine|Loge|Carré|Tribune|Pelouse|Fosse|Carre)\b/i
  let section: string | undefined
  for (const line of lines) {
    const m = sectionRe.exec(line)
    if (m?.[1]) {
      section = m[1]
      break
    }
  }

  // Sub-section letter: a line that's just a single uppercase letter
  const subLetter = lines.find((l) => /^[A-Z]$/.test(l))

  // First two numbers in document order
  const numbers: string[] = []
  for (const line of lines) {
    const ms = [...line.matchAll(/\b(\d{1,4})\b/g)]
    for (const m of ms) {
      if (m[1]) numbers.push(m[1])
      if (numbers.length >= 2) break
    }
    if (numbers.length >= 2) break
  }

  // Require at least a recognized section keyword — otherwise we'd
  // happily emit "Rang 13 — Siège 2025" by picking up the order date
  // and customer numbers from a Ticketmaster header table.
  if (!section) return undefined

  const parts: string[] = []
  parts.push(subLetter ? `${section} ${subLetter}` : section)
  if (numbers[0]) parts.push(`Rang ${numbers[0]}`)
  if (numbers[1]) parts.push(`Siège ${numbers[1]}`)

  return parts.length >= 1 ? parts.join(' — ') : undefined
}

function extractHolderName(text: string): string | undefined {
  const namePart =
    "[A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ][a-zàâäéèêëïîôöùûüç'-]{1,}(?:\\s+[A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ][a-zàâäéèêëïîôöùûüç'-]+){0,3}"
  const upperName =
    "[A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ][A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ'-]{1,}(?:\\s+[A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ][A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ'-]+){0,3}"

  const patterns = [
    new RegExp(`Au\\s+nom\\s+de\\s*:?\\s*(?:M\\.|Mme|Mlle|Mr|Ms|Mrs)?\\s*(${namePart}|${upperName})`, 'i'),
    new RegExp(`Holder(?:'s)?\\s+name\\s*:?\\s*(${namePart}|${upperName})`, 'i'),
    new RegExp(`Nom\\s*(?:du)?\\s*(?:porteur|titulaire)\\s*:?\\s*(${namePart}|${upperName})`, 'i'),
    new RegExp(`Passenger\\s*:?\\s*(${namePart}|${upperName})`, 'i'),
    // Ticketmaster Belgium PDF layout: "<First Last> Numéro de commande :"
    // (the customer name sits right above the order header row)
    new RegExp(`(${namePart})\\s+Numéro\\s+(?:de\\s+)?commande`, ''),
    new RegExp(`(?:Mr|Mrs|Mme|M\\.|Mlle)\\.?\\s+(${namePart}|${upperName})`),
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    const name = m?.[1]?.trim()
    if (name && name.length >= 3 && name.length <= 60) return titleCase(name)
  }
  return undefined
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s // already mixed case
  return s
    .split(/\s+/)
    .map((w) =>
      w.length > 1
        ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        : w,
    )
    .join(' ')
}

function extractBarcodeValue(text: string): string | undefined {
  // Look for explicit barcode/reference labels followed by a value
  const m =
    /\b(?:Code(?:\s+barre|-barre|\s+barres?)?|Référence|Ref\.?|N°\s*billet|Ticket\s+n°|Booking\s+ref(?:erence)?)\s*[:#]?\s*([A-Z0-9-]{6,40})/i.exec(
      text,
    )
  return m?.[1]?.trim()
}

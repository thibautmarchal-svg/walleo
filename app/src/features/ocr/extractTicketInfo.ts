/**
 * Tesseract.js-based OCR for ticket photos / screenshots.
 * Lazy-loaded — Tesseract is ~10MB + WASM. Called only when the user
 * batch-imports tickets via the file picker.
 *
 * Heuristics target French + English event tickets (Ticketmaster, FNAC,
 * See Tickets, Eventim, SNCF, Comédie-Française, etc.). They are
 * deliberately conservative — they only fill a field when the pattern is
 * unambiguous, so the form pre-fill never overwrites real user input
 * with garbage.
 */

export interface ExtractedTicketInfo {
  /** Per-ticket fields */
  holderName?: string
  seat?: string
  /** Event-wide fields (typically the same on every ticket of the event) */
  eventName?: string
  /** Local datetime string ready for <input type="datetime-local"> */
  eventDate?: string
  venue?: string
  organizer?: string
  rawText: string
  confidence: number
}

export interface OcrSession {
  recognize(blob: File | Blob): Promise<ExtractedTicketInfo>
  terminate(): Promise<void>
}

export async function createOcrSession(): Promise<OcrSession> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['fra', 'eng'])
  return {
    async recognize(blob) {
      const { data } = await worker.recognize(blob)
      return parseTicketText(data.text, data.confidence)
    },
    async terminate() {
      await worker.terminate()
    },
  }
}

export function parseTicketText(
  text: string,
  confidence: number,
): ExtractedTicketInfo {
  return {
    holderName: extractHolderName(text),
    seat: extractSeat(text),
    eventName: extractEventName(text),
    eventDate: extractDate(text),
    venue: extractVenue(text),
    organizer: extractOrganizer(text),
    rawText: text,
    confidence: confidence / 100,
  }
}

// ────────────────────────── Heuristics ──────────────────────────

const FR_MONTHS: Record<string, number> = {
  janvier: 0,
  février: 1,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  août: 7,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  décembre: 11,
  decembre: 11,
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
]

const KNOWN_ORGANIZERS = [
  'Ticketmaster',
  'FNAC Spectacles',
  'FNAC',
  'See Tickets',
  'Eventim',
  'Live Nation',
  'Greenhouse Talent',
  'AEG Presents',
  'PIAS',
  'SNCF Connect',
  'SNCF',
  'Air France',
  'Comédie-Française',
  'Théâtres Parisiens Associés',
]

function extractSeat(text: string): string | undefined {
  const blocM = /\b(?:Bloc(?:k)?|Carré|Section|Catégorie|Cat\.)\s*[:°]?\s*([A-Z]?\d+[A-Z]?)/i.exec(text)
  const rangM = /\b(?:Rang(?:ée)?|Row)\s*[:°]?\s*(\d+)/i.exec(text)
  const seatM =
    /\b(?:Siège|Seat|Place(?:\s+n°)?|Numéro\s+de\s+place|Seat\s+no)\s*[:°]?\s*(\d+)/i.exec(
      text,
    )

  const parts: string[] = []
  if (blocM?.[1]) parts.push(`Bloc ${blocM[1]}`)
  if (rangM?.[1]) parts.push(`Rang ${rangM[1]}`)
  if (seatM?.[1]) parts.push(`Siège ${seatM[1]}`)

  if (parts.length > 0) return parts.join(' — ')

  // SNCF-style: "Voiture 12 - Place 47"
  const sncfM = /Voiture\s*(\d+).{0,30}?Place\s*(\d+)/i.exec(text)
  if (sncfM) return `Voiture ${sncfM[1]} — Place ${sncfM[2]}`

  // Orchestre / Mezzanine / Balcon (théâtre)
  const theatreM =
    /\b(Orchestre|Mezzanine|Balcon|Corbeille|Parterre|Loge)\b.{0,40}?(?:Rang|Row)?\s*([A-Z]?\d{1,3}|[A-Z])(?:.{0,30}?(?:Siège|Seat|Place)\s*(\d+))?/i.exec(
      text,
    )
  if (theatreM) {
    const out = [theatreM[1]]
    if (theatreM[2]) out.push(`Rang ${theatreM[2]}`)
    if (theatreM[3]) out.push(`Siège ${theatreM[3]}`)
    return out.join(' — ')
  }

  return undefined
}

function extractHolderName(text: string): string | undefined {
  const namePart =
    "[A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ][a-zàâäéèêëïîôöùûüç'-]{1,}(?:\\s+[A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ][a-zàâäéèêëïîôöùûüç'-]+){0,3}"

  const patterns = [
    new RegExp(`Au\\s+nom\\s+de\\s*:?\\s*(?:M\\.|Mme|Mlle|Mr|Ms|Mrs)?\\s*(${namePart})`, 'i'),
    new RegExp(`Holder(?:'s)?\\s+name\\s*:?\\s*(${namePart})`, 'i'),
    new RegExp(`Nom\\s*(?:du)?\\s*(?:porteur|titulaire)\\s*:?\\s*(${namePart})`, 'i'),
    new RegExp(`Passenger\\s*:?\\s*(${namePart})`, 'i'),
    new RegExp(`(?:Mr|Mrs|Mme|M\\.|Mlle)\\.?\\s+(${namePart})`),
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    const name = m?.[1]?.trim()
    if (name && name.length >= 3 && name.length <= 60) return name
  }
  return undefined
}

function extractDate(text: string): string | undefined {
  // "samedi 18 mai 2026 à 20h30" / "à 20:30" / no time
  const frFull =
    /\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})(?:[^\d]{1,8}(\d{1,2})\s*[h:.]\s*(\d{2}))?/i.exec(
      text,
    )
  if (frFull) {
    const [, dStr, monStr, yStr, hStr, miStr] = frFull
    const day = parseInt(dStr ?? '0', 10)
    const month = FR_MONTHS[(monStr ?? '').toLowerCase()] ?? 0
    const year = parseInt(yStr ?? '0', 10)
    const hour = hStr ? parseInt(hStr, 10) : 20
    const minute = miStr ? parseInt(miStr, 10) : 0
    if (year > 2000 && day >= 1 && day <= 31)
      return formatLocal(year, month, day, hour, minute)
  }

  // EN: "May 18, 2026 8:30 PM"
  const enFull =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2}),?\s+(\d{4})(?:[^\d]{1,8}(\d{1,2}):?(\d{2})?\s*(am|pm)?)?/i.exec(
      text,
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

  // dd/mm/yyyy hh:mm or dd-mm-yyyy
  const numeric =
    /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[^\d]{1,8}(\d{1,2}):(\d{2}))?/.exec(text)
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
  // Sort by length descending so "Accor Arena" wins over "Arena"
  const sorted = [...KNOWN_VENUES].sort((a, b) => b.length - a.length)
  for (const v of sorted) {
    if (lower.includes(v.toLowerCase())) return v
  }
  return undefined
}

function extractOrganizer(text: string): string | undefined {
  const lower = text.toLowerCase()
  const sorted = [...KNOWN_ORGANIZERS].sort((a, b) => b.length - a.length)
  for (const o of sorted) {
    if (lower.includes(o.toLowerCase())) return o
  }
  return undefined
}

const METADATA_LINE_RE =
  /^(?:bloc|block|carré|catégorie|cat\.|section|rang|row|siège|seat|place|date|heure|hour|email|commande|order|n°|number|client|barcode|code|qr|tax|prix|price|tva|vat|total|montant|amount|réf|ref|address|adresse|tel|tél|phone|tickets?|billet|admission)\b/i

function extractEventName(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 5)

  const candidates = lines.filter(
    (l) =>
      !METADATA_LINE_RE.test(l) &&
      /[A-Z]/.test(l) &&
      !/^\d+[\s\d:./-]*$/.test(l) && // not just digits + separators
      !/@/.test(l) &&
      !/^(www\.|http)/i.test(l) &&
      l.length <= 80,
  )

  // Prefer the longest one; ties broken by position (earlier wins)
  candidates.sort((a, b) => b.length - a.length)
  const top = candidates[0]
  return top
}

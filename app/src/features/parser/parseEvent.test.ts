/**
 * Unit tests for the event-text parser heuristics.
 *
 * Tests cover:
 *   - detectProvider on representative provider signatures
 *   - extractDate on FR / EN / numeric formats
 *   - extractEventName on the "Artist - Title" pattern
 *   - extractSeat on columnar SECTION / RANGÉE / SIÈGE layout
 *
 * All functions are exercised via the public parseEventText() entry point
 * where possible; internals are tested indirectly.
 */
import { describe, it, expect } from 'vitest'
import {
  detectProvider,
  parseEventText,
  type ProviderId,
} from './parseEvent'

// ── detectProvider ───────────────────────────────────────────────────────────

describe('detectProvider', () => {
  const cases: Array<{ text: string; expected: ProviderId }> = [
    {
      text: "Merci d'avoir commandé sur ticketmaster.fr — votre billet est prêt.",
      expected: 'ticketmaster',
    },
    {
      text: 'FNAC Spectacles — Confirmation de commande N° dossier : 123456',
      expected: 'fnac',
    },
    {
      text: 'Votre billet See Tickets est disponible — seetickets.fr',
      expected: 'seeTickets',
    },
    {
      text: 'Bestellnummer: 1234567 — Eventim.de',
      expected: 'eventim',
    },
    {
      text: 'SNCF Connect — TGV INOUI 8409 Paris → Marseille',
      expected: 'sncf',
    },
  ]

  for (const { text, expected } of cases) {
    it(`détecte "${expected}" dans le texte représentatif`, () => {
      expect(detectProvider(text)).toBe(expected)
    })
  }

  it('retourne "unknown" pour un texte sans signature connue', () => {
    expect(detectProvider('Bonjour, voici votre réservation #AB12 pour le concert.')).toBe('unknown')
  })
})

// ── extractDate ──────────────────────────────────────────────────────────────

describe('extractDate (via parseEventText)', () => {
  it('parse une date FR longue "18 mai 2026"', () => {
    const result = parseEventText('Concert le 18 mai 2026 à 20h30 à l\'Olympia')
    expect(result.event.date).toBe('2026-05-18T20:30')
  })

  it('parse une date FR courte avec point "02 avr. 2027 - 20:00"', () => {
    const result = parseEventText('ven. 02 avr. 2027 - 20:00 — Stade de France')
    expect(result.event.date).toBe('2027-04-02T20:00')
  })

  it('parse une date EN "May 18, 2026 at 8:00 PM"', () => {
    const result = parseEventText('Your event: May 18, 2026 at 8:00 PM — Venue XYZ')
    expect(result.event.date).toBe('2026-05-18T20:00')
  })

  it('parse une date numérique "18/05/2026 20:00"', () => {
    const result = parseEventText('Date : 18/05/2026 20:00')
    expect(result.event.date).toBe('2026-05-18T20:00')
  })

  it('retourne undefined si aucune date trouvée', () => {
    const result = parseEventText('Bonjour, voici votre billet numéro 12345.')
    expect(result.event.date).toBeUndefined()
  })

  it('ignore la "Date de commande" et prend la date de l\'événement', () => {
    const text = [
      'Date de commande : 01 janvier 2026',
      'Concert le 20 juin 2026 à 21h00',
    ].join('\n')
    const result = parseEventText(text)
    expect(result.event.date).toBe('2026-06-20T21:00')
  })
})

// ── extractEventName ─────────────────────────────────────────────────────────

describe('extractEventName — pattern "Artiste - Titre"', () => {
  it('extrait "Coldplay - Music of the Spheres" depuis une ligne', () => {
    const text = [
      'Ticketmaster — Votre commande',
      'Coldplay - Music of the Spheres',
      '18 mai 2026 20:00',
      'Stade de France',
    ].join('\n')
    const result = parseEventText(text)
    expect(result.event.name).toBe('Coldplay - Music of the Spheres')
  })

  it('extrait le nom via le label "Concert :"', () => {
    const text = 'Concert : Massive Attack\n20 octobre 2026\nZénith de Paris'
    const result = parseEventText(text)
    expect(result.event.name).toBe('Massive Attack')
  })

  it('utilise le fallback longest-title-case en absence de pattern', () => {
    // Texte avec un seul titre sans pattern "Artist - Title" ni label
    const text = [
      'ticketmaster.fr',
      'Téléchargez votre billet',
      'Festival des Solidarités 2026',
      '12/07/2026 14:00',
    ].join('\n')
    const result = parseEventText(text)
    // Should pick the best candidate — at minimum not undefined
    expect(result.event.name).toBeTruthy()
  })
})

// ── extractSeat — columnar layout ────────────────────────────────────────────

describe('extractSeat — layout SECTION RANGÉE SIÈGE', () => {
  it('extrait la place depuis un layout colonnaire belge Ticketmaster', () => {
    const text = [
      'SECTION       RANGÉE         SIÈGE',
      'Parterre',
      '14            271',
      'A',
    ].join('\n')

    const result = parseEventText(text)
    // Should contain section + row + seat parts
    expect(result.tickets[0]?.seat).toMatch(/Parterre/i)
    expect(result.tickets[0]?.seat).toMatch(/Rang\s+14/i)
    expect(result.tickets[0]?.seat).toMatch(/Siège\s+271/i)
  })

  it('extrait la place via les labels standard Bloc/Rang/Siège', () => {
    const text = [
      'ticketmaster.fr',
      'Concert Rock',
      '01/09/2026',
      'Bloc : A12',
      'Rang : 14',
      'Siège : 22',
    ].join('\n')

    const result = parseEventText(text)
    expect(result.tickets[0]?.seat).toBe('Bloc A12 — Rang 14 — Siège 22')
  })

  it('extrait la place SNCF Voiture/Place', () => {
    const text = [
      'SNCF Connect',
      'TGV INOUI 8409',
      'Paris Gare de Lyon → Marseille',
      'Voiture : 12  Place : 47',
    ].join('\n')

    const result = parseEventText(text)
    expect(result.tickets[0]?.seat).toBe('Voiture 12 — Place 47')
  })

  it('extrait la place théâtre Orchestre/Rang/Siège', () => {
    const text = [
      'Comédie-Française',
      'Cyrano de Bergerac',
      '12 octobre 2026',
      'Orchestre Rang G Siège 9',
    ].join('\n')

    const result = parseEventText(text)
    expect(result.tickets[0]?.seat).toMatch(/Orchestre/i)
  })
})

// ── parseEventText — confidence & warnings ───────────────────────────────────

describe('parseEventText — confiance et avertissements', () => {
  it('produit une confiance > 0 pour un email Ticketmaster réaliste', () => {
    const text = [
      'ticketmaster.fr — Confirmation de commande',
      'Coldplay - Music of the Spheres',
      '18 mai 2026 20:00',
      'Stade de France, Saint-Denis',
    ].join('\n')

    const result = parseEventText(text)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.provider).toBe('ticketmaster')
  })

  it('produit un avertissement et confidence 0 pour un texte vide', () => {
    const result = parseEventText('')
    expect(result.confidence).toBe(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('ne plante jamais sur un texte arbitraire (robustesse)', () => {
    const weirdInputs = [
      '????!!!###',
      '\x00\x01\x02',
      'a'.repeat(50_000),
      '12345',
      '',
    ]
    for (const input of weirdInputs) {
      expect(() => parseEventText(input)).not.toThrow()
    }
  })
})

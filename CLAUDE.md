# CLAUDE.md — Walleo

Briefing pour toute session Claude Code travaillant sur ce projet. **Lire avant
toute modification de code.**

## Projet

Walleo est une **PWA mono-utilisateur** (Thibaut) pour centraliser cartes de
fidélité et billets de spectacle. **100 % local**, pas de backend, pas d'auth,
pas de tracking. Specs complètes dans [`PROMPT_PROJET.md`](./PROMPT_PROJET.md).

## Contraintes non-négociables

1. **Aucune donnée ne quitte l'appareil.** Stockage IndexedDB only. Pas
   d'analytics, pas de telemetry, pas de pings externes.
2. **Pas de backend.** Hébergement statique uniquement (Netlify cible).
3. **Pas de signature `.pkpass`** côté app (pas de compte Apple Developer).
   Les `.pkpass` reçus signés sont stockés tels quels et re-servis avec le bon
   MIME type pour ré-import dans Wallet. Voir `PROMPT_PROJET.md` section 4.
4. **TypeScript strict** (`strict: true`, `noUncheckedIndexedAccess: true`).
   Pas de `any` sauf justifié par un commentaire.
5. **Mobile-first** (iOS Safari prioritaire) mais doit marcher sur Mac.
6. **HTTPS obligatoire** en prod (caméra, service worker, Wake Lock API).

## Stack

- **App** : `app/` (Vite 7 + React 19 + TypeScript)
- **UI** : Tailwind v4 + shadcn/ui (style new-york, CSS variables, dark mode)
- **State** : Zustand (un store par feature)
- **DB** : Dexie.js (wrapper IndexedDB) — schéma dans `app/src/shared/db/`
- **PWA** : `vite-plugin-pwa` (Workbox, autoUpdate)
- **Barcodes** : `bwip-js/browser` (rendu), `@zxing/browser` (scan)
- **OCR** : `tesseract.js` (lazy-load impératif, ~10 MB)
- **PDF** : `pdfjs-dist` (lazy-load impératif)
- **Tests** : Vitest (unit) + Playwright (E2E)

## Identité visuelle

- Couleurs (CSS vars) : `--walleo-black` `#0A0A0A`, `--walleo-yellow` `#FFD60A`,
  `--walleo-yellow-light` `#FFE65A`. Tailwind tokens : `walleo-black`,
  `walleo-yellow`, `walleo-yellow-light`.
- Sources brand : `brand/icon.svg`, `brand/wordmark.svg` (générer toutes les
  icônes depuis là — voir `app/pwa-assets.config.ts`).
- Vibe : Apple-like, premium, minimal, dark default.

## Conventions de code

- Path alias `@/*` → `app/src/*`. Toujours utiliser `@/...` pour les imports
  internes.
- Structure : `app/src/{app, features, shared, lib}/`. Les features sont
  autonomes (UI + store + utils).
- Pas de comments « ce que fait le code » — uniquement le « pourquoi » non
  évident.
- Les hooks Wake Lock / luminosité sont silencieux en cas d'API absente
  (no-op gracieux, pas d'exception).

## Lancer le projet

```bash
cd app
npm install
npm run dev          # http://localhost:5173
npm run build        # prod build dans app/dist/
npm run preview      # preview du build
```

## Agents disponibles

Voir `.claude/agents/`. Délégation via la `Task` tool quand le périmètre matche
la description de l'agent. Liste : `frontend-pwa-dev`, `ux-designer`,
`wallet-integration-specialist`, `qa-tester`, `ocr-vision-specialist`,
`parser-engineer`, `security-engineer`, `devops-pwa`.

## Phases

- **Phase 0 — Bootstrap** ✅ (scaffold, deps, PWA manifest, agents, seed, dashboard)
- **Phase 1 — CRUD core** : dashboard ✅, détail ✅, saisie manuelle ✅, export/import JSON ⏳
- **Phase 2** : scan caméra, screenshot import, OCR photo, parsers email/PDF
- **Phase 3** : plein écran luminosité max, ré-export `.pkpass` Apple Wallet
- **Phase 4** : tests E2E, audit sécurité, déploiement Netlify

## TODO Phase 4 — vraiment 100% local

- **Self-host Tesseract.js assets** : aujourd'hui Tesseract télécharge son
  worker, son core wasm et les language packs (fra/eng) depuis
  `cdn.jsdelivr.net` + `tessdata.projectnaptha.com`. La CSP les autorise
  explicitement. Pour respecter "aucune donnée ne quitte l'appareil"
  jusqu'au bout, copier ces assets dans `public/tesseract/` au build et
  configurer `createWorker({ workerPath, corePath, langPath })` pour
  pointer en local. ~10 MB de plus dans le bundle PWA mais c'est offline
  et zéro CDN.

## À NE PAS faire

- Ajouter un backend, une auth, un service externe.
- Importer une lib de tracking ou d'analytics.
- Signer des `.pkpass` (pas de cert Apple, hors scope).
- Utiliser `localStorage` pour les données métier (Dexie only).
- Bloquer le main thread avec OCR/PDF — toujours en worker / lazy.

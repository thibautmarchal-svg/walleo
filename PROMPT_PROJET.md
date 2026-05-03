# PROMPT MASTER — Walleo : PWA Gestionnaire de Cartes & Tickets

> **Comment l'utiliser** : Copie-colle ce document entier comme premier message à Claude Code (ou tout autre agent de codage). Il contient toutes les specs, l'architecture, les agents à invoquer et le plan de livraison.

---

## 1. Contexte & Objectif

**Nom de l'application** : **Walleo** (contraction de *wallet*).

**Identité visuelle** :
- Logo : deux cartes empilées légèrement décalées (rotations -8° / +6°) formant une silhouette de W stylisé.
- Couleurs primaires : noir profond `#0A0A0A` + jaune signal `#FFD60A` (jaune chaud `#FFE65A` en dégradé).
- Typographie wordmark : SF Pro Display / Inter, 700, letter-spacing négatif (-4), couleur `#0A0A0A`.
- Vibe : Apple-like, premium, minimal.
- Fichiers sources dans `brand/icon.svg` et `brand/wordmark.svg` à la racine du projet — à utiliser comme source pour générer toutes les tailles d'icônes (favicon, apple-touch-icon, manifest 192/512).

Je suis **Thibaut**, utilisateur unique de cette application (mono-tenant, pas d'auth multi-utilisateurs). Je veux créer une **Progressive Web App (PWA)** installable sur mon iPhone et mon Mac qui me permet de :

1. **Centraliser toutes mes cartes de fidélité** (Carrefour, Decathlon, FNAC, etc.) en un seul endroit.
2. **Centraliser mes places de concert et événements** (Ticketmaster, See Tickets, FNAC Spectacles, etc.).
3. **Afficher en plein écran** chaque code-barres/QR avec luminosité max automatique pour que la caisse / le contrôle scanne directement mon téléphone (cas d'usage principal — fonctionne partout, sans dépendance Apple).
4. **Ré-exporter vers Apple Wallet les `.pkpass` déjà signés** que je reçois (Ticketmaster, FNAC, SNCF…) — l'app les stocke et permet de les ré-ajouter à Wallet quand ils ont été supprimés. **Pas de signature `.pkpass` côté app** (cf. section 4).
5. **Stocker 100 % en local** (IndexedDB), sans backend, sans cloud, sans compte. Mes données ne sortent jamais de mon appareil.
6. **Fonctionner offline** une fois installée (service worker, cache).

**Cible : moi uniquement.** Pas d'onboarding, pas de marketing, pas de page de login. L'app s'ouvre directement sur le dashboard.

---

## 2. Stack Technique Recommandée

| Couche | Choix | Justification |
|---|---|---|
| **Framework** | **React 18 + Vite + TypeScript** | Écosystème mature, excellent support PWA, typage strict pour la robustesse. |
| **UI** | **Tailwind CSS + shadcn/ui** | Design system rapide, composants accessibles. |
| **State** | **Zustand** | Plus simple que Redux, parfait pour mono-utilisateur. |
| **Storage** | **Dexie.js** (wrapper IndexedDB) | API moderne, queries simples, migrations gérées. |
| **PWA** | **vite-plugin-pwa** (Workbox) | Service worker, manifest, offline-first. |
| **Scan QR/Barcode** | **`@zxing/browser`** | Détection multi-format (QR, EAN-13, Code128, PDF417, Aztec…). |
| **OCR** | **Tesseract.js** (lazy-loaded) | OCR client-side pour photos de cartes/tickets. |
| **PDF parsing** | **pdf.js** | Extraction de texte depuis PDFs Ticketmaster/FNAC. Détection si un `.pkpass` est embarqué dans l'email pour le récupérer tel quel. |
| **Affichage barcode** | **`bwip-js`** | Rendu côté client de tous les formats (QR, EAN13, Code128, PDF417, Aztec). |
| **Stockage `.pkpass` reçus** | **Blob IndexedDB** | Les `.pkpass` déjà signés (reçus par email) sont stockés tels quels et re-servis via lien `application/vnd.apple.pkpass` quand l'utilisateur veut les ré-ajouter à Wallet. |
| **Build** | **Vite + PWA plugin** | Build statique déployable sur Netlify/Vercel/GitHub Pages. |
| **Tests** | **Vitest** (unit) + **Playwright** (E2E) | Standard moderne. |

---

## 3. Architecture & Modèle de Données

### Schéma IndexedDB (Dexie)

```ts
// db.ts
interface Card {
  id: string;                    // uuid
  type: 'loyalty' | 'event';     // carte de fidélité OU billet
  name: string;                  // ex: "Carrefour" ou "Coldplay - Stade de France"
  brandColor: string;            // hex, pour le rendu visuel
  logoUrl?: string;              // logo (data URL si scanné)
  
  // Code identifiant
  barcodeFormat: 'QR' | 'EAN13' | 'CODE128' | 'PDF417' | 'AZTEC' | 'NONE';
  barcodeValue: string;          // contenu du code
  
  // Spécifique loyalty
  memberNumber?: string;         // numéro de carte humain
  
  // Spécifique event
  eventDate?: string;            // ISO 8601
  venue?: string;
  seat?: string;                 // bloc / rang / siège
  organizer?: string;            // Ticketmaster, FNAC...
  
  // Métadonnées
  createdAt: number;
  updatedAt: number;
  source: 'manual' | 'camera' | 'screenshot' | 'photo-ocr' | 'email' | 'pdf';
  
  // pkpass (uniquement si reçu signé du fournisseur)
  hasOriginalPkpass?: boolean;   // true si on a stocké le .pkpass d'origine
  originalPkpassBlob?: Blob;     // le fichier signé, tel quel
  lastWalletExportAt?: number;   // dernière fois ré-ajouté à Wallet
}
```

### Architecture des modules

```
src/
├── app/                    # Routing, layout, providers
├── features/
│   ├── cards/              # CRUD cartes (loyalty + event unifiés)
│   ├── scanner/            # Scan caméra (zxing)
│   ├── ocr/                # OCR photo (tesseract, lazy-loaded)
│   ├── screenshot-import/  # Détection QR depuis image fournie
│   ├── pdf-import/         # Parsing PDF tickets
│   ├── email-import/       # Parsing texte email collé + détection .pkpass attaché
│   ├── barcode-display/    # Affichage plein écran luminosité max
│   └── wallet-reexport/    # Ré-export des .pkpass déjà signés vers Apple Wallet
├── shared/
│   ├── db/                 # Dexie schema + migrations
│   ├── ui/                 # Design system (shadcn)
│   └── utils/
└── service-worker/
```

---

## 4. Stratégie Apple Wallet — sans compte Apple Developer

> **Décision tranchée** : pas de compte Apple Developer (99 $/an non justifié pour un usage perso). L'app **ne signera donc PAS** de `.pkpass`. Cette section décrit la stratégie de remplacement.

### Cas d'usage principal — affichage in-app

Pour **toutes les cartes de fidélité** et la majorité des cas, le flow est :
1. Tap sur la carte dans l'app.
2. Affichage **plein écran** du barcode/QR avec **luminosité forcée au max**, fond blanc, marges minimales.
3. La caisse scanne directement l'écran. Fonctionne dans 100 % des magasins (Carrefour, Decathlon, FNAC, Sephora, etc.).

C'est la fonction la plus importante de l'app. Le passage par Apple Wallet n'apporte rien de plus que ça — sauf l'accès depuis l'écran verrouillé, qui n'est pas critique.

### Cas Apple Wallet — `.pkpass` reçus signés

Beaucoup de billetteries (Ticketmaster, FNAC Spectacles, See Tickets, SNCF, Air France, etc.) **envoient déjà** le billet sous forme de `.pkpass` signé en pièce jointe email. Pour ces cas :

1. L'app **stocke le `.pkpass` d'origine tel quel** (Blob en IndexedDB) lors de l'import email/PDF.
2. Bouton « Ajouter à Apple Wallet » dans la fiche → l'app sert le fichier avec le bon MIME type (`application/vnd.apple.pkpass`).
3. iOS / Safari déclenche automatiquement l'ajout à Wallet.
4. Avantage : zéro signature, zéro certificat, ça « juste marche ».

### Cas non couverts — assumés

- Cartes de fidélité personnalisées dans Wallet : **pas possible** sans cert. On vit avec.
- Tickets reçus en PDF/email texte uniquement (sans `.pkpass` joint) : on extrait les infos et on les affiche en plein écran via barcode rendu localement (`bwip-js`). Pas de Wallet pour ces cas, mais usage 100 % fonctionnel.

### Pistes futures (non scope phase 1)

- **Google Wallet** est gratuit pour les pass génériques — possible alternative si tu veux Wallet à tout prix un jour. À étudier en phase 5 éventuellement.
- Si un jour le besoin Wallet devient critique, le compte Apple Developer pourra être ajouté sans refonte (l'archi est prête, voir `wallet-reexport/`).

---

## 5. Méthodes d'ajout d'une carte/ticket

L'app doit supporter **5 méthodes** d'ajout, accessibles depuis un bouton FAB unique (« + ») qui ouvre un menu :

1. **Scan caméra** — `getUserMedia` + `@zxing/browser` → détection live QR/barcode.
2. **Saisie manuelle** — formulaire (nom, type, numéro, couleur, date événement…).
3. **Import photo (OCR)** — upload/prise photo → Tesseract.js extrait nom + numéro + tente détection barcode.
4. **Import depuis screenshot QR** ⭐ — l'utilisateur fournit une capture d'écran de son téléphone → détection automatique du QR/barcode dans l'image (zxing supporte les images statiques).
5. **Import email / PDF** — l'utilisateur colle le texte d'un email OU upload le PDF du billet → parser dédié par fournisseur (Ticketmaster, FNAC, See Tickets) avec fallback regex générique.

Chaque méthode pré-remplit le formulaire d'édition pour validation finale par l'utilisateur avant sauvegarde.

---

## 6. Vues principales (UX)

1. **Dashboard** — grille de toutes les cartes (filtre : Fidélité / Billets / À venir).
2. **Détail carte** — affichage plein écran du barcode, **luminosité max auto** (Wake Lock API + max brightness via CSS), fond blanc, gros code. Bouton « Ajouter à Apple Wallet » **visible uniquement si un `.pkpass` d'origine est stocké**.
3. **Ajouter** — bottom sheet avec les 5 méthodes.
4. **Paramètres** — import/export JSON complet, thème, version, stats stockage.

**Tone & design** : minimaliste, sombre par défaut, inspiration Apple Wallet natif (cartes empilées avec parallaxe légère).

---

## 7. Agents Claude à utiliser sur le projet

J'utiliserai les agents suivants. **Chaque agent doit être invoqué via la Task tool de Claude Code** au moment opportun :

### Agents principaux (déjà identifiés)

1. **`frontend-pwa-dev`** — React/TS, Vite, PWA, service workers, IndexedDB. Implémentation des features.
2. **`ux-designer`** — Mockups, theming, palettes, micro-interactions, accessibilité.
3. **`wallet-integration-specialist`** — Détection des `.pkpass` dans emails/PDF, stockage Blob, ré-export propre vers Apple Wallet via MIME type correct, deep links iOS, troubleshooting compatibilité Wallet (sans signer — pas de cert Apple Developer).
4. **`qa-tester`** — Tests E2E Playwright (scan, ajout, export Wallet), tests unitaires Vitest, validation cross-device (iPhone Safari + Mac Safari + Chrome desktop).

### Agents complémentaires (que je te demande d'ajouter)

5. **`ocr-vision-specialist`** ⭐ — Tesseract.js tuning, pré-traitement image (contraste, rotation, crop auto), extraction barcode depuis images statiques. C'est non-trivial et mérite un spécialiste.
6. **`parser-engineer`** ⭐ — Parsing emails de confirmation (Ticketmaster FR/EN, FNAC, See Tickets, Eventim), parsing PDFs avec layouts variables, regex robustes + fallbacks.
7. **`security-engineer`** ⭐ — Hardening service worker, CSP headers stricts, audit des dépendances (Tesseract, zxing, pdf.js sont gros), gestion sécurisée des Blobs `.pkpass` (qui contiennent des données de billet), option de chiffrement de la base IndexedDB avec passphrase.
8. **`devops-pwa`** — Build pipeline, déploiement (Netlify/Vercel), HTTPS obligatoire pour caméra + service worker, mise à jour OTA propre.

### Configuration des agents — à faire EN PHASE 0

Tu dois créer **les 8 fichiers d'agents** dans `.claude/agents/` à la racine du projet, dès la phase 0. Un fichier `.md` par agent avec :

```markdown
---
name: <slug-kebab-case>
description: <quand l'invoquer, en 1-2 phrases — utilisé par Claude pour décider de déléguer>
tools: <liste explicite des outils autorisés, ex: Read, Write, Edit, Grep, Bash>
model: sonnet
---

<system prompt détaillé : rôle, périmètre, règles projet, conventions à respecter,
patterns à éviter, deliverables attendus>
```

**Liste finale des 8 agents à créer en Phase 0** :
1. `frontend-pwa-dev.md`
2. `ux-designer.md`
3. `wallet-integration-specialist.md`
4. `qa-tester.md`
5. `ocr-vision-specialist.md`
6. `parser-engineer.md`
7. `security-engineer.md`
8. `devops-pwa.md`

Chaque system prompt doit explicitement **rappeler les contraintes non-négociables** du projet (section 9) et la **stratégie sans Apple Developer** (section 4). Ces agents seront ensuite invoqués via la `Task` tool pendant les phases 1-4.

---

## 8. Plan de livraison (phases)

### Phase 0 — Bootstrap (1 session)
- [ ] Init repo Vite + React + TS + Tailwind + shadcn.
- [ ] Setup PWA (manifest avec name="Walleo", short_name="Walleo", theme_color="#0A0A0A", background_color="#0A0A0A", icons générés depuis `brand/icon.svg`).
- [ ] Service worker basique.
- [ ] Schema Dexie + données seed pour dev.
- [ ] **Créer les 8 fichiers `.claude/agents/*.md`** (voir section 7 pour la liste et le format).
- [ ] Créer un `CLAUDE.md` racine qui résume les contraintes non-négociables et pointe vers `PROMPT_PROJET.md`.
- [ ] Configurer Tailwind avec la palette Walleo (`walleo-black: #0A0A0A`, `walleo-yellow: #FFD60A`, `walleo-yellow-light: #FFE65A`).

### Phase 1 — CRUD core (1-2 sessions)
- [ ] Dashboard + détail carte + saisie manuelle.
- [ ] Stockage IndexedDB fonctionnel.
- [ ] Affichage barcode (lib `bwip-js` côté rendu).
- [ ] Export/import JSON (backup manuel).

### Phase 2 — Méthodes d'ajout avancées (2 sessions)
- [ ] Scan caméra live (zxing).
- [ ] Import screenshot (zxing sur image).
- [ ] Import photo + OCR (Tesseract).
- [ ] Import PDF + email (parsers dédiés).

### Phase 3 — Affichage barcode plein écran + Wallet ré-export (1 session)
- [ ] Vue détail plein écran avec luminosité max (Wake Lock + brightness CSS).
- [ ] Rendu de tous les formats via `bwip-js`.
- [ ] Détection automatique des `.pkpass` joints dans les imports email/PDF, stockage Blob.
- [ ] Bouton « Ajouter à Apple Wallet » fonctionnel pour les cartes ayant un `.pkpass` d'origine.
- [ ] Test sur iPhone réel — affichage barcode + ajout Wallet via .pkpass d'origine.

### Phase 4 — Polish, QA & Déploiement (1 session)
- [ ] Tests E2E Playwright sur les flows critiques.
- [ ] Audit sécurité (security-engineer).
- [ ] Audit UX final (ux-designer).
- [ ] **Déploiement Netlify** (méthode retenue — voir section 11).

---

## 9. Contraintes & Règles non-négociables

1. **Aucune donnée ne quitte l'appareil**. Le bouton « Ajouter à Wallet » sert uniquement un fichier `.pkpass` déjà signé par le fournisseur d'origine (stocké en local).
2. **Pas de tracking, pas d'analytics, pas de telemetry**.
3. **Pas de backend du tout**. Hébergement statique uniquement (Netlify / Vercel / GitHub Pages).
4. **Pas de signature `.pkpass`** dans cette app — pas de compte Apple Developer requis.
5. **Mobile-first** mais doit être utilisable sur Mac aussi.
6. **TypeScript strict** (`"strict": true`, pas de `any` sauf justifié).
7. **Tests sur les flows critiques** : scan, OCR, parsing email/PDF, ré-export `.pkpass`.

---

## 11. Déploiement — Netlify (HTTPS gratuit, zéro friction)

### Pourquoi pas FTP

L'utilisateur dispose d'un accès FTP sur un serveur perso, **sans HTTPS garanti**. Or HTTPS est **non-négociable** pour cette PWA :
- Service worker (offline, installation) → exige HTTPS.
- Caméra (`getUserMedia`) → exige HTTPS.
- Wake Lock API (luminosité forcée) → exige HTTPS.
- IndexedDB persistance fiable → meilleur en HTTPS.

Donc FTP est exclu sauf si l'hébergeur fournit HTTPS sur le domaine cible (à vérifier au cas par cas — mais même alors, le workflow upload manuel est inférieur à un deploy git-based).

### Méthode retenue : Netlify

1. Repo GitHub privé (gratuit) pour le code source.
2. Connecter le repo à Netlify (gratuit, plan Starter).
3. Build command : `npm run build` — Publish directory : `dist/`.
4. Domaine `<nom-app>.netlify.app` automatiquement en HTTPS via Let's Encrypt.
5. CI/CD automatique : chaque `git push main` déclenche un re-build et déploie en ~1 min.
6. (Optionnel plus tard) brancher un domaine perso : ajouter un CNAME, certificat HTTPS auto.

### Configuration spécifique PWA à inclure

- Fichier `netlify.toml` à la racine avec headers de sécurité (CSP, Permissions-Policy pour camera) et redirections SPA (`/* → /index.html 200`).
- Service worker doit être servi avec `Cache-Control: no-cache` pour permettre les mises à jour.
- Le `manifest.webmanifest` doit avoir le bon MIME type (Netlify le gère natif).

### Plan B si le Wi-Fi familial bloque Netlify (rare)

GitHub Pages — même logique, déploiement via une GitHub Action `actions/deploy-pages`. Légèrement plus de config mais 100 % gratuit aussi.

### Plan C — vraiment uniquement si nécessaire

Build local (`npm run build`) puis upload du contenu de `dist/` via FTP, **uniquement si le serveur fournit HTTPS sur le domaine cible**. Workflow manuel à chaque update.

---

## 12. Premier livrable attendu

Quand tu reçois ce prompt, ta première action doit être :

1. Lire ce document attentivement.
2. Me poser **uniquement les questions bloquantes restantes** (max 3) — ne pas re-poser ce qui est déjà spécifié ici.
3. Créer la structure du projet (Phase 0 complète) en une seule session, **y compris les 8 fichiers `.claude/agents/*.md`** et le `CLAUDE.md` racine.
4. Me livrer un dashboard fonctionnel avec données seed et la possibilité d'ajouter une carte manuellement, plus l'affichage plein écran d'un barcode.

**Ne génère pas tout d'un coup.** Procède phase par phase, en me montrant des écrans / diffs à chaque étape pour validation.

---

*Fin du prompt — version 1.3 — 2026-05-03 — nom & identité Walleo*

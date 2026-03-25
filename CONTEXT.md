# CONTEXT — Projet PayLive

## 1) Objectif du projet

PayLive est une plateforme de live shopping qui permet à des vendeurs de:

- encaisser des commandes via Stripe,
- gérer l’expédition (point relais, domicile, retrait magasin),
- suivre les commandes côté client et côté vendeur,
- générer des documents opérationnels (factures, bordereaux),
- gérer promo codes, avoirs/credits, retours et annulations.

Le produit couvre le flux complet: découverte boutique → checkout client → paiement → création/suivi expédition → post-achat (retour, annulation, payout dashboard).

---

## 2) Stack technique

## Frontend

- React 19 + TypeScript
- Vite 7
- React Router 7
- Tailwind CSS
- Clerk (auth côté UI)
- Stripe Elements / Embedded Checkout
- Leaflet / react-leaflet (sélection de points relais)
- ESLint 9 + Prettier

## Backend

- Node.js + Express 5 + TypeScript
- Supabase (base de données + accès API)
- Stripe (paiement, webhooks, products/prices/promo codes)
- Clerk (auth serveur)
- Boxtal (shipping, tracking, documents)
- Nodemailer + PDFKit (emails et PDFs)

## Infra / déploiement

- Monorepo `frontend/` + `backend/`
- Config Vercel présente (`vercel.json` frontend/backend)
- Speed Insights Vercel côté frontend

---

## 3) Architecture applicative

## Vue d’ensemble

- `frontend/` consomme des endpoints `backend/api/*`.
- `backend/server.ts` monte les routes métier:
  - `stripe`, `stripe.webhook`
  - `boxtal`, `boxtal.webhook`
  - `shipments`
  - `store`
  - `carts`
  - `clerk`, `clerk.webhook`
  - `support`, `admin`, `insee-bce`, `raffle`
- Les webhooks Stripe/Boxtal/Clerk sont traités en `raw body` avant `express.json`.

## Flux métier principaux

- Checkout:
  - UI checkout dans `frontend/src/pages/CheckoutPage.tsx`
  - création de session Stripe via `backend/routes/stripe.ts`
- Paiement confirmé:
  - `backend/routes/stripe.webhook.ts` met à jour stock/shipments/carts, tracking, docs, emails
- Commandes:
  - vue client `frontend/src/pages/OrdersPage.tsx`
  - APIs commandes/retours/annulations dans `backend/routes/shipments.ts`
- Dashboard vendeur:
  - `frontend/src/pages/dashboard/DashboardPage.tsx`
  - données boutique/transactions/payout/factures via `backend/routes/store.ts` + `shipments.ts`

---

## 4) Fichiers principaux

## Racine

- `package.json`: scripts monorepo (`dev`, `build`, `install-all`)
- `README.md`: vue d’ensemble et setup

## Frontend

- `src/App.tsx`: routing principal, pages publiques/privées
- `src/pages/CheckoutPage.tsx`: checkout, shipping selection, paiement
- `src/pages/OrdersPage.tsx`: suivi commandes client, actions batch
- `src/pages/dashboard/DashboardPage.tsx`: pilotage vendeur, actions batch, wallet/payout
- `src/pages/LandingPage.tsx`: landing marketing
- `src/components/ParcelPointMap.tsx`: logique map/réseaux livraison
- `src/components/Header.tsx`: navigation + garde d’accès + panier
- `eslint.config.js`, `.prettierrc`, `tailwind.config.js`, `vite.config.ts`

## Backend

- `server.ts`: bootstrap, middleware, auth gate, routes
- `routes/stripe.ts`: création sessions, logique paiement, promo, shipping payload
- `routes/stripe.webhook.ts`: orchestration post-paiement et stock
- `routes/shipments.ts`: commandes, retours, annulation, bordereaux
- `routes/store.ts`: stock, dashboard, transactions, payout/factures PDF
- `routes/carts.ts`: panier
- `services/emailService.ts`: templates + envoi emails métier
- `services/boxtalCotationFallback.ts`: fallback cotations transport

---

## 5) Conventions de code observées

- TypeScript généralisé frontend/backend.
- Frontend:
  - style React fonctionnel + hooks
  - JSX avec classes Tailwind
  - quotes simples majoritaires
  - typage parfois mixte strict + `any` pragmatique selon zones legacy
- Backend:
  - routes Express orientées domaine
  - gestion erreurs avec `try/catch` + `res.status(...).json(...)`
  - accès Supabase dans les handlers
  - logs explicites en console pour debug opérationnel
- Conventions de format:
  - `.editorconfig`: indent 2 espaces, UTF-8, LF
  - Prettier frontend actif
  - ESLint frontend: `no-undef` désactivé dans config actuelle

---

## 6) Dépendances clés

## Auth

- `@clerk/clerk-react`, `@clerk/express`, `@clerk/backend`

## Paiement

- `stripe`, `@stripe/react-stripe-js`, `@stripe/stripe-js`

## Data

- `@supabase/supabase-js`

## UI / Front

- `react`, `react-dom`, `react-router-dom`, `tailwindcss`, `lucide-react`, `react-icons`

## Livraison / cartographie

- `leaflet`, `react-leaflet`, intégration Boxtal via routes backend

## Docs / emails

- `pdfkit`, `nodemailer`, `qrcode`

---

## 7) Scripts et qualité

## Racine

- `npm run dev`: frontend + backend en parallèle
- `npm run build`: build backend + frontend

## Frontend

- `npm run dev`
- `npm run lint`
- `npm run build`

## Backend

- `npm run dev`
- `npm run build`

---

## 8) Modèle métier (haut niveau)

Entités récurrentes vues dans le code:

- `stores` (infos boutique, owner, slug, settings)
- `stock` (références produits, quantités, mapping Stripe product)
- `carts` (lignes panier client avant paiement)
- `shipments` (commande, statut, tracking, documents, livraison, flags retour)
- transactions/payout (net, fees, statuts, exports PDF)

Statuts rencontrés:

- `PENDING`, `CANCELLED`, `RETURNED`, `DELIVERED`, plus états transporteur (ANNOUNCED, SHIPPED, IN_TRANSIT, etc.).

---

## 9) Intégrations externes

- Stripe: checkout, webhooks, promo codes, products/prices.
- Supabase: persistance centrale.
- Clerk: auth et identité.
- Boxtal: expédition, tracking, documents de transport.
- Services email SMTP via `emailService`.

---

## 10) Notes de maintenance

- Le code contient des zones legacy et des zones récentes: vérifier les types runtime (`boolean`/`string`/`number`) sur certains champs DB avant logique métier.
- Les flows critiques sont sensibles aux statuts de commandes (`CANCELLED`, `RETURNED`, `PENDING`) et aux flags (`document_created`, `is_final_destination`).
- Le dashboard et les actions batch ont des règles d’éligibilité distinctes par action (bordereau, facture, annulation, retour).

---

## 11) Contexte Métier

## 11.1 Le problème que ce projet résout

- **Besoin utilisateur**: vendre en live sans friction opérationnelle (paiement, livraison, suivi, retours), avec moins de manipulations manuelles et moins d’erreurs.
- **Problème historique**: en live commerce, les vendeurs gèrent souvent les commandes en DM/tableurs, ce qui provoque abandons de panier, erreurs de référence, retards d’expédition et comptabilité difficile.
- **Secteur / domaine**: live shopping / social commerce, avec forte composante logistique e-commerce (transporteurs, étiquettes, tracking, retours).

## 11.2 Utilisateurs cibles

- **Vendeurs live (boutiques)**:
  - créer/administrer une boutique,
  - encaisser des ventes en direct,
  - préparer expéditions, générer bordereaux/factures,
  - suivre statuts et retraits de gains (payout).
- **Acheteurs finaux**:
  - payer rapidement via checkout sécurisé,
  - choisir mode de livraison (relais/domicile/magasin),
  - consulter suivi commande,
  - initier un retour selon règles.
- **Ops/Support/Admin**:
  - diagnostiquer incidents paiement/livraison,
  - superviser erreurs webhook, emails, cohérence stock.

## 11.3 Règles métier importantes

- **Éligibilité actions batch dashboard**:
  - bordereau: pas de `store_pickup`, et statut éligible selon règles document/transport.
  - facture: lignes non `CANCELLED` éligibles.
  - annulation: lignes non finalisées + statut compatible.
  - règle récente: en batch, les lignes non éligibles sont ignorées (info toast), au lieu de bloquer toute l’action.
- **Retours**:
  - une commande retournée ne doit pas casser la cohérence stock (restock contrôlé).
  - statut `RETURNED` impacte transactions et affichage dashboard.
  - règles spécifiques selon pays/mode de livraison ont été ajoutées dans le flux retour.
- **Payout / transactions**:
  - alignement entre montants PDF payout et montants dashboard.
  - `Total net` dépend de la somme nette des lignes transactionnelles (incluant cas de retours selon logique métier en place).
- **Promo code**:
  - saisie unique côté checkout.
  - préfixes réservés (ex. `CREDIT-`) non autorisés en saisie utilisateur.
  - validations de format avant envoi à Stripe.
- **Validation statuts et typage runtime**:
  - plusieurs champs DB/API peuvent arriver en bool/number/string; normalisation requise (`document_created`, `status`, flags divers).

## 11.4 Vocabulaire métier / glossaire

- **Shipment**: enregistrement de commande/livraison côté plateforme.
- **Bordereau**: document d’expédition (label transport).
- **Facture**: document comptable de vente.
- **Final destination** (`is_final_destination`): commande considérée livrée/finalisée dans le parcours métier.
- **Payout**: virement vendeur agrégé.
- **Net total / total net**: montant net transactionnel utilisé dans dashboard/payout.
- **Pickup point / point relais**: livraison en point de retrait.
- **Store pickup**: retrait en magasin (pas de transporteur externe).
- **Return requested / RETURNED**: demande de retour / retour validé.
- **Delivery network / shipping offer code**: code transporteur/offre (Boxtal/SendCloud selon flux).
- **Webhook**: événement entrant Stripe/Boxtal/Clerk qui déclenche des traitements backend.

## 11.5 Décisions produit prises

- **Choix faits**:
  - privilégier un parcours vendeur “opérationnel” (batch actions, statuts explicites, toasts clairs).
  - robustifier les règles d’éligibilité plutôt que supposer des données parfaites.
  - unifier l’affichage des statuts et des montants entre dashboard et exports PDF.
  - afficher des badges statut lisibles (`PAYÉE`, `ANNULÉE`, `RETOURNÉE`) plutôt que des détails sensibles.
- **Choix écartés**:
  - bloquer toute action batch si une seule ligne est invalide (écarté au profit de l’ignorance partielle + message info).
  - recalcul complexe des frais dans le PDF quand la valeur fiable existe déjà côté dashboard (écarté pour limiter régressions métier).
  - exposition de détails internes de frais Stripe dans l’UI client/vendeur (réduit pour clarté/confidentialité).

## 11.6 Intégrations externes (dans le contexte métier)

- **Stripe**:
  - checkout/session de paiement, promo codes, paiements et webhooks.
  - source de vérité des événements de paiement.
- **Supabase**:
  - persistance métier (stores, stock, carts, shipments, transactions).
  - support des filtres de statut/flags utilisés dans UI et batch.
- **Clerk**:
  - identité et authentification front/back.
  - contrôle d’accès aux espaces protégés.
- **Boxtal**:
  - cotations, création d’expédition, tracking, documents transport.
  - pivot logistique pour commandes hors retrait magasin.
- **Email (SMTP/Nodemailer)**:
  - notifications transactionnelles (retour, erreurs admin, suivi opérationnel).

## 11.7 Points de friction connus

- **Régressions de calcul de montants** (payout PDF vs dashboard) quand plusieurs règles se superposent.
- **Éligibilité batch ambiguë** si données hétérogènes ou sélections mixtes (partiellement corrigé avec logique “ignore + info”).
- **Statuts transport/commande multiples** pouvant diverger (source webhook vs UI locale).
- **Masquage de contenu email sur Gmail** (zones repliées “3 points”), nécessitant ajustements de structure HTML.
- **Typages runtime instables** (`true` vs `'true'` vs `1`) entraînant des faux négatifs métier.

## 11.8 Règles métier appliquées récemment dans le code

- Traitement batch tolérant:
  - bordereau/facture/annulation ignorent les lignes non éligibles au lieu de bloquer globalement.
- Normalisation robuste de `document_created` pour éviter bouton bordereau grisé à tort.
- Restauration du flux promo code checkout:
  - champ visible,
  - validations métier,
  - transmission `promotionCodeId` à la création de session.
- Ajustements retours:
  - conditions spécifiques BE/CH hors `store_pickup` dans le flux client.
- Harmonisation d’affichage statuts et lignes dashboard (notamment `CANCELLED`/`RETURNED`).

## 11.9 Décisions prises ensemble mais peu documentées

- Priorité donnée à la **cohérence métier perçue** (dashboard/PDF/actions batch) sur des calculs théoriques trop complexes et fragiles.
- Préférence pour des règles **résilientes aux données imparfaites** plutôt qu’un refus systématique.
- Séparation nette entre:
  - règles d’éligibilité UI,
  - exécution backend,
  - feedback utilisateur (toasts explicites).
- Simplification de certains calculs sensibles pour réduire les régressions et faciliter l’audit.

## 11.10 Edge cases métier à surveiller

- Sélection batch mixte (éligible + non éligible).
- Retours partiels avec quantités divergentes de l’achat initial.
- Données shipment incomplètes (payment_id, status, document flags).
- Commandes `store_pickup` qui ne doivent pas suivre les mêmes règles label transport.
- Déphasage temporel webhook/UI (ex: statut pas encore propagé mais action déjà tentée).
- Valeurs de statuts non normalisées (casse, null, vide).
- Clients internationaux (BE/CH/FR) avec règles livraison/retour différentes.

# WealthTrack – Gestion de Portefeuille Crypto & Déclaration Fiscale

WealthTrack est une application web permettant de suivre ses investissements en cryptomonnaies, d'analyser les performances de son portefeuille et de générer des rapports fiscaux sur les plus-values et moins-values réalisées. Les données sont stockées localement dans le navigateur (localStorage) — aucun serveur ni compte requis.

## Fonctionnalités

- **Gestion des transactions** – Enregistrement des achats, ventes et échanges (swap) avec date, montant, prix unitaire et notes.
- **Double affichage EUR / USD** – Les valeurs sont affichées en euros et en dollars grâce au taux de change en temps réel (API Frankfurter).
- **Vue d'ensemble du portefeuille** – Consultation des avoirs actuels avec quantité, prix moyen d'achat et valeur investie.
- **Graphiques de performance** – Visualisation de l'évolution du portefeuille dans le temps.
- **Rapport fiscal** – Calcul automatique des plus-values et moins-values par année, utile pour la déclaration d'impôts.
- **Import / Export** – Export des transactions au format ZIP (CSV) et import depuis un fichier ZIP.
- **Sauvegarde Google Drive** – Sauvegarde et restauration automatique ou manuelle des données via Google Drive (appDataFolder).
- **Interface responsive** – Design moderne avec Tailwind CSS, utilisable sur ordinateur et mobile.

## Captures d'écran

### Vue d'ensemble

![Vue d'ensemble du portefeuille](https://github.com/user-attachments/assets/823bc268-a26a-445b-a96a-c6d2bebd0bc1)

### Graphiques de performance

![Graphiques de performance](https://github.com/user-attachments/assets/67a891c4-38b7-457b-ba41-d74e3ad90261)

### Rapport fiscal

![Rapport fiscal](https://github.com/user-attachments/assets/74413c07-c589-46b0-93f8-229dc868914d)

### Formulaire de transaction

![Formulaire de transaction](https://github.com/user-attachments/assets/1a843d43-2a86-44dc-bf51-eecc3613d57c)

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | React 18, TypeScript, Vite 5 |
| Styles | Tailwind CSS 3, PostCSS, Autoprefixer |
| Icônes | Lucide React |
| Stockage | localStorage (navigateur) |
| Import / Export | JSZip (CSV dans archive ZIP) |
| Taux de change | API Frankfurter (EUR → USD, cache 1 h) |
| Sauvegarde cloud | Google Identity Services + Google Drive REST API |
| Qualité de code | ESLint 9, TypeScript strict |
| Déploiement | GitHub Pages (workflow GitHub Actions) |

## Prérequis

- [Node.js](https://nodejs.org/) ≥ 18
- [npm](https://www.npmjs.com/) ≥ 9

## Installation

```bash
# Cloner le dépôt
git clone https://github.com/Clemkd/wealthtrack.git
cd wealthtrack

# Installer les dépendances
npm install
```

## Configuration

La configuration est optionnelle. Pour activer la sauvegarde Google Drive, créer un fichier `.env` à la racine du projet (voir `.env.example`) :

```env
VITE_GOOGLE_CLIENT_ID=<votre-client-id-google>
```

Pour obtenir un Client ID :

1. Créer un projet sur [Google Cloud Console](https://console.cloud.google.com)
2. Activer l'API Google Drive
3. Créer des identifiants OAuth 2.0
4. Ajouter l'URL de l'application dans les origines JavaScript autorisées

> **Note :** L'application fonctionne entièrement sans cette configuration. La sauvegarde Google Drive est une fonctionnalité optionnelle. Le Client ID peut également être renseigné directement dans l'interface.

## Utilisation

```bash
# Lancer le serveur de développement
npm run dev
```

L'application est accessible par défaut sur `http://localhost:5173`.

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm run dev` | Démarre le serveur de développement Vite |
| `npm run build` | Compile l'application pour la production |
| `npm run preview` | Prévisualise le build de production |
| `npm run lint` | Analyse le code avec ESLint |
| `npm run typecheck` | Vérifie les types TypeScript |

## Structure du projet

```
wealthtrack/
├── public/                  # Fichiers statiques
├── src/
│   ├── components/          # Composants React
│   │   ├── Dashboard.tsx        # Tableau de bord principal (onglets, import/export)
│   │   ├── TransactionForm.tsx  # Formulaire d'ajout de transaction
│   │   ├── TransactionList.tsx  # Historique des transactions (EUR & USD)
│   │   ├── PortfolioStats.tsx   # Statistiques du portefeuille
│   │   ├── PerformanceChart.tsx # Graphiques de performance
│   │   ├── TaxReport.tsx        # Rapport fiscal
│   │   ├── GoogleDriveBackup.tsx # Sauvegarde / restauration Google Drive
│   │   ├── ErrorBoundary.tsx    # Capture des erreurs React
│   │   └── ErrorModal.tsx       # Modale d'erreur réutilisable
│   ├── lib/
│   │   ├── storage.ts           # CRUD transactions (localStorage)
│   │   ├── importExport.ts      # Export/import ZIP (CSV)
│   │   ├── exchangeRate.ts      # Taux EUR/USD (API Frankfurter)
│   │   └── googleDrive.ts       # Client Google Drive (backup/restore)
│   ├── types/
│   │   └── database.ts         # Types TypeScript (Transaction)
│   ├── App.tsx              # Composant racine
│   ├── main.tsx             # Point d'entrée
│   └── index.css            # Styles globaux (Tailwind)
├── .github/
│   └── workflows/
│       └── deploy.yml       # Déploiement GitHub Pages
├── index.html               # Page HTML d'entrée
├── vite.config.ts           # Configuration Vite
├── tailwind.config.js       # Configuration Tailwind CSS
├── tsconfig.json            # Configuration TypeScript
└── package.json             # Dépendances et scripts
```

## Modèle de données

Les transactions sont stockées dans le `localStorage` du navigateur sous la clé `wealthtrack_transactions`.

### Transaction

| Champ | Type | Description |
|---|---|---|
| `id` | `string` | Identifiant unique (UUID) |
| `transaction_type` | `'buy' \| 'sell' \| 'swap'` | Type de transaction |
| `currency_from` | `string \| null` | Devise source (pour les swaps) |
| `currency_to` | `string` | Devise/crypto de destination |
| `amount` | `number` | Quantité échangée |
| `price_per_unit` | `number` | Prix unitaire en EUR |
| `total_value` | `number` | Valeur totale en EUR |
| `price_per_unit_usd` | `number \| null` | Prix unitaire en USD |
| `total_value_usd` | `number \| null` | Valeur totale en USD |
| `transaction_date` | `string` | Date de la transaction (ISO 8601) |
| `notes` | `string` | Notes optionnelles |
| `created_at` | `string` | Date de création (ISO 8601) |
| `updated_at` | `string` | Date de dernière mise à jour (ISO 8601) |

## Déploiement

L'application est automatiquement déployée sur **GitHub Pages** à chaque push sur la branche `main` via le workflow `.github/workflows/deploy.yml`.

Le secret `VITE_GOOGLE_CLIENT_ID` doit être configuré dans **Settings > Secrets and variables > Actions** du dépôt pour activer la sauvegarde Google Drive en production.

## Contribution

Les contributions sont les bienvenues ! Pour contribuer :

1. Forkez le dépôt
2. Créez une branche pour votre fonctionnalité (`git checkout -b feature/ma-fonctionnalite`)
3. Committez vos changements (`git commit -m 'feat: ajout de ma fonctionnalité'`)
4. Poussez la branche (`git push origin feature/ma-fonctionnalite`)
5. Ouvrez une Pull Request

## Licence

Ce projet est sous licence MIT.

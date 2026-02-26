# WealthTrack – Gestion de Portefeuille Crypto & Déclaration Fiscale

WealthTrack est une application web permettant de suivre ses investissements en cryptomonnaies, d'analyser les performances de son portefeuille et de générer des rapports fiscaux sur les plus-values et moins-values réalisées.

## Fonctionnalités

- **Authentification sécurisée** – Inscription et connexion par email/mot de passe via Supabase Auth.
- **Gestion des transactions** – Enregistrement des achats, ventes et échanges (swap) avec date, montant, prix unitaire et notes.
- **Vue d'ensemble du portefeuille** – Consultation des avoirs actuels avec quantité, prix moyen d'achat et valeur investie.
- **Graphiques de performance** – Visualisation de l'évolution du portefeuille dans le temps.
- **Rapport fiscal** – Calcul automatique des plus-values et moins-values par année, utile pour la déclaration d'impôts.
- **Interface responsive** – Design moderne avec Tailwind CSS, utilisable sur ordinateur et mobile.

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | React 18, TypeScript, Vite 5 |
| Styles | Tailwind CSS 3, PostCSS, Autoprefixer |
| Icônes | Lucide React |
| Backend / BDD | Supabase (PostgreSQL, Auth, Row-Level Security) |
| Qualité de code | ESLint 9, TypeScript strict |

## Prérequis

- [Node.js](https://nodejs.org/) ≥ 18
- [npm](https://www.npmjs.com/) ≥ 9
- Un projet [Supabase](https://supabase.com/) (gratuit)

## Installation

```bash
# Cloner le dépôt
git clone https://github.com/Clemkd/wealthtrack.git
cd wealthtrack

# Installer les dépendances
npm install
```

## Configuration

Créer un fichier `.env` à la racine du projet avec les variables suivantes :

```env
VITE_SUPABASE_URL=https://<votre-projet>.supabase.co
VITE_SUPABASE_ANON_KEY=<votre-clé-anon>
```

Ces valeurs sont disponibles dans les paramètres de votre projet Supabase, section **API**.

### Base de données

Appliquer la migration SQL située dans `supabase/migrations/` pour créer la table `transactions` ainsi que les politiques de sécurité (RLS) :

```bash
# Via le CLI Supabase
npx supabase db push
```

Ou exécuter manuellement le fichier `supabase/migrations/20260130191228_create_portfolio_schema.sql` dans l'éditeur SQL de Supabase.

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
│   │   ├── Auth.tsx             # Connexion / Inscription
│   │   ├── Dashboard.tsx        # Tableau de bord principal (onglets)
│   │   ├── TransactionForm.tsx  # Formulaire d'ajout de transaction
│   │   ├── TransactionList.tsx  # Historique des transactions
│   │   ├── PortfolioStats.tsx   # Statistiques du portefeuille
│   │   ├── PerformanceChart.tsx # Graphiques de performance
│   │   └── TaxReport.tsx        # Rapport fiscal
│   ├── contexts/
│   │   └── AuthContext.tsx      # Contexte d'authentification React
│   ├── lib/
│   │   └── supabase.ts         # Client Supabase
│   ├── types/
│   │   └── database.ts         # Types TypeScript (schéma BDD)
│   ├── App.tsx              # Composant racine
│   ├── main.tsx             # Point d'entrée
│   └── index.css            # Styles globaux (Tailwind)
├── supabase/
│   └── migrations/          # Migrations SQL
├── index.html               # Page HTML d'entrée
├── vite.config.ts           # Configuration Vite
├── tailwind.config.js       # Configuration Tailwind CSS
├── tsconfig.json            # Configuration TypeScript
└── package.json             # Dépendances et scripts
```

## Schéma de la base de données

### Table `transactions`

| Colonne | Type | Description |
|---|---|---|
| `id` | `uuid` | Identifiant unique (clé primaire) |
| `user_id` | `uuid` | Référence à l'utilisateur authentifié |
| `transaction_type` | `text` | Type : `buy`, `sell` ou `swap` |
| `currency_from` | `text` | Devise source (pour les swaps) |
| `currency_to` | `text` | Devise/crypto de destination |
| `amount` | `decimal(20,8)` | Quantité échangée |
| `price_per_unit` | `decimal(20,8)` | Prix unitaire en EUR |
| `total_value` | `decimal(20,8)` | Valeur totale en EUR |
| `transaction_date` | `timestamptz` | Date de la transaction |
| `notes` | `text` | Notes optionnelles |
| `created_at` | `timestamptz` | Date de création de l'enregistrement |
| `updated_at` | `timestamptz` | Date de dernière mise à jour |

La sécurité au niveau des lignes (RLS) garantit que chaque utilisateur accède uniquement à ses propres transactions.

## Contribution

Les contributions sont les bienvenues ! Pour contribuer :

1. Forkez le dépôt
2. Créez une branche pour votre fonctionnalité (`git checkout -b feature/ma-fonctionnalite`)
3. Committez vos changements (`git commit -m 'feat: ajout de ma fonctionnalité'`)
4. Poussez la branche (`git push origin feature/ma-fonctionnalite`)
5. Ouvrez une Pull Request

## Licence

Ce projet est sous licence MIT.

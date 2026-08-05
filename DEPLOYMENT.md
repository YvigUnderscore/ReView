# Déploiement production — ReView

Guide pas-à-pas pour déployer une instance ReView (un studio = une instance) derrière
un reverse-proxy nginx en HTTPS.

> **Développement local** : `docker compose up -d` charge automatiquement
> `docker-compose.override.yml` (Postgres/Redis exposés, `NODE_ENV=development`).
> **Production** : déployer **sans** l'override, avec l'overlay prod (ci-dessous).

## 1. Prérequis

- Un serveur Linux avec Docker + Docker Compose.
- Un nom de domaine pointant (A/AAAA) vers le serveur (ex. `review.mystudio.com`).
- Ports 80 et 443 ouverts.

## 2. Configuration (`.env`)

Copier `.env.example` → `.env` et renseigner des **secrets forts** (obligatoire en prod —
`config/env.ts` **refuse de démarrer** avec un secret par défaut/faible) :

```bash
cp .env.example .env
# JWT_SECRET : ≥ 32 caractères aléatoires
openssl rand -hex 32
```

Valeurs critiques à ne PAS laisser par défaut :

| Variable | Contrainte production |
|----------|-----------------------|
| `JWT_SECRET` | ≥ 32 caractères aléatoires (pas de `change_me…`) |
| `CORS_ORIGIN` | URL exacte du frontend (ex. `https://review.mystudio.com`) — **jamais `*`** |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | identifiants MinIO réels (**pas** `minioadmin`) |
| `POSTGRES_PASSWORD` | mot de passe fort |
| `S3_PUBLIC_ENDPOINT` | URL publique MinIO/CDN vue par le navigateur |

## 3. Certificats TLS (Let's Encrypt / Certbot)

```bash
# Installer certbot puis générer le certificat (mode standalone, ports 80/443 libres)
sudo certbot certonly --standalone -d review.mystudio.com

# Copier les certificats là où nginx les attend
mkdir -p nginx/certs
sudo cp /etc/letsencrypt/live/review.mystudio.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/review.mystudio.com/privkey.pem  nginx/certs/
```

Éditer `nginx/nginx.conf` et remplacer `YOUR_DOMAIN` par le domaine réel.

> **Renouvellement** : `certbot renew` + recopier les `.pem` + `docker compose ...
> restart nginx` (à automatiser via cron/systemd timer).

## 4. Lancement

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

L'overlay prod :

- ajoute **nginx** en reverse-proxy HTTPS (TLS 1.2/1.3, HSTS, en-têtes de sécurité) ;
- retire les ports directement exposés de `backend`/`frontend` (accès via nginx seul) ;
- n'expose pas la console MinIO (port 9001) — y accéder via tunnel SSH/VPN ;
- fixe `NODE_ENV=production` (garde-fous secrets/CORS actifs).

## 5. Initialisation

```bash
# Migrations Prisma (dans le conteneur backend)
docker compose exec backend npx prisma migrate deploy
```

Puis ouvrir `https://review.mystudio.com` → assistant de configuration (studio + compte admin).

> ⚠️ **Terminer l'assistant immédiatement.** Tant qu'aucun studio n'existe, `POST /api/setup`
> est ouvert : le premier venu peut créer le compte ADMIN. L'assistant se referme
> définitivement dès la création du studio (et il est limité à 10 requêtes / 15 min / IP).
> Pour ne prendre aucun risque, faire l'initialisation avant d'ouvrir les ports 80/443 au
> public, ou depuis un tunnel SSH.

## 6. Vérifications

- `https://review.mystudio.com/api/health` → `{"status":"ok"}`
- `https://review.mystudio.com/api/docs` → documentation OpenAPI (Scalar)
- Certificat valide (cadenas navigateur), redirection HTTP→HTTPS effective.

## Sécurité — rappels

- Le partage client public (`/api/client`, `/api/share`) est soumis à un **rate limit**
  renforcé par IP.
- Les secrets ne sont jamais commités : `.env` est gitignoré.
- Sauvegarder régulièrement le volume Postgres et le bucket MinIO.
- **L'inscription libre est fermée par défaut** (`ALLOW_SELF_REGISTRATION=false`) : les
  comptes se créent depuis l'administration ou par provisionnement SSO. L'ouvrir expose
  l'instance à la création de comptes par n'importe qui — et permet de réserver l'email
  d'un collaborateur avant sa première connexion SSO.
- **Ne jamais relancer un service de production avec `docker compose up` seul** :
  `docker-compose.override.yml` (développement) serait auto-chargé, repassant backend et
  worker en `NODE_ENV=development` — donc sans les garde-fous de `config/env.ts` — et
  republiant Postgres et Redis. Toujours passer les deux fichiers :
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
- Postgres, Redis, MinIO et Grafana n'écoutent que sur la **boucle locale** hors production
  (`MINIO_BIND` / `DEV_BIND` / `GRAFANA_BIND` pour exposer sciemment) ; en production, seul
  nginx publie des ports.

## Licence — obligations de l'exploitant

ReView est sous **AGPL-3.0-or-later**. Deux points à traiter avant la mise en production :

- **Instance modifiée** : l'article 13 impose d'offrir vos sources à tous ceux qui
  utilisent l'instance à distance, invités des liens de partage compris. Publiez votre
  dépôt puis renseignez son URL dans **Admin → Réglages → « Code source (AGPL §13) »** :
  elle alimente les liens « Code source » de la page de connexion, des pages client et de
  **Admin → Système**. Sans modification du code, il n'y a rien à faire.
- **Images Docker republiées** : l'image backend embarque ffmpeg (GPL-2.0-or-later) et,
  avec `INSTALL_USD_TOOLS=1`, Blender (GPL-2.0-or-later). Les rediffuser oblige à
  transmettre l'offre de source correspondante — pointer les sources amont Debian et
  Blender suffit tant que vous ne les avez pas modifiées.

Détail complet : `DOCUMENTATION/development/licensing.md`.

# Production deployment — ReView

A short, step-by-step guide to putting one ReView instance (one studio = one instance) behind
the bundled nginx reverse proxy over HTTPS, by hand.

> **Prefer the installer.** `bash scripts/install.sh` does everything below by itself — draws
> every secret, writes `.env`, renders the nginx configuration for your domain, obtains a
> certificate, starts the stack and waits until it is healthy — without modifying a single
> versioned file. It is documented, together with every environment variable and the two
> production gates, in
> [`DOCUMENTATION/getting-started/installation.md`](DOCUMENTATION/getting-started/installation.md).
> This page is the manual path, for when you want to see each step.

> **Local development**: a bare `docker compose up -d` auto-loads
> `docker-compose.override.yml` (PostgreSQL and Redis published on the loopback,
> `NODE_ENV=development`). **Production** runs **without** that override, with the production
> overlay described below.

## 1. Prerequisites

- A Linux server with Docker Engine and **Docker Compose v2 ≥ 2.24** — the production overlay
  uses the `!reset` operator, which older Compose silently ignores, leaving host ports open.
- A domain name pointing (A/AAAA) at the server, e.g. `review.mystudio.com`.
- Ports 80 and 443 open.

## 2. Configuration (`.env`)

Copy `.env.example` to `.env` and set **strong secrets**. In production the backend and the
worker validate their environment at boot (`backend/src/config/env.ts`) and **refuse to start**
with a default or weak value:

```bash
cp .env.example .env
openssl rand -hex 32   # one per secret
```

Values that must not keep their default:

| Variable | Production requirement |
|----------|------------------------|
| `JWT_SECRET` | ≥ 32 random characters (no `change_me…` placeholder) |
| `APP_ENCRYPTION_KEY` | Optional — derived from `JWT_SECRET` when absent; same strength rule when set |
| `CORS_ORIGIN` | Exact frontend URL (e.g. `https://review.mystudio.com`) — **never `*`** |
| `POSTGRES_PASSWORD` | Strong password |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Real MinIO credentials (**not** `minioadmin`). Compose passes them to the backend and the worker as `S3_ACCESS_KEY` / `S3_SECRET_KEY` — do not set those two yourself |
| `S3_PUBLIC_ENDPOINT` | Public storage URL the browser calls — with the bundled nginx, `https://<domain>` |
| `APP_URL` | Public URL of the instance, used for links in outgoing mail (links are omitted without it) |

The full variable reference, and which of these Compose itself refuses to start without, is in
[Installation → Environment variables](DOCUMENTATION/getting-started/installation.md#environment-variables).

## 3. TLS certificates (Let's Encrypt / Certbot)

```bash
# Install certbot, then issue the certificate (standalone mode, port 80 must be free)
sudo certbot certonly --standalone -d review.mystudio.com

# Copy the certificates where nginx expects them
mkdir -p nginx/certs
sudo cp /etc/letsencrypt/live/review.mystudio.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/review.mystudio.com/privkey.pem  nginx/certs/
```

Edit `nginx/nginx.conf` and replace `YOUR_DOMAIN` with the real domain.

> `nginx/nginx.conf` is a versioned file: once edited, `scripts/update.sh` refuses to run until
> the change is committed or reverted. The installer avoids this by rendering a copy into
> `deploy/nginx.conf` instead.

> **Renewal** is not automated: `certbot renew`, copy the `.pem` files again, then
> `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart nginx` (schedule it
> with cron or a systemd timer).

## 4. Start

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The production overlay:

- adds **nginx** as the HTTPS reverse proxy (TLS 1.2/1.3, HSTS, security headers) — the only
  service publishing host ports (80 and 443);
- removes every host port from `frontend`, `backend` and `minio` — MinIO is then reached
  through `https://<domain>/review/…`, and its console only over an SSH tunnel or a VPN;
- turns `JWT_SECRET`, `CORS_ORIGIN`, `S3_PUBLIC_ENDPOINT`, `POSTGRES_PASSWORD`,
  `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` into hard requirements: Compose refuses to start
  while one is unset.

`NODE_ENV=production` (and with it the boot-time guards) comes from `docker-compose.yml`
itself; it is the development override that switches it back to `development`.

> ⚠️ **Behind an existing reverse proxy** (Cloudflare, Nginx Proxy Manager, Traefik…) it is
> tempting to point that proxy straight at the `frontend` container. **That is not enough**:
> `frontend/nginx.conf` only routes `/api/` and `/socket.io/`. The route to MinIO is missing,
> and every upload fails with a "network error" (the presigned PUT lands on the SPA). Deploy
> the `nginx` service of this overlay — over plain HTTP on a free port if TLS is terminated
> upstream — and point the existing proxy at it.
>
> In that case `S3_PUBLIC_ENDPOINT` must carry the **public** scheme (`https://…`): it is the
> URL the backend signs and the browser calls. With `http://`, the browser rejects the
> presigned URLs as mixed content.

## 5. Initialisation

Database migrations are applied automatically: the backend runs `prisma migrate deploy` at
every start (`backend/start.sh`) and exits without touching the database if a migration fails.

Then open `https://review.mystudio.com` → setup wizard (studio + admin account). See
[First run](DOCUMENTATION/getting-started/first-run.md).

> ⚠️ **Finish the wizard immediately.** As long as no studio exists, `POST /api/setup` is open:
> whoever gets there first creates the ADMIN account. The wizard closes for good as soon as the
> studio is created, and its write endpoints are limited to 10 requests per 15 minutes per IP.
> To take no risk at all, initialise before opening ports 80/443 to the public, or through an
> SSH tunnel.

## 6. Checks

- `https://review.mystudio.com/api/health` → `{"status":"ok", …}` (liveness);
  `/api/health/ready` also checks the database, Redis and storage.
- `https://review.mystudio.com/api/docs` → OpenAPI reference (Scalar).
- Valid certificate (browser padlock), HTTP→HTTPS redirect in place.
- `curl -s https://review.mystudio.com/review/anything | head -1` → **HTML**, not an
  `AccessDenied` XML document. The bucket (`review`) and the application's review route share
  the same URL prefix: nginx tells them apart by the request signature (see
  `nginx/nginx.conf`), and XML here would mean review pages are being served by MinIO.
- Drop a file on an asset: the upload must complete. It validates the MinIO route, the scheme
  of `S3_PUBLIC_ENDPOINT` and the signature in one go.

## Security reminders

- The public client sharing endpoints (`/api/client`, `/api/share`) sit behind a stricter
  per-IP **rate limit**.
- Secrets are never committed: `.env` is gitignored.
- Back up the PostgreSQL volume and the MinIO bucket regularly — `scripts/backup.sh`, see
  [Backups & restore](DOCUMENTATION/infrastructure/backups.md).
- **Self-registration is closed by default** (`ALLOW_SELF_REGISTRATION=false`): accounts are
  created from the administration or provisioned by SSO. Opening it lets anyone create an
  account — and reserve a colleague's email address before their first SSO sign-in.
- **Never restart a production service with a bare `docker compose up`** on a hand-deployed
  instance: `docker-compose.override.yml` would be auto-loaded, switching backend and worker to
  `NODE_ENV=development` — without the `config/env.ts` guards — and republishing PostgreSQL and
  Redis. Always pass both files:
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
  (An instance set up by `scripts/install.sh` pins its files in `COMPOSE_FILE`, so a bare
  `docker compose` is safe there.)
- Outside production, PostgreSQL, Redis, MinIO and Grafana listen on the **loopback only**
  (`DEV_BIND` / `MINIO_BIND` / `GRAFANA_BIND` to expose them deliberately); in production, only
  nginx publishes ports.

## License — operator obligations

ReView is licensed under **AGPL-3.0-or-later**. Two points to settle before going live:

- **Modified instance**: section 13 requires you to offer your sources to everyone who uses the
  instance over the network, share-link guests included. Publish your repository, then set its
  URL in **Admin → Studio → Studio identity → "Source code (AGPL §13)"**: it feeds the "Source
  code" links on the sign-in page, the client pages and **Admin → System**. An unmodified
  instance has nothing to do.
- **Republished Docker images**: the backend and worker images (both built from
  `backend/Dockerfile`) ship FFmpeg (GPL-2.0-or-later), and the worker built with
  `INSTALL_USD_TOOLS=1` — the compose default — adds Blender (GPL-2.0-or-later).
  Redistributing them means passing on the matching source offer — pointing to the upstream Debian and Blender sources is enough as long
  as you have not modified them.

Full details: [`DOCUMENTATION/development/licensing.md`](DOCUMENTATION/development/licensing.md).

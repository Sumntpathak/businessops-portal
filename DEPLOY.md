# Deploying Recepto to a live server

This document is written to be handed to a fresh coding agent (Claude, Kiro, etc.)
with zero prior context on this project. It assumes a clean Ubuntu 22.04+ server
reachable via SSH, with root or sudo access, and two DNS domains you control.

If you are a human reading this instead of an agent: the "Agent prompt" block
below is what you paste into a fresh agent session on the remote server to have
it execute this whole guide for you.

---

## What you're deploying

A three-service stack:
- **web** — Next.js dashboard (signup, login, agent config, bookings, calls)
- **voice** — Fastify server that answers Twilio calls and bridges audio to
  Azure OpenAI Realtime
- **postgres** + **redis** — data and queues
- **caddy** — reverse proxy that terminates HTTPS automatically (Let's Encrypt)

All five run via Docker Compose. `docker-compose.yml` is the base (dev-oriented,
bind-mounts source, hot reload). `docker-compose.prod.yml` is an overlay that
switches `web`/`voice` to their built production images, drops host port
bindings (Caddy fronts them instead), and adds the `caddy` service.

## Prerequisites you must have before starting

1. **A server** with a public IP — any VPS (Hetzner, DigitalOcean, Linode, etc.),
   minimum 2 vCPU / 4GB RAM.
2. **Two domains or subdomains**, e.g. `app.example.com` (web dashboard) and
   `voice.example.com` (voice webhooks). Both must have an **A record** pointing
   at the server's public IP before you start Caddy — it requests real
   Let's Encrypt certificates on boot and will fail if DNS isn't live yet.
3. **All third-party credentials already provisioned**, gathered in one place
   before you begin:
   - A Twilio Account SID + Auth Token (the *platform* account — individual
     clients connect their own via the in-app Settings page later)
   - An Azure OpenAI resource with a `gpt-realtime-mini` deployment, its
     endpoint URL and API key
   - An Anthropic API key
   - A Brave Search API key
   - A Google Cloud OAuth client (Client ID + Secret) with
     `https://<web-domain>/api/auth/callback/google` added as an authorized
     redirect URI
   - Git access to this repository (SSH key or HTTPS token)

## Steps

### 1. Server setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git

# Docker Engine + Compose plugin (official install script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker   # or log out and back in

docker --version
docker compose version
```

### 2. Firewall

Only these ports need to be open to the internet: 22 (SSH), 80, 443 (Caddy).
Postgres (5432) and Redis (6379) must **not** be exposed publicly in
production — the prod compose overlay already strips their host port
bindings, but if you're using `ufw`, lock it down explicitly too:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 3. Clone the repository

```bash
sudo mkdir -p /opt/recepto && sudo chown "$USER":"$USER" /opt/recepto
git clone <YOUR_GIT_REMOTE_URL> /opt/recepto
cd /opt/recepto
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in every value. The critical production-specific ones:

```bash
# Strong, unique — never reuse the dev default.
SESSION_SECRET=$(openssl rand -hex 32)

# Strong, unique Postgres password — never leave as "recepto" on a real server.
POSTGRES_DB=recepto
POSTGRES_USER=recepto
POSTGRES_PASSWORD=$(openssl rand -hex 24)

# Your two DNS domains from the prerequisites step.
WEB_DOMAIN=app.example.com
VOICE_DOMAIN=voice.example.com

# Must be https:// and match the domains above exactly.
PUBLIC_WEB_URL=https://app.example.com
PUBLIC_VOICE_URL=https://voice.example.com

# Must match the redirect URI registered in Google Cloud Console.
GOOGLE_REDIRECT_URI=https://app.example.com/api/auth/callback/google
```

Then fill in `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`,
`AZURE_REALTIME_URL`, `AZURE_REALTIME_KEY`, `ANTHROPIC_API_KEY`,
`BRAVE_SEARCH_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` with the
real values gathered in the prerequisites step.

Leave `AZURE_SIP_ENABLED=false` unless you have specifically set up the Azure
SIP connector (see `scripts/azure-sip-setup.sh` — separate, optional flow).

**Do not commit `.env`.** It's already gitignored; double-check with
`git status` before any commit that it does not appear.

### 5. Build and start

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The `migrate` service runs once, applies all database migrations, and exits
successfully before `web` and `voice` start (they wait on it via
`depends_on: condition: service_completed_successfully`). This is automatic —
you do not need to run migrations separately.

Watch it come up:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
```

Expect: `postgres` and `redis` report healthy, `migrate` logs
"migrations applied successfully" and exits 0, then `web` and `voice` start,
and `caddy` logs certificate issuance for both domains (this can take up to a
minute on first boot).

### 6. Verify

```bash
curl -sf https://voice.example.com/health
# {"ok":true,"uptime":...}

curl -sfI https://app.example.com/
# HTTP/2 200 (or a redirect to /login)
```

If either fails, check `docker compose ... logs caddy` first — the most common
cause is DNS not yet propagated to this server's IP, which makes Let's
Encrypt's HTTP-01 challenge fail.

### 7. Point Twilio at this server

In the Twilio Console, or via the API, set the phone number's Voice webhook to:

```
https://voice.example.com/twilio/incoming
```
Method: `POST`.

(New clients signing up through the dashboard's Settings page do this
automatically for their own numbers — this manual step is only needed for the
platform's own seed/test number, if any.)

### 8. Confirm a real call works end-to-end

Call the connected number. Watch live logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f voice
```

Then check the dashboard at `https://app.example.com/dashboard/calls` — the
call and its live transcript should appear.

## Day-2 operations

**Deploying new code** (after `git pull` on the server):

```bash
cd /opt/recepto
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
The `migrate` service re-runs automatically and safely skips migrations
already applied.

**Viewing logs for one service:**
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f voice
```

**Restarting one service without a full rebuild:**
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart voice
```

**Database backups** — Postgres data lives in the `postgres_data` named
volume. At minimum, set up a daily dump:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backup-$(date +%F).sql.gz"
```
Automate this with a cron job and ship the file off-server (S3, rsync, etc.) —
a backup that only lives on the same disk as the database is not a backup.

**Rotating secrets** — after changing any value in `.env`, run:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
Compose recreates only the containers whose config actually changed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Caddy won't issue a certificate | DNS A record missing or not propagated | `dig +short app.example.com` must return this server's IP before retrying |
| `migrate` container exits non-zero | Bad `DATABASE_URL` or Postgres not healthy yet | `docker compose ... logs postgres` and `logs migrate` |
| Twilio calls get "application error" | `voice` container down, or webhook URL wrong | `docker compose ... ps`, confirm the Twilio number's Voice URL matches `PUBLIC_VOICE_URL` exactly |
| Google Calendar connect fails | Redirect URI mismatch | Must exactly equal `GOOGLE_REDIRECT_URI` in `.env`, registered verbatim in Google Cloud Console |
| 502 from Caddy | Backend container crashed or still starting | `docker compose ... logs web` / `logs voice` |

---

## Agent prompt

Paste the block below into a fresh agent session (Claude Code, Kiro, etc.)
running **on the target server itself** (or with SSH access to it), after
filling in the bracketed placeholders. It performs the entire guide above
autonomously and reports back.

```
You are deploying the "Recepto" application to this server for the first time.
Full deployment instructions are in DEPLOY.md at the repository root — read it
completely before doing anything.

Repository: [GIT_REMOTE_URL]
Target directory: /opt/recepto
Web domain: [WEB_DOMAIN]  (must already point at this server's IP via DNS A record)
Voice domain: [VOICE_DOMAIN]  (must already point at this server's IP via DNS A record)

Credentials to use when filling in .env (treat these as secrets — do not log
them, do not commit them, do not print them back to me except when you first
receive them from me in this prompt):

  TWILIO_ACCOUNT_SID=[VALUE]
  TWILIO_AUTH_TOKEN=[VALUE]
  TWILIO_NUMBER=[VALUE]
  AZURE_REALTIME_URL=[VALUE]
  AZURE_REALTIME_KEY=[VALUE]
  ANTHROPIC_API_KEY=[VALUE]
  BRAVE_SEARCH_API_KEY=[VALUE]
  GOOGLE_CLIENT_ID=[VALUE]
  GOOGLE_CLIENT_SECRET=[VALUE]

Do the following, in order, stopping to ask me only if something in
DEPLOY.md's prerequisites is missing or a step fails in a way the
troubleshooting table doesn't cover:

1. Install Docker Engine + Compose plugin if not already present.
2. Configure the firewall to allow only 22, 80, 443.
3. Clone the repository to /opt/recepto.
4. Copy .env.example to .env and fill in every value — generate strong random
   values for SESSION_SECRET and POSTGRES_PASSWORD yourself (openssl rand),
   set WEB_DOMAIN/VOICE_DOMAIN/PUBLIC_WEB_URL/PUBLIC_VOICE_URL/
   GOOGLE_REDIRECT_URI from the domains above, and use the credentials I gave
   you for the rest. Double check with `git status` that .env is NOT tracked
   by git before proceeding.
5. Build and start the full stack with the prod overlay:
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
6. Watch logs until postgres/redis are healthy, migrate has applied
   migrations and exited 0, and web/voice/caddy are all running.
7. Verify: curl -sf https://[VOICE_DOMAIN]/health returns {"ok":true,...},
   and curl -sfI https://[WEB_DOMAIN]/ returns a 2xx or redirect (not a
   connection error or 502).
8. Report back: what's running, the verification curl outputs, and the exact
   webhook URL (https://[VOICE_DOMAIN]/twilio/incoming) that needs to be set
   on the Twilio number's Voice configuration — I will do that step myself
   since it requires my Twilio console access.

If any step fails, consult the Troubleshooting table in DEPLOY.md first. Do
not skip TLS/HTTPS setup, do not expose Postgres or Redis ports publicly, and
do not use placeholder/default passwords in the final .env.
```

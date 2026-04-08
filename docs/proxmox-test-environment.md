# Proxmox Test Environment

## Goal

Run Kairis in a Proxmox-hosted test environment using Docker Compose, with local persistence for development data and optional Neon-backed Postgres connectivity.

## Deployment Model

- Proxmox hosts a Linux VM or LXC capable of running Docker
- Docker Compose runs the Kairis app container
- local test data is persisted in `./proxmox-data`
- Neon-backed Postgres remains the intended managed backend when configured
- Cloudflare R2 remains the intended export artifact target when configured
- Coinbase assisted live trading remains disabled in test by default

## Files

- `Dockerfile`
- `docker-compose.proxmox-test.yml`
- `.env.proxmox-test.example`
- `scripts/proxmox-preflight.mjs`
- `scripts/proxmox-deploy.mjs`

## Expected Host Requirements

- Docker Engine
- Docker Compose plugin
- git
- Node is not required on the host if you deploy only the built container flow

## Manual Setup

1. Clone the repo onto the Proxmox test host.
2. Copy `.env.proxmox-test.example` to `.env.proxmox-test`.
3. Fill in `DATABASE_URL` for the active Neon branch or database.
4. Leave `EXCHANGE_PROVIDER=mock` and `ENABLE_LIVE_ASSISTED_TRADING=false` for initial testing.
5. Run the preflight:

```bash
npm run proxmox:preflight
```

6. Bring up the container:

```bash
docker compose -f docker-compose.proxmox-test.yml up -d --build
```

## Health Check

Verify:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/system/status
```

Expected status details:

- `services.database` = `configured`
- `services.databaseProvider` = `neon`
- `storage.persistence` = `postgres`
- `services.r2` = `configured`
- `services.coinbase` = `missing`

## One-Command Deploy Helper

If Node is available on the Proxmox host, use:

```bash
npm run proxmox:deploy
```

This runs the repo preflight and prints the exact host-side compose and health-check commands.

## GitHub Actions Deployment

The repository now includes a real manual deployment workflow in [deploy.yml](/C:/Users/steve/projects/Kairis/.github/workflows/deploy.yml) for the `proxmox-test` target.

Configure these GitHub environment secrets in the `test` environment before using it:

- `PROXMOX_HOST`: host or IP of the Proxmox VM or LXC running Docker
- `PROXMOX_PORT`: SSH port, usually `22`
- `PROXMOX_USER`: SSH user on the test host
- `PROXMOX_SSH_KEY`: private key for that SSH user
- `PROXMOX_APP_DIR`: absolute path to the existing repo checkout on the host
- `PROXMOX_TEST_ENV_FILE`: full contents of `.env.proxmox-test`

The workflow will:

- validate the app on GitHub Actions with typecheck and production build
- SSH to the Proxmox host
- `git fetch` and `git pull` the selected branch
- write `.env.proxmox-test` from `PROXMOX_TEST_ENV_FILE`
- run `docker compose -f docker-compose.proxmox-test.yml up -d --build`
- verify `/api/health` and `/api/system/status`

## Notes

- `proxmox-data/` is intentionally local and not checked into git.
- If managed Postgres is not configured, the app falls back to local JSON persistence.
- If R2 is not configured, exports are written to local storage.
- `R2_PUBLIC_URL` may use a Cloudflare `r2.dev` development URL for test environments. For production, switch artifact delivery to a custom domain rather than leaving user-facing files on `r2.dev`.
- This environment is for validation and beta-style testing, not production.

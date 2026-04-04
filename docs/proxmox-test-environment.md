# Proxmox Test Environment

## Goal

Run Kairis in a Proxmox-hosted test environment using Docker Compose, with local persistence for development data and optional Supabase cloud connectivity.

## Deployment Model

- Proxmox hosts a Linux VM or LXC capable of running Docker
- Docker Compose runs the Kairis app container
- local test data is persisted in `./proxmox-data`
- Supabase remains the intended managed backend when configured
- Cloudflare R2 remains the intended export artifact target when configured
- Coinbase assisted live trading remains disabled in test by default

## Files

- `Dockerfile`
- `docker-compose.proxmox-test.yml`
- `.env.proxmox-test.example`
- `scripts/proxmox-deploy.mjs`

## Expected Host Requirements

- Docker Engine
- Docker Compose plugin
- git
- Node is not required on the host if you deploy only the built container flow

## Manual Setup

1. Clone the repo onto the Proxmox test host.
2. Copy `.env.proxmox-test.example` to `.env.proxmox-test`.
3. Fill in Supabase values if the cloud project is ready.
4. Leave `EXCHANGE_PROVIDER=mock` and `ENABLE_LIVE_ASSISTED_TRADING=false` for initial testing.
5. Run:

```bash
docker compose -f docker-compose.proxmox-test.yml up -d --build
```

## Health Check

Verify:

```bash
curl http://localhost:3000/api/health
```

## Notes

- `proxmox-data/` is intentionally local and not checked into git.
- If Supabase is not configured, the app falls back to local JSON persistence.
- If R2 is not configured, exports are written to local storage.
- `R2_PUBLIC_URL` may use a Cloudflare `r2.dev` development URL for test environments. For production, switch artifact delivery to a custom domain rather than leaving user-facing files on `r2.dev`.
- This environment is for validation and beta-style testing, not production.

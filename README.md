# Kairis <sub>`>o)`</sub>

Kairis is a non-custodial crypto trading workspace built around disciplined execution: rule-based
signals that explain themselves, a risk engine that checks every order against the user's own limits,
paper trading, and assisted orders on the user's own Coinbase account that never go out without an
explicit confirmation.

## License

This repository is proprietary and is not open source. See [LICENSE](LICENSE) for the governing terms.

## What works today

- **Sign in and sign up** through the `kairis` realm on qavren-auth (Keycloak, public PKCE client
  `kairis-web`). Every row Kairis stores is keyed by the Keycloak `sub`.
- **Onboarding**: scope explanation, a required risk acknowledgment, a preferred mode (paper, manual,
  assisted). Everyone starts in paper.
- **Signals**: BTC-USD, ETH-USD and SOL-USD on hourly Coinbase candles. An EMA 9/21 cross within the
  last 3 candles, confirmed by RSI 14 between 45 and 70. Wide spreads (above 0.5 %), ATR spikes
  (above 6 % of price) and stale data (ticker older than 5 minutes, candle older than 3 hours) block
  or fail closed. Each signal carries its rationale and a suggested size (ATR 14 against 25 % of the
  daily loss cap). Every evaluation is stored.
- **Risk engine**: global pause (kill switch), fresh data, provider health, valid size, max position
  after the fill, per-symbol caps, a sell needs a position, trades per day, daily loss cap, and a
  cooldown after a loss streak. Outcomes are `approved`, `blocked` or `halted`, each with reasons.
- **Paper trading**: simulated fills at the Coinbase reference price, positions, realized P&L, and a
  journal that keeps blocked attempts with their reasons.
- **Coinbase connection**: per-user Coinbase Developer Platform keys. Kairis reads the key's
  permissions, rejects any key that can transfer funds, and stores the private key sealed with
  AES-256-GCM under `KAIRIS_SECRET_KEY`.
- **Assisted trades**: preview, explicit confirm, submit, reconcile. The order row id is sent as the
  exchange `client_order_id`. Live submission is blocked unless `ENABLE_LIVE_ASSISTED_TRADING=true`.
  Reconciliation reads order status back from Coinbase.
- **Records**: a filterable journal of audit events and CSV exports (paper journal, assisted orders,
  audit log) to a private Cloudflare R2 bucket, or local files when R2 is not configured. Exports are
  downloaded only through the signed-in `/app/reports/download/<id>` route.
- **Owner operations**: system status, reconcile, and an auto cycle that runs only for owners and only
  when `ENABLE_AUTO_MODE` and `ENABLE_LIVE_ASSISTED_TRADING` are both true. It opens long positions
  on fresh signals and never sells.

Limits: Coinbase only, spot only. P&L and limits only see trades made through Kairis. Exports written
to the container's local disk are lost on redeploy unless R2 is configured.

Production is `https://kairis.qavrensolutions.com` on the shared Qavren hub. It goes live when the owner
completes the one-time steps in [docs/deployment.md](docs/deployment.md). Live submission and auto mode
ship disabled.

## Screens

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/sign-in` | Sign in through the Keycloak realm |
| `/app` | Dashboard with the kill switch |
| `/app/onboarding` | Scope, risk acknowledgment, preferred mode |
| `/app/signals` | Current signals with rationale |
| `/app/paper` | Paper trading |
| `/app/trade` | Assisted trade flow: preview, confirm, submit |
| `/app/controls` | Trading limits and per-symbol caps |
| `/app/journal` | Audit journal |
| `/app/exchange` | Coinbase key connection |
| `/app/reports` | CSV exports |
| `/app/operations` | Owner only: status, reconcile, auto cycle |

API: `/api/health` (liveness), `/api/system/status` (readiness: database, R2, secret key), `/api/auth/*`.

## Local setup

Prerequisites: Node (see `.nvmrc`), Docker Desktop.

```bash
npm ci
npm run db:up                      # Postgres 17 on 127.0.0.1:55433 (compose.dev.yaml)
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # paste as AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # paste as KAIRIS_SECRET_KEY
npm run db:migrate                 # applies db/migrations, tracked in schema_migrations
npm run dev                        # http://localhost:3000
```

Sign-in uses the `kairis-dev` realm on qavren-auth (`QAVREN_REALM=kairis-dev` in `.env.example`), which
allows `http://localhost:3000/*` as a redirect URI. See [docs/identity.md](docs/identity.md).

## Quality gates

```bash
npm run lint
npm run typecheck
npm run test
npm run build
pwsh scripts/scan-secrets.ps1
```

The integration tests need a Postgres on localhost: run `npm run db:up` and set
`DATABASE_URL=postgres://kairis:kairis@localhost:55433/kairis`.

## Deploy

One image (`kairis-web`) in ECR, deployed over SSM to the shared hub behind a Cloudflare tunnel. A tag
like `20261009_v1_Release` triggers `.github/workflows/deploy-prod.yml`: build and push, migrate the
database, write the host `.env`, restart, wait for `/api/health`, smoke the public URL. Details in
[docs/deployment.md](docs/deployment.md) and [infra/README.md](infra/README.md).

## Source-of-truth decisions

- `Kairis` is the product name; beginner retail crypto traders are the first public audience.
- Paper mode is the default starting experience. Public value is control and safer execution, not
  profit promises.
- Public unattended automation is not offered. The auto cycle is owner-only and env-gated.
- Data lives in the `kairis` schema on qavren-db (shared Supabase Pro project, one schema and role per
  app). Postgres is required; there is no JSON fallback.
- Identity is a Keycloak realm per app on qavren-auth: `kairis` for production, `kairis-dev` for localhost.
- Hosting is the shared Qavren hub behind a Cloudflare tunnel. No per-app server.
- Cloudflare R2 holds exports when configured; local files otherwise.
- GitHub Actions is the CI/CD system. AWS access is OIDC only.

The ADR log is [DECISIONS.md](DECISIONS.md).

## Document map

- Strategy: [Brand + Business Brief](docs/brand-business-brief.md), [Business Plan](docs/business-plan.md)
- Product and design: [PRD](docs/prd.md), [PDD](docs/pdd.md)
- System and data: [SDD](docs/sdd.md), [Data Flow Diagram](docs/diagrams/data-flow-diagram.md),
  [Database](docs/database.md), [Identity](docs/identity.md), [Deployment](docs/deployment.md)
- Risk and commercialization: [Risk and Compliance Memo](docs/risk-compliance-memo.md),
  [Pricing and Packaging](docs/pricing-packaging-brief.md), [Marketing Guide](docs/marketing-guide.md),
  [Go-to-Market Plan](docs/go-to-market-launch-plan.md)
- Brand assets: [Logo concepts](assets/logos/README.md), [Threshold K](assets/logos/kairis-threshold-k.svg)
- Governance: [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [DECISIONS](DECISIONS.md)

## Brand

Name `Kairis` (KAI-riss, from *kairos*, the right moment). Selected logo direction: Threshold K.
Palette: Obsidian `#111315`, Bone `#E9E4D8`, Sage Signal `#708B7A` (paper mode accent), Brass Index
`#C8B27A` (live mode accent). Non-custodial, centralized-exchange, spot only; no withdrawal permission
on exchange keys.

# Deployment

Kairis runs on the shared Qavren hub (`Qavren-Web-Server`) as one container (`kairis-web`) plus its own
`cloudflared` sidecar, published at `https://kairis.qavrensolutions.com`. The image lives in ECR
(`kairis-web`). Data is the `kairis` schema on qavren-db; identity is the `kairis` realm on qavren-auth.
There is no test environment: CI and the local compose stack cover pre-production.

## Moving parts

| Piece | Owner | Where |
|---|---|---|
| ECR repo, OIDC role, hub tag and pull policy, tunnel, DNS, tunnel token in SSM | Terraform | `infra/` |
| Host `.env` | GitHub environment `Prod` | variable `DOTENV_CONTENT` (config) plus one secret per secret value |
| Schema migrations | deploy job, before the restart | `scripts/db-migrate.mjs` with `QAVREN_DB_PROD_SESSION_URL` |
| Restart and health wait | SSM command from the deploy job | `/opt/kairis` on the hub |

The tunnel token reaches the host through SSM Parameter Store (`/kairis/prod/tunnel_token`), read at
deploy time. It never goes through GitHub secrets. See [infra/README.md](../infra/README.md).

## One-time owner steps

Status 2026-10-10: all steps below are done and `20261010_v1_Release` is live at
`https://kairis.qavrensolutions.com` (`/api/system/status`: database connected, R2 and secret key
configured). Realms `kairis` and `kairis-dev` run on the hosted Keycloak with self-registration and
an `owner` realm role (qavren-auth PR #178). The Google broker redirect URIs are on the OAuth client
the hosted Keycloak uses, `884887387558-o14g…` ("qavren-auth"); the local `.env` names a different
client (`…m8oj…`, "shared realms"), so check the hosted one first when Google returns
`redirect_uri_mismatch`. The qavren-db role password was rotated and both database URLs are `Prod`
secrets. Terraform state for `infra/` is local and gitignored. `KAIRIS_OWNER_EMAILS` is set.

Run these in order. They need credentials an agent session does not hold. `<qavren-auth>` and
`<qavren-db>` are your local checkouts of those repos.

### a. Keycloak realms (qavren-auth)

Generate both realm files from the fleet template. Without `-Apply` this only writes the files:

    pwsh <qavren-auth>/tools/provision-app.ps1 -App kairis -DisplayName Kairis -RedirectUris 'https://kairis.qavrensolutions.com/*'
    pwsh <qavren-auth>/tools/provision-app.ps1 -App kairis-dev -DisplayName Kairis -RedirectUris 'http://localhost:3000/*'

(`-Apply` loads the realms into the local Keycloak from qavren-auth's compose file. It does not touch
the hosted server.)

The template sets `registrationAllowed: false`, so only the Google button would work for new users.
To allow email sign-up, edit both generated files (`realms/apps/kairis.yaml`, `realms/apps/kairis-dev.yaml`)
the way `realms/apps/fairsquare.yaml` does: replace `registrationAllowed: false` with the block below.
Self-registration never ships without email verification, and a default action avoids the
`verifyEmail: true` flag, which re-checks every existing account at every login.

```yaml
registrationAllowed: true
verifyEmail: false
requiredActions:
  - alias: VERIFY_EMAIL
    name: Verify Email
    providerId: VERIFY_EMAIL
    enabled: true
    defaultAction: true
    priority: 50
    config: {}
```

To use the realm role `owner` instead of `KAIRIS_OWNER_EMAILS`, add it under `roles.realm`
(`- name: owner`). Commit both files in qavren-auth through a PR, then push them to the hosted Keycloak
from a pwsh prompt, running the script in-process (its header explains why `pwsh ./update-realms.ps1`
does not work with list arguments):

    & <qavren-auth>/infra/update-realms.ps1 -Realm kairis
    & <qavren-auth>/infra/update-realms.ps1 -Realm kairis-dev

`-Realm` selects which `realms/apps/<realm>.yaml` is pushed; `-AllRealms` pushes every realm and is not
needed here. The script needs AWS CLI auth and qavren-auth's Terraform state.

Both realms broker Google through the shared client. Add these to that client's Authorized redirect
URIs (see qavren-auth `docs/google-oauth-setup.md`), or the Google button fails with
`redirect_uri_mismatch`:

    https://auth.qavrensolutions.com/realms/kairis/broker/google/endpoint
    https://auth.qavrensolutions.com/realms/kairis-dev/broker/google/endpoint

### b. Database password (qavren-db)

The `kairis` schema and role already exist on qavren-db (manifest `apps/kairis.yaml`, environments test
and prod). Rotate the password to learn it; the script prints a password only on creation or rotation.
It needs `QAVREN_DB_PROD_ADMIN_URL` (and the pooler host and project ref variables) set, see qavren-db
`.env.example`:

    pwsh <qavren-db>/tools/provision-app.ps1 -App kairis -Env prod -Apply -RotatePassword

It prints `password=`, `session_url=` (port 5432) and `pooler_url=` (port 6543) once. It does not write
any GitHub secret; you set them yourself in step d. The `pooler_url` goes into `DATABASE_URL` below.
The `session_url` becomes `QAVREN_DB_PROD_SESSION_URL`.

### c. Terraform

    cd infra
    cp terraform.tfvars.example terraform.tfvars   # fill in the Cloudflare values
    terraform init
    terraform plan -out tfplan
    terraform apply tfplan
    terraform output

### d. GitHub variables and secrets

The deploy job runs in the GitHub environment `Prod`. The host `.env` is assembled from one
variable holding the non-secret configuration plus one secret per secret value, so a rotation never
means retyping the rest.

Already set on 2026-10-10 (repository): variables `AWS_REGION=us-east-1`,
`ECR_REGISTRY=918981046515.dkr.ecr.us-east-1.amazonaws.com`; secret `AWS_OIDC_ROLE_ARN` =
`arn:aws:iam::918981046515:role/kairis-github-actions` (valid once Terraform has applied).
Already set on 2026-10-10 (environment `Prod`): variable `DOTENV_CONTENT` (the block below),
variables `R2_ACCOUNT_ID`, `R2_BUCKET=kairis-prod`, `R2_PUBLIC_URL` (empty), secrets
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `AUTH_SECRET`, `KAIRIS_SECRET_KEY`.

Still to set, from step b's output:

    gh secret set DATABASE_URL --env Prod --repo stevenfackley/Kairis --body "<pooler_url, port 6543>"
    gh secret set QAVREN_DB_PROD_SESSION_URL --env Prod --repo stevenfackley/Kairis --body "<session_url, port 5432>"

`DOTENV_CONTENT` is a variable, so it can be read back and edited line by line:

    gh variable get DOTENV_CONTENT --env Prod --repo stevenfackley/Kairis

`EXTRA_ENV_CONTENT` (optional secret) is appended after it for one-off overrides. The deploy
appends `AUTH_SECRET`, `KAIRIS_SECRET_KEY`, `DATABASE_URL`, the five `R2_*` values, `ECR_REGISTRY`,
`IMAGE_TAG` and `TUNNEL_TOKEN` itself.

### e. Release

From an up-to-date `main` after the PR is merged:

    git tag 20261010_v1_Release && git push origin 20261010_v1_Release

`deploy-prod` builds `prod-<sha>` and `latest`, runs migrations, writes `/opt/kairis/.env` and
`compose.prod.yaml` over SSM, restarts, waits for the container to report healthy on `127.0.0.1:3040`,
then curls the public `/api/health`. To redeploy a ref, run the workflow manually with `ref`. Then check:

    curl -s https://kairis.qavrensolutions.com/api/system/status

`database` should read `connected`, `secretKey` `configured`.

### f. Later flips

1. Set `KAIRIS_OWNER_EMAILS` (or assign the realm role `owner`) so `/app/operations` works for you.
2. Set `ENABLE_LIVE_ASSISTED_TRADING=true` only after a real Coinbase key is connected and the legal
   review in the risk memo is done. Auto mode additionally needs `ENABLE_AUTO_MODE=true`.

Both are edits to the `DOTENV_CONTENT` variable followed by a redeploy.

## `DOTENV_CONTENT`: the non-secret configuration

Set as an environment variable on `Prod`. Secrets are separate (see step d); do not put them here.

```
NEXT_PUBLIC_APP_NAME=Kairis
NEXT_PUBLIC_APP_ENV=production
APP_BASE_URL=https://kairis.qavrensolutions.com
AUTH_URL=https://kairis.qavrensolutions.com
AUTH_TRUST_HOST=true
QAVREN_AUTH_URL=https://auth.qavrensolutions.com
QAVREN_REALM=kairis
KAIRIS_OWNER_EMAILS=
ENABLE_LIVE_ASSISTED_TRADING=false
ENABLE_AUTO_MODE=false
LOCAL_DATA_DIR=.local-data
```

Secrets on `Prod`: `AUTH_SECRET` and `KAIRIS_SECRET_KEY` (32 random bytes, base64 each; generated
and set 2026-10-10, keep an offline copy of `KAIRIS_SECRET_KEY`), `DATABASE_URL` (pooler URL, role
`kairis.<ref>`, port 6543), `QAVREN_DB_PROD_SESSION_URL` (port 5432, migrations only),
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Variables on `Prod`: `R2_ACCOUNT_ID`, `R2_BUCKET`,
`R2_PUBLIC_URL`. `NEXT_PUBLIC_*` values are also baked into the image at build time by the
Dockerfile, so changing them needs a rebuild, not just a redeploy.

Generate each random value with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Losing `KAIRIS_SECRET_KEY` means every user reconnects their exchange key. Without the R2 values, exports
fall back to the container's disk and are lost on redeploy. Terraform does not create the R2 bucket.

## Rollback

Run `deploy-prod` manually with the previous release tag as `ref`. Migrations are additive and
idempotent, so an older image runs against the newer schema.

## Stale items to clean up

The scaffold-era setup left these behind. None of them are used by the current workflows.

- GitHub environments `Test` and `Prod` on `stevenfackley/Kairis` still carry `SUPABASE_*` secrets,
  `DATABASE_URL` (Test), a `PROXMOX_TEST_ENV_FILE` secret, `DATABASE_PROVIDER=neon`, and `SUPABASE_URL`
  variables. The Supabase URL points at project `kcsngjxpjlwawdykzmih`, which is gavel-suite's
  Supabase project, not a Kairis one. Delete the secrets and variables, then the environments.
- On that Supabase project, check the `public` schema for six stray Kairis tables created by the old
  scaffold migrations: `onboarding_states`, `trading_limits`, `paper_trades`, `audit_events`,
  `export_artifacts`, `assisted_orders`. Drop them if present, after confirming gavel-suite does not use
  tables with those names.

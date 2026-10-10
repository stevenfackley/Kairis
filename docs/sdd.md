# System Design Document

## System Goal

Define a high-level architecture for Kairis that supports non-custodial spot trading workflows on centralized exchanges with strong control boundaries between signal generation, execution, and audit logging.

## Architecture Overview

Primary subsystems:

- user application
- identity and entitlement layer
- exchange integration layer
- market data and signal engine
- execution orchestration service
- risk control engine
- audit log and reporting layer

## Deployment Assumptions

The system runs on shared Qavren platform services rather than per-app infrastructure:

- data lives in the `kairis` schema on qavren-db, a shared Supabase Pro Postgres project with one schema and login role per app; Postgres is required and there is no local-file fallback
- identity is a Keycloak realm per app on qavren-auth (`kairis` in production, `kairis-dev` for localhost), consumed through `@qavren/auth-next`
- the application runs as one container on the shared Qavren hub (`Qavren-Web-Server`), published through a Cloudflare tunnel at `kairis.qavrensolutions.com`; the image is stored in ECR and deployed over SSM
- `Cloudflare R2` is the object storage layer for exports and generated reports; without R2 credentials exports go to local disk
- `GitHub Actions` is the CI/CD mechanism for validation, packaging, and deployment; AWS access is OIDC only
- there is no test environment; CI and a local Postgres compose stack cover pre-production

Design consequence:

- keep the application stateless apart from Postgres and R2
- do not depend on database session state, because production traffic goes through a transaction pooler
- do not add per-app servers; new hosting goes on the shared hub

See [deployment](deployment.md), [database](database.md) and [identity](identity.md).

## Boundary Rules

- Kairis does not hold user funds
- exchange credentials are limited to trading-related permissions
- withdrawal permission is disallowed
- public execution authority is mode-gated

## High-Level Components

### User Application

Responsibilities:

- onboarding
- mode selection
- signal review
- confirmation workflows
- settings and exports

### Identity And Entitlements

Responsibilities:

- account ownership
- plan tier
- eligibility flags
- internal owner-only capabilities

Critical rule:

- payment tier alone must not enable unattended automation

Implementation assumption:

- credentials and sign-in are handled by qavren-auth; Kairis keys its records by the Keycloak subject and keeps entitlements and account metadata in its own Postgres schema

### Exchange Integration Layer

Responsibilities:

- secure key handling
- balances and positions sync
- order placement and cancellation
- fill reconciliation

### Signal Engine

Responsibilities:

- consume market data
- evaluate strategy logic
- produce candidate trade actions with rationale

### Risk Control Engine

Responsibilities:

- enforce exposure limits
- block unsafe orders
- pause execution on degraded conditions
- maintain cooldown logic

### Execution Orchestration

Responsibilities:

- translate validated actions into exchange-specific orders
- prevent duplicates
- handle retries safely
- separate manual, assisted, and auto flows

### Audit And Reporting

Responsibilities:

- store signal inputs and outcomes
- store approvals and order lifecycle events
- generate exports for user review and accounting support

Implementation assumption:

- structured operational records live in the `kairis` Postgres schema on qavren-db
- file-based exports and generated artifacts should be stored in Cloudflare R2

## Execution Flow By Mode

### Manual

- signal produced
- user reviews details
- user submits order
- execution recorded

### Assisted

- signal produced
- risk engine validates
- user approves
- system submits order
- execution recorded

### Auto

- signal produced
- risk engine validates
- policy check confirms eligible automation
- system submits order
- execution recorded

## Failure Handling

- stale market data blocks new automated actions
- exchange degradation triggers halt state
- duplicate client order identifiers prevent replays
- reconciliation jobs compare local state to exchange state after faults

## Security Considerations

- least-privilege key guidance
- encrypted secret storage
- event audit trail for critical actions
- owner-only mode isolated from public entitlement paths

Infrastructure-specific considerations:

- avoid storing secrets in client-visible contexts
- keep exchange credentials outside of object storage paths
- treat R2 as artifact storage, not secret storage
- use the shared platform services (qavren-db, qavren-auth, the hub) before introducing custom ops overhead
- use `r2.dev` public URLs only for test or development environments; production artifact delivery should move to a custom domain under the Kairis-controlled DNS surface

## Non-Functional Requirements

- transparent logs
- deterministic control evaluation
- resilient exchange sync
- safe failure defaults
- a container image that runs the same locally (against the dev compose Postgres) and on the hub
- CI/CD workflows that are compatible with GitHub Actions as the system of record

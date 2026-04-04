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

The initial system design should reflect available infrastructure:

- `Supabase Pro` is the default managed backend for authentication, relational data, and operational records
- `Cloudflare R2` is the default object storage layer for exports, generated reports, and file-like artifacts
- local `Proxmox` is the intended host for test environments
- only `AWS EC2` is assumed to be available from AWS, and it is the intended production deployment target
- `GitHub Actions` is the default CI/CD mechanism for validation, packaging, and deployment
- the application runtime should be lightweight enough to run in local Proxmox-based test environments

Design consequence:

- prefer managed components for stateful infrastructure
- keep stateless application services portable
- avoid architecture that depends on heavy always-on self-managed infrastructure in the first release

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

- user identity, entitlements, and account metadata should live in Supabase-managed data stores unless later requirements force separation

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

- structured operational records should live in Supabase
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
- use managed platform controls where possible before introducing custom ops overhead

## Non-Functional Requirements

- transparent logs
- deterministic control evaluation
- resilient exchange sync
- safe failure defaults
- portability between local Proxmox test environments and AWS EC2 production hosting
- CI/CD workflows that are compatible with GitHub Actions as the system of record

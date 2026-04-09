# Data Flow Diagram

## Overview

This document describes the logical data movement for Kairis. It is intentionally textual so it can serve as a source of truth before a visual diagram is produced.

## External Actors

- user
- centralized exchange
- market data providers

## Internal Systems

- web or desktop client
- identity and entitlement service
- signal engine
- risk control engine
- execution orchestrator
- exchange adapter
- audit log store
- reporting and export service

## Infrastructure Mapping

- identity, entitlements, operational records, and other relational data are assumed to live in managed `Postgres`, currently `Supabase`
- generated exports and file-like artifacts are assumed to live in `Cloudflare R2`
- application services should remain portable between local Proxmox test environments and AWS EC2 production hosting

## Core Flows

### 1. Onboarding And Account Connection

1. User creates an account in the client.
2. Client sends identity and plan information to the identity service.
3. User submits exchange API credentials.
4. Client passes credential material to secure storage through the exchange adapter.
5. Exchange adapter validates connectivity and supported permissions.
6. Validation result is stored in the audit log and surfaced to the client.

### 2. Market Signal Generation

1. Market data provider sends price and market state inputs to the signal engine.
2. Signal engine evaluates strategy rules.
3. Signal engine emits a candidate action with rationale.
4. Candidate action is stored in the audit log.
5. Candidate action is sent to the client for manual review or to downstream validation for assisted or automated flows.

### 3. Risk Evaluation

1. Candidate action is sent to the risk control engine.
2. Risk control engine reads user limits, entitlement state, and account context.
3. Risk control engine returns either `approved`, `blocked`, or `halted`.
4. Decision and reason are stored in the audit log.
5. Client receives the decision state and explanation.

### 4. Assisted Execution

1. Approved candidate action is displayed to the user.
2. User confirms the trade.
3. Client sends approval to execution orchestrator.
4. Execution orchestrator submits order through the exchange adapter.
5. Exchange returns order status and fills.
6. Fill events are stored in the audit log and passed to reporting.

### 5. Automated Execution

1. Approved candidate action is checked against automation policy.
2. Execution orchestrator confirms the account is eligible for auto mode.
3. Order is sent to exchange adapter.
4. Exchange status and fills are reconciled back into audit and reporting systems.

### 6. Reporting And Export

1. Audit log store aggregates orders, fills, fees, and user actions.
2. Reporting service builds journal, performance, and export views.
3. Export artifacts are written to R2-backed storage.
4. User downloads records from the client.

## Control Notes

- manual and assisted modes both require visible user interaction
- auto mode must be policy-gated separately from billing
- all decision points write to the audit log
- live and paper trading data should remain logically separated

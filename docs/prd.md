# Product Requirements Document

## Product Goal

Build a non-custodial crypto trading product that helps users act with more discipline by separating market insight from execution authority.

## Users

### Primary Persona

Beginner retail trader:

- understands basic spot trading
- wants guidance and guardrails
- is likely to make mistakes under pressure
- values clear explanations and safety defaults

### Secondary Persona

More advanced user:

- wants repeatability
- expects logs, exports, and controls
- may graduate into deeper configuration and automation

### Internal Owner Persona

Founder operator:

- uses stricter automation internally
- validates automation workflows before any public release

## Core Jobs To Be Done

- Understand when a signal is actionable
- See trade size and risk before submitting
- Switch between manual and assisted workflows without changing products
- Review what happened after a trade
- Stop trading quickly when conditions degrade

## Product Scope

### In Scope

- centralized exchange spot account connections
- manual mode
- assisted mode
- paper trading / simulation
- trade history and decision logging
- risk controls
- exports for reporting

### Out Of Scope For V1

- brokerage or custody
- DEX wallet automation
- leverage, margin, or perpetuals
- social or copy trading
- public full automation by default

## Execution Modes

### Manual Mode

- users receive signals and trade context
- users review sizing, risk, and order preview
- users submit trades themselves

### Assisted Mode

- users connect exchange accounts
- the system prepares orders and controls
- users explicitly approve execution

### Auto Mode

- system may place trades under predefined limits
- internal owner mode only at launch
- public availability requires later policy approval

## Core Requirements

### Onboarding

- explain product scope clearly
- require risk acknowledgment
- guide exchange key setup with withdrawals disabled
- default first-time users into paper mode

### Market Workflow

- display signal, rationale, sizing suggestion, and risk summary
- provide preview before any live action
- expose mode-specific CTAs

### Controls

- max position size
- daily loss limit
- max trades per day
- cooldown after loss streak
- per-symbol limits
- global trading pause

### Records

- log every signal evaluation
- log all user approvals
- log order attempts, fills, failures, and cancellations
- export fills and fees

### Reliability

- handle stale quotes
- avoid duplicate submissions
- recover safely after outages
- fail closed for auto execution

## Success Metrics

- weekly active users in paper mode
- conversion to assisted live mode
- percentage of users enabling safety controls
- reduction in support issues related to order confusion
- retained paid users after 30 and 90 days

## Acceptance Criteria

- manual and assisted modes are clearly distinguishable
- no public user can accidentally access unattended automation
- logs are usable for support and user review
- live workflows do not require withdrawal permissions


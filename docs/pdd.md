# Product Design Document

## Design Objective

Design Kairis as a calm, structured trading workspace that reduces impulsive action and keeps execution authority visible at all times.

## Product Tone

- serious, not sterile
- supportive, not promotional
- precise, not crowded

The interface should feel like a control room, not a casino.

## Core UX Principles

- show mode before action
- show risk before confirmation
- default to slower, safer paths for beginners
- make the kill switch easy to find
- keep logs and rationale close to execution history

## Primary User Journeys

### New User Journey

1. Land on product explanation
2. Learn the difference between paper, manual, and assisted modes
3. Connect exchange with trade-only API key
4. Start in paper mode
5. Review first signal and order preview

### Live Assisted Journey

1. Receive qualified signal
2. Inspect sizing, limits, and rationale
3. Confirm order
4. Review fill status
5. Review post-trade log

### Safety Intervention Journey

1. User sees loss threshold or degraded exchange health
2. Product surfaces warning state
3. User pauses trading or system enforces halt
4. User reviews reason and next steps

## Core Screens

- marketing / onboarding landing page
- account setup and API connection flow
- portfolio and mode dashboard
- signal review panel
- order preview and confirmation flow
- execution log and trade journal
- controls and limits settings
- export/reporting page

## Interaction Requirements

- mode state must be visible on every execution-capable screen
- irreversible steps require explicit confirmation
- warnings should be plain-language and specific
- paper and live environments must be visually distinct

## Content Rules

- never imply guaranteed returns
- explain "why this signal fired" in user language
- explain why a trade was blocked when controls intervene
- describe limits as protection, not friction

## Accessibility And Usability

- clear color contrast between paper and live states
- keyboard-navigable confirmation flows
- risk warnings should not rely on color alone
- logs should be scannable and filterable

## Acceptance Criteria

- beginners can identify current mode without training
- a user can review risk controls before placing a first live order
- a paused or blocked state is understandable without support


# Risk And Compliance Memo

## Purpose

This memo defines the intended operating boundary for Kairis so that product, design, and marketing decisions stay aligned with a lower-risk software posture.

## Intended Operating Posture

- non-custodial
- no pooled customer funds
- software product, not exchange infrastructure
- centralized exchange spot only at launch

## Product Boundary

Kairis should be implemented and described as:

- a trading support and execution control system
- a tool that helps users connect their own exchange accounts
- a product that can enforce user-defined limits and record decisions

Kairis should not be implemented or described as:

- holding assets
- accepting deposits
- routing withdrawals
- offering margin or derivative trading in v1
- guaranteeing performance

## API Permission Rule

Supported exchange credentials must be restricted to:

- reading balances
- reading orders and fills
- placing and canceling spot orders

Unsupported:

- withdrawal permissions

## Automation Boundary

- internal owner automation may exist for founder use
- public automation must be treated as separately gated capability
- billing tier must not be the only gate for public auto mode

## Marketing Guardrails

Disallowed positioning:

- passive income claims
- guaranteed outcome language
- "beat the market" promises
- selective performance claims without robust support

Allowed positioning:

- safer execution
- structured decision support
- clearer controls
- better records and visibility

## Product Risks

- users may misunderstand the role of software versus exchange behavior
- support burden may increase when losses are emotionally charged
- tax and reporting complexity can become a retention problem
- public automation may raise additional legal review needs before launch

## Operational Requirements

- strong audit logs
- clear user acknowledgments
- visible difference between paper and live mode
- kill switch and halt states
- plain-language explanation when an action is blocked

## Review Trigger Conditions

Seek specialized legal review before expanding into:

- leverage or derivatives
- pooled or managed capital
- copy trading
- auto mode for broad retail release
- personalized recommendations framed as advice


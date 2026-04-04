# Business Plan

## Executive Summary

Kairis is a non-custodial software product for crypto traders that helps users move between manual, assisted, and eventually automated spot trading on centralized exchanges. The initial business objective is to establish a trusted trading operations layer for retail users who need clearer guardrails than typical charting apps and more control than typical bot products.

## Problem

Retail crypto trading tools are fragmented:

- charting tools stop at analysis
- exchanges optimize for transactions, not discipline
- bots often emphasize automation before users are ready
- users lack reliable logs, limits, and tax-friendly records

Beginners are especially exposed to preventable mistakes:

- entering trades impulsively
- misusing API keys
- overtrading
- misunderstanding slippage and partial fills
- failing to track results cleanly

## Solution

Kairis provides one system with staged execution modes:

- `Manual`: signal review, sizing support, order preview, user-submitted orders
- `Assisted`: guided order creation and user confirmation with stronger control rails
- `Auto`: automated spot execution within predefined risk limits, initially internal only

## Market Focus

Initial target segment:

- U.S.-adjacent retail crypto users on centralized exchanges
- users comfortable with software subscriptions but not with institutional tools

Entry wedge:

- beginner-friendly safety and execution support

Expansion path:

- advanced trader tooling
- premium reporting
- qualified public automation

## Product Strategy

Kairis will win by being easier to trust than a bot and more actionable than a dashboard.

Key strategic choices:

- centralized exchange spot only for v1
- no custody
- no wallet-first DEX execution in v1
- strong simulation and paper workflows
- strict logging and kill-switch controls

## Infrastructure Strategy

Kairis should use existing managed infrastructure where it reduces operational burden.

Initial infrastructure assumptions:

- `Supabase Pro` is the default backend platform for database, auth, and core managed application data
- `Cloudflare R2` is the preferred object storage layer for exports, artifacts, and other file-oriented outputs
- local `Proxmox` is the intended platform for test environments
- only `AWS EC2` is assumed to be available from AWS, and it is the intended production hosting target
- `GitHub Actions` is the default CI/CD layer for validation and deployment workflows
- the application runtime should stay light enough for local Proxmox-based test deployments

Business implication:

- reduce time spent on infrastructure before product fit is proven
- favor lower-ops managed services over premature platform complexity
- keep architecture portable enough to support local Proxmox test environments and EC2-based production hosting without assuming broader AWS services
- keep delivery workflows simple and repo-native through GitHub Actions

## Revenue Model

Primary revenue:

- recurring subscription

Likely packaging:

- Free: signals, paper mode, limited analytics
- Pro: exchange connections, assisted mode, risk controls, exports, deeper analytics
- Future premium: qualified automation and advanced operational tooling

Potential secondary revenue later:

- annual plans
- premium tax/reporting add-ons
- expert templates or strategy packs if legally supportable

## Distribution

Primary channels:

- founder-led content
- trading communities
- educational content around discipline and risk
- controlled beta waitlist

Channel rule:

- growth must not depend on earnings claims

## Competitive Position

Kairis is differentiated by:

- explicit execution modes
- beginner-safe control layers
- stronger auditability
- trust-forward positioning

It should not attempt to compete on:

- maximal exchange coverage at launch
- high-frequency execution
- promises of outperformance

## Operating Risks

- regulatory ambiguity around public automation
- user blame for losses despite clear controls
- support burden from exchange API misconfiguration
- thin retention if the product does not save users time or reduce mistakes

## Milestones

1. Documentation-first alignment
2. Internal founder mode and paper/sim workflows
3. Private beta for beginner retail users
4. Paid assisted-mode launch
5. Evaluate public automation eligibility later

## Financial Assumptions

- low initial infrastructure cost relative to regulated finance products
- higher than expected support and education overhead
- slower acquisition if trust copy is conservative, but better retention quality
- managed services are preferred early because founder time is more constrained than raw hosting cost

## Success Metrics

- paper-to-live conversion rate
- paid conversion from free signals users
- retention after first live month
- percentage of users using risk controls
- support tickets per active account

# Kairis

Kairis is a documentation-first fintech project for a non-custodial crypto trading system built around disciplined execution, visible risk controls, and mode-based trading workflows.

The repository starts with the business and product source of truth before any application scaffolding. The intent is to align brand, market, user experience, system boundaries, and launch strategy before code introduces avoidable drift.

## License

This repository is proprietary and is not open source.

See [LICENSE](LICENSE) for the governing terms.

## What Kairis Is

Kairis is intended to be a trader operating layer, not a broker and not a hype-driven trading bot. The product thesis is that most retail traders need better control over execution, not just more signals.

Core product idea:

- `Manual mode`: user reviews signals and submits trades directly
- `Assisted mode`: system prepares trades and controls, user confirms execution
- `Auto mode`: system may place trades under hard limits, initially internal only

## Working Brand

- Name: `Kairis`
- Pronunciation: `KAI-riss`
- Root: inspired by `kairos`, the opportune or right moment
- Brand meaning: disciplined timing and controlled action
- Brand stance: serious, calm, and control-oriented

## Selected Brand Direction

The selected initial logo direction is `Threshold K`.

- Primary logo concept: [kairis-threshold-k.svg](assets/logos/kairis-threshold-k.svg)
- Brand metaphor: a controlled threshold between signal and execution
- Visual posture: dark, precise, calm, and instrument-like rather than loud or speculative
- Primary palette:
  - Obsidian: `#111315`
  - Bone: `#E9E4D8`
  - Sage Signal: `#708B7A`
  - Brass Index: `#C8B27A`

Alternative concepts remain in the repo for reference, but `Threshold K` is the current source-of-truth direction for branding work.

The secondary logo concepts are intentionally retained for internal module or subsystem branding:

- `Aperture Mark`: candidate for reporting, analytics, or review-oriented modules
- `Signal Gate`: candidate for execution, orchestration, or control-plane modules

## Current Product Boundary

The current documented scope assumes:

- non-custodial product
- centralized exchange integrations only
- spot trading only
- no pooled user funds
- no withdrawal permissions on exchange API keys
- public product starts with manual and assisted execution
- internal owner mode may support full automation

Out of scope for the current version:

- brokerage or custody
- DEX-first wallet automation
- leverage, margin, or perpetuals
- public unattended automation by default
- copy trading or social trading layers

## Repository Purpose

This repository currently exists to:

- define the working brand and business model
- document the initial product requirements
- define the user experience and system architecture
- establish risk and compliance boundaries
- align pricing, packaging, marketing, and go-to-market strategy

It does not yet contain application code or infrastructure scaffolding.

## Document Map

### Core Strategy

- [Brand + Business Brief](docs/brand-business-brief.md)
- [Business Plan](docs/business-plan.md)

### Product And Design

- [Product Requirements Document](docs/prd.md)
- [Product Design Document](docs/pdd.md)

### System And Data

- [System Design Document](docs/sdd.md)
- [Data Flow Diagram](docs/diagrams/data-flow-diagram.md)

### Risk And Commercialization

- [Risk and Compliance Memo](docs/risk-compliance-memo.md)
- [Pricing and Packaging Brief](docs/pricing-packaging-brief.md)
- [Marketing Guide](docs/marketing-guide.md)
- [Go-to-Market Launch Plan](docs/go-to-market-launch-plan.md)

### Brand Assets

- [Logo Concepts](assets/logos/README.md)
- [Selected Threshold K Logo](assets/logos/kairis-threshold-k.svg)

### App Scaffold

- [Next.js application shell](app/page.tsx)
- [Health endpoint](app/api/health/route.ts)
- [GitHub Actions CI](.github/workflows/ci.yml)
- [Environment template](.env.example)
- [Onboarding flow](app/onboarding/page.tsx)
- [Paper trading workspace](app/paper/page.tsx)
- [Exchange connection policy view](app/connect-exchange/page.tsx)
- [Reports and export workspace](app/reports/page.tsx)
- [Assisted live trading flow](app/assisted-live/page.tsx)

## Document Ordering

The docs are meant to be read in this order:

1. Brand + Business Brief
2. Business Plan
3. PRD
4. PDD
5. SDD
6. Data Flow Diagram
7. Risk and Compliance Memo
8. Pricing and Packaging Brief
9. Marketing Guide
10. Go-to-Market Launch Plan

## Source-Of-Truth Decisions

These decisions should be treated as active defaults unless revised in the docs:

- `Kairis` is the working product name
- beginner retail crypto users are the initial public audience
- paper mode is the safest default starting experience
- public value is centered on control and safer execution, not promises of profit
- public unattended automation is not part of the initial launch posture
- `Supabase Pro` is the default managed backend foundation
- `Cloudflare R2` is the default object storage layer for exports and durable artifacts
- local `Proxmox` will be used for test environments
- only `AWS EC2` is assumed to be available from AWS, and it is the intended production hosting path
- `GitHub Actions` is the default CI/CD system
- the system should prefer managed services over AWS-first infrastructure in the initial phase
- the application stack should remain light enough to run in local Proxmox-based test environments

## Suggested Repo Conventions

As code is added later, preserve these conventions:

- keep product and architecture decisions documented before major implementation changes
- use repo Markdown as the source of truth, exporting to other formats only when needed
- keep business-facing claims aligned with the risk/compliance memo
- treat internal owner automation separately from public entitlement logic

## Naming And Domain Notes

The working brand is `Kairis`. The project does not require a `.com` during validation.

Current preferred domain patterns:

- `kairis.io`
- `getkairis.com`
- `kairisapp.com`
- `kairis.trade`

The repo name should stay aligned with the product name even if the public domain uses a prefix.

## Next Step

The next implementation phase should translate this documentation package into:

- repo structure for application code
- design system and visual direction
- exchange integration plan
- initial onboarding and paper-trading workflows
- control and logging infrastructure
- a concrete deployment split between Supabase, application runtime, and R2-backed storage
- a GitHub Actions pipeline for validation and deployment
- a clear environment model for local Proxmox test deployments and AWS EC2 production deployments

## Local Workflow

Local development and release flow should remain:

1. work locally in the repo
2. validate changes locally
3. commit on the local branch
4. push to GitHub

Direct editing in GitHub should be avoided except for emergencies.

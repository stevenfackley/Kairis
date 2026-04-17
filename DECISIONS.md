# Decisions

ADR log. Append-only.

## {{DATE}} — Initial stack: Next.js 15 + React 19

**Status:** accepted
**Context:** Greenfield web service. Need SSR, server actions, fast initial loads.
**Decision:** Next.js 15 App Router, React 19, TypeScript strict, vitest + playwright, `output: "standalone"` for small Docker image.
**Consequences:** No telemetry SDKs (CI-enforced). RSC-first, `"use client"` only where needed.

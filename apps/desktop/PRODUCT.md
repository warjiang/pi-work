# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop application delivered through Electron. The renderer is a web surface (React), but it is presented and judged as a desktop app window, not a website.

## Users

The primary user is an individual doing solo knowledge work while supervising an AI coding/research agent. Both jobs happen in the same sitting: they think and research on their own machine, and they watch, gate, and correct what the agent is about to write into their filesystem. Sessions are per-person and local; there is no confirmed multi-user or team-review audience.

## Product Purpose

Pi Work turns approved research inside an authorized work folder into reviewable artifacts. The current delivered vertical slice is:

1. Select an authorized work folder.
2. Create a task and submit a structured plan.
3. Approve that plan before any artifact write.
4. Create a staged Markdown artifact.
5. Review its content and publish it into `Pi Work/<task>/`.

Success is a user who lets an agent do substantial work in their real folders without losing track of what it changed or being surprised by a write.

## Positioning

The approval gate is the mechanism: no artifact is written without an explicitly approved plan. Neighboring AI writing tools generate first and ask forgiveness; Pi Work makes the plan the thing you approve, and the write is a consequence of that approval. Related properties — local-first execution, the authorized folder as a hard boundary, staged-then-published artifacts — support that gate rather than standing alone as the claim.

## Operating Context

- Runs locally on the user's machine as a desktop app; work happens against real folders the user already owns.
- Work is organized as workspaces (authorized folders) plus a personal space for sessions that run in a private sandbox with no folder access.
- Task lifecycle surfaces include an inbox, a needs-attention state, completed work, and a board view.
- A session can start in the personal sandbox and later be moved into a work folder as a planned task.
- Supporting surfaces exist for library/sources, skills, automations, folder settings, a browser tool, global search, and app settings.
- Published artifacts land under `Pi Work/<task>/` inside the authorized folder.

## Capabilities and Constraints

- Electron app: `main` process, isolated `preload`, React renderer, and a separate utility process hosting the Pi runtime.
- All renderer-to-main communication is schema-validated; the renderer has no Node API access; writes are path-boundary checked against the authorized root.
- Renderer stack is binding: React + Tailwind (v4, `@theme inline`) + shadcn/ui over Radix primitives, with a project-owned CSS custom-property token layer (`--panel`, `--text`, `--accent`, `--border`, radius scale, etc.).
- Light and dark themes are both supported and must remain supported.
- Localization is binding: English and `zh-CN` message catalogs in `src/renderer/i18n.ts`. New user-facing copy must go through the catalog, and layouts must survive Chinese and English string lengths.
- Workspace tooling: pnpm monorepo, Node >=24, packages for `protocol`, `policy`, `storage`, `artifacts`, `pi-adapter`, plus an `evals` suite. Dev entry is `pnpm dev`.
- Undecided: whether artifact types beyond Markdown are in scope, and whether any multi-user or sync capability is planned.

## Brand Commitments

- Product name: **Pi Work**. Built on the Pi coding agent (`@earendil-works/pi-coding-agent`, `pi.dev`).
- The Pi brand asset archive at `assets/pi-brand` is binding: official logos (`pi-logo-auto.svg`, `pi-logo-white.svg`, `pi-badge-dark.svg`), a social card, and derived `currentColor` / black variants. Licensing and provenance are recorded in `assets/pi-brand/README.md` and must be respected.
- The app renders its own `pi-mark` component in the renderer; the Pi mark is part of the app's identity.
- Voice evidence in shipped copy is calm, spacious, and non-hyped ("Give important work room to unfold."). Treat that register as the confirmed voice.

## Evidence on Hand

- Working implementation of the vertical slice in `apps/desktop/src`.
- Brand archive with provenance and licenses in `assets/pi-brand/`.
- Shipped bilingual copy in `apps/desktop/src/renderer/i18n.ts`.
- Test and eval evidence: unit tests across packages, plus `pnpm evals` writing to `evals/.evidence/tape.jsonl`.
- No customers, testimonials, benchmarks, pricing, press, or usage numbers exist. Future work must not fabricate any.
- Pi Work's visual system is recorded at the repo root in `DESIGN.md`, with its extension sidecar at `.impeccable/design.json`. It is the global design authority for every app in this workspace. (The previous root `design.md` was an unrelated third-party Vercel brand-guidelines skill file and has been removed.)

## Product Principles

1. **Approval precedes every write.** Any surface that can cause a filesystem change must make the pending change legible and the approval explicit.
2. **The boundary is visible.** The user should always know which authorized folder — or whether the private sandbox — the current work runs in.
3. **Staged before published.** Artifacts are reviewable in a staged state; publishing is a separate, deliberate act.
4. **Local-first and calm.** Work stays on the user's machine, and the interface gives long-running thinking room instead of pressuring it.
5. **Supervision over automation theater.** Show what the agent did, is doing, and is asking for; never imply more certainty or autonomy than the system actually has.

## Accessibility & Inclusion

No product-specific standard has been established with the user. Existing implementation signals to preserve: `prefers-reduced-motion` handling in the renderer stylesheet, `aria-live` announcements in settings, and full bilingual (en / zh-CN) coverage.

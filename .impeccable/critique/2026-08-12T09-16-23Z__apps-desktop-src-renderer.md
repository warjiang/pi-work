---
target: all four renderer surfaces
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-12T09-16-23Z
slug: apps-desktop-src-renderer
---
`Method: dual-agent (A: assessment-a · B: assessment-b)`

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Rich lifecycle/streaming feedback, but no `aria-live` on agent output; publish gives no success confirmation |
| 2 | Match System / Real World | 3 | Good domain language ("staged"/"published"); leaks raw `cron`, JSON config, "thinking level" |
| 3 | User Control and Freedom | 2 | Publishing is one-click and irreversible — no unpublish exists anywhere in the codebase |
| 4 | Consistency and Standards | 2 | Two different UIs for the same conceptual act: plan approval = plain button, tool approval = signature card |
| 5 | Error Prevention | 2 | Plan approval never shows what files/paths will be written; publish has no confirmation |
| 6 | Recognition Rather Than Recall | 3 | Labeled nav, command palette, recommended-action, persisted drafts. Permission modes still need decoding |
| 7 | Flexibility and Efficiency | 3 | Cmd-K/J/N/B/I, Enter-to-send, publish-all. No shortcut for approve or publish; no bulk actions |
| 8 | Aesthetic and Minimalist Design | 3 | Per-screen restraint is excellent; undermined by workbench-header competition and inert surfaces |
| 9 | Error Recovery | 2 | Inline Alert + retry, but errors are raw `cause.message`, unannounced, undiagnosed |
| 10 | Help and Documentation | 2 | Skippable onboarding and a shortcuts pane, but zero contextual help at approval/publish |
| **Total** | | **25/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** Partially authored. The genuinely product-specific move is the approval card (`task-workbench.tsx:1553`, `.approval-card` at `styles.css:2780`) — Signal Blue wash, 3px left rule, a `34px / 1fr / auto` grid reading "what is asked -> what it does -> approve/decline," with path, command, and working directory in monospace.

But the central mechanism is mis-weighted. PRODUCT.md says the plan is "the thing you approve." Yet plan approval renders as an ordinary inspector panel with a default slate button (`task-workbench.tsx:1483`), buried behind the `plan` tab in a collapsible right-hand inspector. The Signal Blue signature chrome is spent instead on tool-level approvals, which only appear in "ask" permission mode. The product dresses its second-most-important gate as the hero and its most-important gate as a form.

The surrounding scaffolding is category-interchangeable and inert: Sources ("Not used"), Skills ("Draft"), Automations ("Saved, not running"), plus a kanban board and status/label manager. The approval gate is the only thing that makes this Pi Work, and it is under-emphasized relative to non-functional IA that violates principle 5, "Supervision over automation theater."

**Deterministic scan:** Exit code 2, only 2 findings, both `side-tab` (`styles.css:1683`, `:2786`) and both false positives — one is a markdown blockquote, the other is the approval card's left rule that DESIGN.md explicitly mandates. Mechanically the implementation is very clean: zero icon-only buttons missing accessible names, zero `onClick` on non-interactive elements, all five breakpoints match DESIGN.md exactly, `prefers-reduced-motion` handled in three places.

**Visual overlays:** Not available. Browser visualization is not applicable — `electron.vite.config.ts` has no `server` block and `dev` runs `electron-vite dev`, so the renderer has no standalone browsable URL. No overlay exists; no injection was attempted.

## Overall Impression

The visual craft is better than the interaction design. The two-events color discipline is real and does cognitive work. State coverage is unusually complete for a vertical slice.

Biggest opportunity: the product's headline promise is the least designed moment in the app. Approving a plan that authorizes writes to a real filesystem gets less ceremony than deleting a label. And in "Automatic" permission mode, after one slate-button click, there are zero per-write confirmations for the rest of the session.

## What's Working

1. **The two-events color rule is real, not aspirational.** Signal Blue only on approval/focus/selection; Grove Green only on completion. A pending approval is impossible to miss in a grey conversation.
2. **State coverage is thorough.** Nearly every async surface has loading, empty, and error+retry variants; composer drafts persist to `localStorage` per session (`task-workbench.tsx:447`).
3. **`recommendedAction` (`:1643`) answers "what now."** Computes the single next step and offers one button that jumps to the right tab.

## Priority Issues

**[P1] Keyboard focus is invisible across the entire primary flow**
- **What:** `styles.css:4018` sets a global `:focus-visible { outline: none; border-color: var(--border) !important; box-shadow: none !important; }`, overriding `Button`'s `focus-visible:ring-2` (`button.tsx:7`). Only Input, Textarea, and SelectTrigger keep a real ring; Tabs, Switch, Toggle, ToggleGroup, Command items have no replacement; `provider-combobox-trigger` (`:5163`) re-applies the nulling.
- **Why it matters:** Breaks a binding DESIGN.md rule and means a keyboard user cannot see focus land on Approve Plan or Publish — the two actions that write to disk.
- **Fix:** Delete the blanket `box-shadow: none !important`. Restore `box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px color-mix(in srgb, var(--ring) 40%, transparent)` globally, keeping `outline: none`.
- **Suggested command:** `/impeccable audit`

**[P1] The plan-approval moment doesn't show what will be written**
- **What:** The plan detail (`task-workbench.tsx:1471-1487`) shows prose steps and sources but no target path, file count, or write scope. The active folder lives in a different tab and in the header (`:695`).
- **Why it matters:** Principle 1 says "make the pending change legible and the approval explicit." A plan approval with no legible consequence is a rubber stamp.
- **Fix:** Add a scope line above the action row: "This will write N files to `Pi Work/<task>/` in `<folder>`," reusing the approval card's monospace path treatment.
- **Suggested command:** `/impeccable clarify`

**[P1] Publishing is irreversible, one-click, and unconfirmed**
- **What:** Publish (`:1585`) and `onPublishAll` (`:911`) write to the real folder immediately. No unpublish IPC anywhere, no confirm, no success state.
- **Why it matters:** Principle 3 says publishing is "a separate, deliberate act," but it has less friction than deleting a label. The Grove Green completion moment produces no visible reward.
- **Fix:** Confirm dialog for publish-all; Grove Green success confirmation per publish; either a real unpublish or explicit copy stating it cannot be undone.
- **Suggested command:** `/impeccable harden`

**[P2] No `aria-live` for streaming agent output**
- **What:** Only 3 announcement points in the whole renderer: `aria-live="polite"` in settings (`settings-page.tsx:304`), `role="alert"` on Alert, `role="status"` on Spinner. Streamed messages, `LiveProcessView`, and the sending indicator (`:772-779`) have none.
- **Why it matters:** A screen-reader user supervising an agent is never told it is thinking, calling a tool, or done.
- **Fix:** `aria-live="polite"` on the streaming region; `role="alert"` on the approval card.
- **Suggested command:** `/impeccable audit`

**[P3] Inert surfaces read as automation theater**
- **What:** Sources, Skills, Automations, and the status/label manager are present and non-functional (`workspace-pages.tsx:246, 295, 346`), all in the default sidebar.
- **Why it matters:** Principle 5 forbids implying more capability than exists.
- **Fix:** Gate behind a labeled "Preview — not yet active" affordance, or remove until functional.
- **Suggested command:** `/impeccable distill`

## Persona Red Flags

**Sam (Accessibility-Dependent):** Tabbing to Approve Plan or Publish shows no focus ring (`styles.css:4018`). Agent streaming, thinking, and tool calls are never announced. Lifecycle state leans on `task-state-dot` (`:374`), conveying status largely by color and position.

**Alex (Impatient Power User):** Cmd-K/N/J/B/I and Enter-to-send are solid, but there is no shortcut to approve a plan or publish — the two most-repeated actions require a mouse trip into a collapsible inspector. No bulk task actions on the board.

**Jordan (Confused First-Timer):** The most consequential control looks identical to every other slate button and sits in a panel that must be opened. Automations/Skills/Sources are inert dead ends. Permission-mode words sit in a submenu (`:211-222`) and assume the user models agent autonomy.

**"The Solo Supervisor" (project-specific):** In Automatic mode, after one plan approval there are zero per-write confirmations; the boundary goes invisible when the agent is most active. `file_change` events are collapsed timeline rows (`:1537`). No ledger of what already landed in `Pi Work/<task>/` this session.

## Minor Observations

- The `--amber` token holds Signal Blue (`#42699d`, `styles.css:59`). Misleading name.
- `turnLabel` branches on `t("turn") === "第"` (`:1285`) — fragile string-equality hack for zh-CN pluralization.
- zh-CN overflow risk confirmed: `.composer-model-trigger` is `width: 232px` with `white-space: nowrap` (`:2098-2102`). Highest-ratio string is `path`: "Path" -> "文件路径" at 2.00x visual width. Catalogs otherwise complete: 360 keys each, zero missing.
- Token-layer violations: `pi-console-panel.tsx:62` hardcodes `#111214`/`#e7e7e9` so the terminal will not re-tint; `workspace-pages.tsx:176` defaults a picker to `"#8a8275"`; 28 color literals outside token blocks in `styles.css`, including an `rgb(32 33 36 / ...)` shadow family duplicating `--text` and 16 inline tag colors with no custom properties.
- Error copy "Image preview is ready after restarting Pi Work" (`:761`) ships an implementation limitation as user guidance.
- `NewTaskDialog` reuses `noTasksDetail` as its description (`app-shell.tsx:521`).
- Command palette renders up to 28 items across 4 groups; sidebar exposes 8 nav items; source-type Select offers 7. All above the <=5 guidance.

## Questions to Consider

1. If the plan is "the thing you approve," why does a tool call get the Signal Blue signature card while the plan gets a slate button in a collapsible tab?
2. In Automatic mode you write to a real filesystem with no per-write gate after one approval. Is Pi Work still "the approval gate"?
3. Is the absence of unpublish a deliberate stance or an unshipped feature? If deliberate, where does the interface say so?
4. Four sidebar destinations do nothing. Is that building trust in the roadmap, or teaching the supervisor that the UI over-promises?
5. If a screen-reader user cannot hear the agent think, see focus land on "Approve," or be told a file was written — has the product delivered supervision, or only its appearance?

# Pi Work Desktop Design System

## 印前校样台 / Preflight Proof Workspace

Pi Work is a desktop workbench for conversations, plans, orchestration runs, and
publishable artifacts. The interface should feel like a calm production console:
precise, inspectable, and safe under pressure.

The visual metaphor is an **印前校样台**—a preflight desk where work is reviewed,
approved, run, and released. It is not a retro print application. Use the language
of stages, checks, boundaries, and release readiness without decorative paper
textures, crop marks, registration marks, ink noise, or skeuomorphic machinery.

## Product Principles

1. **Conversation and planning are one loop.** Opening a task always returns to
   Conversation. The current plan appears inside the conversation so the user can
   revise it through normal dialogue and approve it without changing modes.
2. **One mode, one primary action area.** The composer belongs only to
   Conversation, alongside inline plan actions. Orchestration has run controls,
   and Artifacts has publish actions.
3. **Context is available, not imposed.** Metadata, activity, and node execution
   details live in a closed-by-default context drawer.
4. **State must be visible.** Authorized directory, preflight, approval, run, and
   publication states remain legible wherever the related action occurs.
5. **Writes are deliberate.** Approval precedes sensitive actions. Artifacts are
   staged before they are published. A newly created run remains pending until the
   user starts it.
6. **Density follows intent.** Navigation is compact; reading and editing surfaces
   are spacious; orchestration uses the full available canvas.
7. **Progressive disclosure beats simultaneous panes.** Show node details only
   after selection and advanced JSON only when requested.

## Information Architecture

### Application Shell

- The top bar owns the Workspace switcher: Personal, authorized folder
  workspaces, and the workspace edit action.
- The sidebar contains New task, current workspace Work navigation, at most eight
  deduplicated recent tasks, Library, and Settings.
- Do not repeat workspace lists or render multiple task lists in the same shell.
- Personal sessions are conversation-only. Folder tasks expose Conversation,
  Orchestration, and Artifacts; planning is part of Conversation.
- The selected workspace and authorized directory boundary must remain easy to
  verify.

### Task Modes

The mode order is fixed:

1. Conversation
2. Orchestration
3. Artifacts

Mode navigation is a compact peer-level toolbar. It does not replace the global
navigation and must not be confused with the context drawer.

### Conversation and Plan

- The latest plan is rendered inline after the conversation that produced it.
- The composer remains available while a plan is present or awaiting approval.
- When a plan is awaiting review, the next conversation turn revises that plan
  directly; do not add a second regenerate action.
- Full numbered steps are visible inline; referenced sources are collapsed.
- Plan approval and request-changes actions stay attached to the plan.
- Do not create a separate Plan tab, page, drawer, or composer.

### Context Drawer

The drawer can display:

- Task metadata and authorized boundary
- Full activity history
- Selected orchestration node execution

Closing the drawer never changes the active task mode. Selecting a node opens node
context; closing node context preserves the selection and orchestration mode.

## Operate Mode

Pi Work is an operational product, so every surface should answer:

- Where am I working?
- What stage is this task in?
- What action is available now?
- Does this action require approval?
- What will be written, run, or published?
- How do I recover from failure?

Prefer direct labels such as `Start run`, `Approve plan`, `Publish selected`, and
`Retry node`. Avoid vague labels such as `Continue`, `Process`, or `Submit` when a
more precise verb exists.

## Semantic Color Tokens

Colors are semantic and restrained. Process Blue is the only primary interaction
accent.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#F7F8FA` | `#111418` | Application canvas |
| `--surface` | `#FFFFFF` | `#171B20` | Primary panels |
| `--surface-subtle` | `#F1F3F5` | `#1D2228` | Grouped controls and secondary regions |
| `--foreground` | `#171A1F` | `#F2F4F7` | Primary text |
| `--muted-foreground` | `#66707C` | `#9BA5B1` | Secondary text |
| `--border` | `#DDE2E7` | `#303741` | Structural boundaries |
| `--border-strong` | `#B8C0CA` | `#46505C` | Active divisions and resize handles |
| `--process-blue` | `#1267E8` | `#5B9BFF` | Primary actions, selection, focus |
| `--process-blue-soft` | `#EAF2FF` | `#172B49` | Selected rows and informational states |
| `--amber` | `#B76700` | `#FFB44C` | Approval, warning, attention |
| `--amber-soft` | `#FFF4DE` | `#3A2A13` | Approval and preflight surfaces |
| `--green` | `#16825D` | `#4ED0A0` | Completed and published |
| `--green-soft` | `#E8F7F1` | `#16362C` | Success surfaces |
| `--red` | `#C23B3B` | `#FF7777` | Failure and destructive actions |
| `--red-soft` | `#FDECEC` | `#3B2022` | Error and recovery surfaces |

Never communicate state with color alone. Pair color with text, icon, and where
needed an ARIA live announcement.

## Typography

Use the existing system sans-serif stack for interface text and the existing
monospace stack for IDs, paths, logs, and JSON.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Page title | `20px / 28px` | 650 |
| Section title | `15px / 22px` | 650 |
| Body | `14px / 21px` | 400 |
| Control | `13px / 18px` | 550 |
| Caption | `12px / 17px` | 500 |
| Micro label | `11px / 15px` | 650, optional uppercase |
| Code | `12px / 18px` | 400 |

- Use sentence case in English.
- Chinese labels should remain short and literal.
- Tabular numerals are preferred for attempts, counts, durations, and concurrency.
- Use monospace only where character alignment or machine identity matters.

## Spacing, Shape, and Borders

- Base spacing unit: `4px`.
- Common steps: `4, 8, 12, 16, 20, 24, 32`.
- Control height: `32px` compact, `36px` standard, `40px` prominent.
- Corner radius: `6px` controls, `8px` panels, `10px` prominent cards.
- Use fine one-pixel borders to describe hierarchy.
- Shadows are reserved for overlays, drawers, menus, and drag elevation.
- Do not make every region a card. Prefer aligned sections and dividers.
- Avoid pill shapes except for compact status badges.

## Core Components

### Workspace Switcher

- Shows current workspace name and scope.
- Makes Personal and folder workspaces mutually clear.
- Includes the workspace edit action without adding a second workspace list.
- Restores focus to its trigger after the menu closes.

### Sidebar

- Current destination uses Process Blue or a neutral selected surface, not both at
  maximum intensity.
- Recent tasks are deduplicated, capped at eight, and ordered by recent activity.
- Counts align using tabular numerals.
- At narrow widths the sidebar becomes a modal drawer with focus containment.

### Mode Navigation

- The active mode has a clear selected surface and border.
- At widths below `760px`, tabs scroll horizontally and keep their natural width.
- Keyboard navigation follows tab semantics and exposes selected state.

### Composer

- Exists only in Conversation.
- The send action, execution mode, model, and permission-relevant context must not
  compete visually.
- Disabled and running states explain why input cannot be sent.
- Inline approval and recovery cards appear near the message or action that caused
  them.

### Gate Card

Gate cards represent approval, authorization, preflight failure, or recovery.

- Lead with the state and consequence.
- Show the exact action or boundary being approved.
- Use Amber for pending approval, Red for failure, Green for resolved.
- Keep the primary resolution action closest to the explanation.
- Never hide a required approval in a detached inspector.

### Plan

- The plan is part of Conversation, not a separate task mode.
- Steps are numbered and readable as a single vertical sequence.
- Sources are collapsed by default unless source review is required.
- Approval actions remain attached to the inline plan.
- The conversation composer remains available so feedback can immediately refine
  the next plan revision.

### Orchestration

- Run selector, state, and Start/Pause/Resume/Stop controls form one toolbar.
- The DAG owns the main canvas and remains pannable at every width.
- Only the board/canvas may scroll horizontally.
- Node state uses consistent labels across graph, list, and context drawer.
- Selecting a node opens execution details; it does not switch modes.

The run builder supports a visual form and Advanced JSON:

- Node title
- Prompt
- Dependencies
- Retry attempts
- Global concurrency

Node IDs are generated automatically. Form and JSON representations stay
bidirectionally synchronized. Validation must identify unknown dependencies,
self-dependencies, and cycles close to the offending input. Creating a run leaves
it pending until `Start` is pressed.

### Artifacts

Artifacts are grouped into Staged, Published, and Failed.

- Every artifact shows its destination or the missing destination requirement.
- Support individual and batch publishing.
- Failed publication includes a recoverable action and error context.
- Completing a task with staged artifacts requires explicit confirmation.

### Lists and Board

- Lists share one toolbar pattern: search, status filter, count, New task.
- List and board cards use the same task state vocabulary.
- Loading, empty, error, and needs-attention use shared feedback components.
- Horizontal page scrolling is prohibited; only the board canvas may pan.

## Responsive Behavior

### `>= 1180px`

- Full sidebar remains visible.
- Context and node details use a resizable right drawer.
- The drawer may reduce the main content only when enough canvas remains.

### `900px–1179px`

- Sidebar remains available according to shell capacity.
- Context drawer overlays the work area and does not compress it.

### `<= 900px`

- Sidebar becomes a scrim-backed drawer.
- Opening it traps focus; closing it restores focus to the trigger.

### `<= 760px`

- Mode navigation scrolls horizontally.
- Context and node details become a full-screen sheet.
- DAG remains a pannable canvas and is never scaled into illegibility.
- Sticky action bars respect safe-area insets.

Each task mode owns exactly one primary vertical scrolling container.

## Accessibility

- All controls must be reachable and operable by keyboard.
- Use visible `:focus-visible` rings based on Process Blue with sufficient offset.
- Dialogs, drawers, sheets, menus, and popovers restore focus on close.
- Announce async run, approval, publish, and error state changes through an
  appropriately scoped ARIA live region.
- Icons that act as buttons require accessible names.
- Status icons supplement, never replace, visible labels.
- Minimum target size is `32px`; use `40px` for primary mobile actions.
- Meet WCAG AA contrast in both light and dark themes.

## Motion

- Motion explains state change, hierarchy, or spatial origin.
- Standard transitions: `120–180ms`; drawer transitions: up to `220ms`.
- Prefer opacity and transforms. Avoid animating layout dimensions where possible.
- Do not animate logs, continuously pulse status, or add decorative ambient motion.
- Under `prefers-reduced-motion: reduce`, remove nonessential transitions and
  preserve immediate state feedback.

## Content and Localization

- All interface copy belongs in `i18n.ts` with matching `en` and `zh-CN` entries.
- Avoid embedding English in status composition or accessibility labels.
- Layouts must tolerate Chinese and English without fixed text widths.
- Paths, node IDs, and destinations may truncate visually but must remain available
  through title, tooltip, copy, or expanded context.

## Interaction Invariants

- Opening a folder task selects Conversation and closes context.
- Opening a Personal session exposes only Conversation.
- Planning and plan approval stay inside Conversation.
- Changing workspace scope resets task mode and context.
- Composer is mounted only in Conversation.
- Closing context never changes task mode.
- A selected orchestration node opens node context.
- A created run stays pending until explicitly started.
- Writes remain inside the authorized directory boundary.
- Artifacts remain staged until explicit publication.

## Prohibited Patterns

- Three permanently visible columns that compress the main work.
- Duplicate workspace or task navigation.
- A universal composer beneath non-conversation modes.
- Hidden approval, authorization, or publish state.
- Auto-starting a newly created orchestration run.
- Decorative paper texture, crop marks, registration marks, halftone noise, or
  retro print-software styling.
- Excessive rounded cards, gradients, glass effects, glow, or ornamental animation.
- Horizontal scrolling on the application page outside the board or DAG canvas.

## Review Checklist

- Verify Personal and folder workspace behavior.
- Verify inline planning in Conversation, plus Orchestration and Artifacts action
  areas.
- Verify context is closed by default and node details open independently.
- Verify visual builder/JSON synchronization and dependency validation.
- Verify approval, recovery, staged publication, and completion confirmation.
- Verify English and Chinese in light and dark themes.
- Verify keyboard navigation, focus restoration, ARIA live updates, and reduced
  motion.
- Verify layouts at `>=1180`, `900–1179`, `<=900`, and `<=760` widths.

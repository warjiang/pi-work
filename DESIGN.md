---
name: Pi Work
description: A calm, near-monochrome desktop workshop where agent work is staged, inspected, and released
colors:
  slate-ink: "#202124"
  slate-accent: "#2a2b2f"
  accent-text: "#ffffff"
  signal-blue: "#42699d"
  signal-blue-wash: "#edf3fb"
  grove-green: "#33785c"
  grove-green-wash: "#ecf6ef"
  clay-red: "#b04747"
  clay-red-wash: "#fbefef"
  paper: "#f7f7f6"
  panel: "#ffffff"
  panel-muted: "#f3f3f2"
  panel-strong: "#e8e8e6"
  hover: "#f0f0ee"
  active: "#e7e7e4"
  border: "#e2e2df"
  border-strong: "#c9c9c4"
  muted-text: "#686a70"
  faint-text: "#8b8d93"
typography:
  display:
    fontFamily: "Geist, SF Pro Display, -apple-system, BlinkMacSystemFont, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "clamp(38px, 4.2vw, 62px)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, SF Pro Display, -apple-system, BlinkMacSystemFont, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "clamp(24px, 2.3vw, 32px)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist, SF Pro Text, -apple-system, BlinkMacSystemFont, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Geist, SF Pro Text, -apple-system, BlinkMacSystemFont, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  compact:
    fontFamily: "Geist, SF Pro Text, -apple-system, BlinkMacSystemFont, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  caption:
    fontFamily: "Geist, SF Pro Text, -apple-system, BlinkMacSystemFont, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, SF Pro Text, -apple-system, BlinkMacSystemFont, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.035em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
rounded:
  micro: "3px"
  control: "8px"
  field: "12px"
  surface: "12px"
  overlay: "14px"
  pill: "999px"
spacing:
  hair: "4px"
  tight: "6px"
  snug: "8px"
  base: "10px"
  card: "12px"
  section: "14px"
  page: "18px"
  wide: "24px"
components:
  button-primary:
    backgroundColor: "{colors.slate-accent}"
    textColor: "{colors.accent-text}"
    typography: "{typography.compact}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.slate-ink}"
  button-outline:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "{colors.hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.slate-ink}"
  button-destructive:
    backgroundColor: "{colors.clay-red}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  input-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.slate-ink}"
    typography: "{typography.compact}"
    rounded: "{rounded.field}"
    padding: "0 10px"
    height: "32px"
  card-surface:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.surface}"
    padding: "12px"
  approval-card:
    backgroundColor: "{colors.signal-blue-wash}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.surface}"
    padding: "13px"
    width: "min(100%, 760px)"
  lifecycle-badge:
    backgroundColor: "{colors.panel-muted}"
    textColor: "{colors.muted-text}"
    typography: "{typography.label}"
    rounded: "{rounded.micro}"
    padding: "3px 6px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted-text}"
    typography: "{typography.compact}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "33px"
  nav-item-active:
    backgroundColor: "{colors.active}"
    textColor: "{colors.slate-ink}"
---

# Design System: Pi Work

## Overview

**Creative North Star: "The Quiet Workshop"**

Pi Work looks like a well-lit workbench in an otherwise quiet room. Nothing on it is decorative: every surface exists because something is being staged, inspected, or released on it. The room is near-monochrome — warm-grey paper, white panels, slate ink — so that the two moments that actually matter can arrive in color and be unmistakable. Work sits out in the open on the bench; it is not hidden inside chrome, dressed up in gradients, or announced with badges competing for the same attention.

The system is dense but not cramped. Controls are small (32px tall, 12–13px type) because the user is supervising, not filling in a form: the interface should occupy as little of the screen as the work allows, and the conversation, the plan, and the artifact should occupy the rest. Density comes from tight control geometry and modest padding, never from removing air between groups. The one place the system deliberately spends space is the reading column — the conversation, composer, and approval card all cap at roughly 760–780px so long agent output stays readable.

Depth is tonal, not theatrical. Grouping is done with a 1px hairline border and a half-step change in surface tone, and shadows are reserved for objects that genuinely float above the bench. Motion is short and functional: 160ms color transitions, a 1px press, and nothing that draws the eye for its own sake. Both light and dark are first-class; dark is a genuine re-tint of the same room, not an inverted screenshot. The visual rejections are specific: no gradients on surfaces, no colored buttons for ordinary actions, no shadows on cards, no icon-only state signaling.

**Key Characteristics:**
- Near-monochrome warm greyscale with two earned chromatic events
- Small, quiet, unfussy controls (32px is the standard control height)
- Flat surfaces separated by hairline borders and half-step tonal shifts
- A ~760px reading spine for anything the user must actually read
- Full light/dark parity through a single CSS custom-property layer
- Bilingual by construction: layouts survive both English and Chinese string lengths

## Colors

A warm greyscale room in which color is a signal, never a surface treatment.

### Primary
- **Slate Accent** (`#2a2b2f` light / `#f1f1ef` dark): The single dominant action color. It fills the primary button and the active-state fills of the shell. In dark mode it inverts to near-white against dark ink — the accent is defined by contrast against the room, not by hue.
- **Slate Ink** (`#202124` light / `#f1f1ef` dark): All primary reading text — headings, message bodies, artifact content, active navigation labels.

### Secondary
- **Signal Blue** (`#42699d` light / `#90b8ef` dark): The approval color. It carries the approval card's left rule and symbol, the focus ring on every control, and text selection. Its rarity is what makes an approval request read instantly as a different kind of moment from ordinary UI.
- **Signal Blue Wash** (`#edf3fb` light / `#22364d` dark): The tinted field behind an approval card. It is the only tinted content surface in the system.

### Tertiary
- **Grove Green** (`#33785c` light / `#86c7a1` dark): Completed and published states only — the moment work has left staging and landed in the folder. It marks the *result* of an irreversible act, never an informational note about one: a published artifact badge and the post-publish confirmation earn it; the standing note explaining where files go does not.
- **Grove Green Wash** (`#ecf6ef` light / `#203c2f` dark): The quiet field behind a completed marker.
- **Clay Red** (`#b04747` light / `#ed9b9b` dark): Destructive actions, failures, and risk alerts. Muted rather than alarm-bright; it warns without shouting.

### Neutral
- **Paper** (`#f7f7f6` light / `#1d1d20` dark): The app background — the bench surface everything else sits on.
- **Panel** (`#ffffff` light / `#242427` dark): Raised working surfaces — topbar, cards, composer, dialogs.
- **Panel Muted** (`#f3f3f2` light / `#2a2a2e` dark): The sidebar and secondary fills; a half-step recession from Panel.
- **Panel Strong** (`#e8e8e6` light / `#343438` dark): The deepest tonal step, for tracks, wells, and inset areas.
- **Hover** (`#f0f0ee` light / `#303034` dark) and **Active** (`#e7e7e4` light / `#39393d` dark): Interaction feedback, expressed only as a tonal shift.
- **Border** (`#e2e2df` light / `#3a3a3f` dark): The universal hairline that does the grouping work shadows would do elsewhere.
- **Border Strong** (`#c9c9c4` light / `#535359` dark): Reserved for objects that must read as inputs the user acts on — chiefly the composer.
- **Muted Text** (`#686a70` light / `#b0b0b5` dark): Secondary labels, metadata, inactive navigation.
- **Faint Text** (`#8b8d93` light / `#85858b` dark): Timestamps, path fragments, and non-essential annotation.

### Named Rules

**The Two Events Rule.** Only two things in this product earn color: something needs approval (Signal Blue) and something has completed (Grove Green). Everything else is greyscale. If a new feature wants a third accent hue, it is almost always a hierarchy problem in disguise.

**The Tonal Interaction Rule.** Hover, active, and selected states are expressed as a step along the neutral ramp — never by introducing a hue, a border color change alone, or a shadow.

**The Wash-Is-Not-Decoration Rule.** A tinted background (`signal-blue-wash`, `grove-green-wash`, `clay-red-wash`) marks a state the user must respond to or has resolved. Never use a wash to make an ordinary panel look more interesting.

## Typography

**Display Font:** Geist (with SF Pro Display, -apple-system, BlinkMacSystemFont)
**Body Font:** Geist (with SF Pro Text, PingFang SC, Noto Sans SC, Microsoft YaHei)
**Label/Mono Font:** ui-monospace / SFMono-Regular / Menlo, with `font-variant-numeric: tabular-nums`

**Character:** One family carries the whole app; hierarchy is built from size, weight, and negative tracking rather than from a second typeface. Geist is neutral and slightly technical, and the CJK fallbacks are declared in the same stack so Chinese sets at the same optical weight as English rather than falling back to a heavier system face.

### Hierarchy
- **Display** (400, `clamp(38px, 4.2vw, 62px)`, 1.05, `-0.035em`): Empty-state and first-run moments only, where the app has nothing to show and should feel spacious rather than apologetic.
- **Headline** (500, `clamp(20px, 1.8vw, 26px)`, 1.15, `-0.03em`): Page and settings headings.
- **Title** (600, 15px, 1.35, `-0.012em`): Task titles, card headings, section leads.
- **Body** (400, 14px, 1.5): Conversation messages, artifact prose, long-form reading. This is the app's baseline size, set on `body`.
- **Compact** (400, 13px, 1.45): Controls, navigation, list rows — the working size of the interface chrome.
- **Caption** (400, 12px, 1.4): Metadata, helper text, timestamps. The most-used size in the app by count.
- **Label** (700, 9–10px, `0.035em`, uppercase): Lifecycle badges and extension micro-labels. **700 is reserved for this role.** Nothing above 10px is ever bolder than 600.
- **Mono** (400, 12px, tabular figures): Code blocks, console output, filesystem paths, and any value the user might compare column-to-column.

### Named Rules

**The Four-Weight Rule.** The app uses exactly four weights — 400 body, 500 headline, 600 title, 700 label — and nothing in between. Intermediate values (450, 550, 650, 675) accumulated once and made every heading read a step heavier than this hierarchy specifies; they are not permitted to return. If something needs more emphasis, it gets more size or more contrast, not a fractional weight.

**The Chrome-Is-Smaller Rule.** Interface chrome sets at 12–13px; content the user reads sets at 14px and up. If chrome and content are the same size, the chrome is too loud.

**The Negative Tracking Rule.** Tracking tightens as size grows (−0.012em at title, −0.035em at display) and never goes positive except for the 10px uppercase lifecycle label.

**The Bilingual Line Rule.** Never size a container to an English string. Every label must survive its `zh-CN` counterpart without truncation or wrapping into an adjacent control.

## Layout

The app is a fixed desktop grid, not a scrolling page: `46px topbar / content` by `252px sidebar / content`, with `overflow: hidden` on the shell and scrolling delegated to individual panes. The topbar spans full width, is draggable (`-webkit-app-region: drag`), and uses a three-column `1fr auto 1fr` grid so the center element stays optically centered regardless of the width of what flanks it.

Reading surfaces are capped, not fluid. The conversation column, composer, and approval card all resolve to `min(760–780px, 100% − gutter)` and center themselves. Everything else — tables, kanban columns, settings panes — takes the space it is given.

Spacing runs on a 4px-derived rhythm with a compressed working range: 4 / 6 / 8 / 10 / 12 / 14 / 18 / 24px. Card padding is 12px, page padding is 18px, and sidebar groups separate by 14–18px. The system rarely exceeds 24px; distance between sections is achieved with a border or a tonal change instead of a large gap.

Responsive behavior is desktop-window resizing, not mobile adaptation. Breakpoints at 1180px, 900px, 760px, 720px, and 640px progressively collapse the inspector, then the sidebar (which becomes an overlay with a backdrop), then multi-column areas. The 900px and 760px steps carry most of the work.

## Elevation & Depth

The system is flat by default and layers tonally. Grouping is done with a 1px `border` hairline plus a half-step move along the neutral surface ramp (`paper` → `panel-muted` → `panel` → `panel-strong`). Cards explicitly set `box-shadow: none`; the kanban card, task row, and inspector section all rely on border and tone alone. Shadows are reserved for objects that genuinely float above the bench.

### Shadow Vocabulary
- **Raised** (`box-shadow: 0 7px 20px rgb(32 33 36 / 0.08), 0 1px 2px rgb(32 33 36 / 0.08)`): The composer, which hovers over the scrolling conversation. In practice the composer softens this further to `0 2px 8px rgb(32 33 36 / 0.06)`.
- **Overlay** (`box-shadow: 0 16px 42px rgb(32 33 36 / 0.12)`): Dialogs, popovers, dropdown menus, and the command palette — anything in a portal.

Dark mode deepens both (`0.28` / `0.2` alpha on pure black) rather than reusing the light values, because a light-mode shadow disappears on a dark bench.

### Named Rules

**The Flat-Card Rule.** If it sits in the document flow, it has a border and no shadow. If it floats in a portal or over scrolling content, it has a shadow. There is no third case.

## Shapes

Corners are consistently soft but never pill-round outside of dedicated affordances. The radius scale is derived from a single `--radius: 0.625rem` root: `micro` (3px) for lifecycle badges, `control` (8px) for buttons, nav items, tabs, and menu items, `field` (12px) for inputs, textareas, and the composer, `surface` (12px) for cards and panels, `overlay` (14px) for dialogs and portaled menus, and `pill` (999px) reserved for the switch track and true toggles. Radius grows with the size and importance of the container, so an overlay always reads as one step softer than the card beneath it.

Borders are the primary form-defining stroke: 1px `border` almost everywhere, 1px `border-strong` for the composer, and a 2–3px left rule on the plan approval card — the only asymmetric border in the system, used to make the headline gate scannable in a long conversation. Circles appear only for genuine markers: the 27px timeline node and small state dots. Icons are line icons on a 16–24px box rendered with `shape-rendering: geometricPrecision`.

## Components

### Buttons
- **Shape:** Softly rounded (8px, `--radius-control`), 32px tall by default; 28px for `sm`, 28px square for icon-only.
- **Primary:** Slate accent fill with inverted text (`#2a2b2f` on `#ffffff`), 12px horizontal padding, 13px medium weight. Used once per decision point, never for navigation.
- **Hover / Focus:** Hover darkens the fill to 90% opacity; other variants shift to the `hover` tone. Focus is always a 2px Signal Blue ring at 40% opacity with a 2px offset — never a color change alone. Active state applies `translateY(1px)`, a 1px physical press.
- **Outline / Secondary / Ghost:** Outline is a bordered panel-colored button for adjacent alternatives; secondary is a borderless `panel-muted` fill; ghost is transparent with muted text and is the default for toolbar and inline actions. Destructive uses Clay Red fill and appears only where data or files are removed.

### Cards / Containers
- **Corner Style:** 12px (`--radius-surface`).
- **Background:** `panel` for content cards; `panel-muted` where a card must recede into the sidebar.
- **Shadow Strategy:** None. See The Flat-Card Rule.
- **Border:** 1px `border` on all four sides.
- **Internal Padding:** 12px, with 8px gaps between stacked elements inside.

### Inputs / Fields
- **Style:** 1px `border` on `panel`, 12px radius (`--radius-field`), 32px tall, 10px horizontal padding, 13px text with `muted-text` placeholders.
- **Focus:** Border shifts to Signal Blue and a 2px Signal Blue ring at 20% opacity appears. No glow, no size change.
- **Error / Disabled:** Errors render as text in Clay Red beneath the field, plus the field's own border in Clay Red; disabled drops to 50% opacity with `cursor: not-allowed`.

### Navigation
- **Style:** The 252px sidebar sits on `panel-muted` with a right hairline. Nav items are 33px tall, 8px radius, 13px compact type in `muted-text`, left-aligned with a leading 16px line icon and an optional trailing count.
- **States:** Hover moves to the `hover` tone; the active item takes the `active` tone with `slate-ink` text. Selection is never indicated by color hue.
- **Narrow windows:** Below 900px the sidebar leaves the grid and becomes an overlay panel with a dimmed backdrop.

### Lifecycle Badge
- **Style:** 10px uppercase, weight 700, `0.035em` tracking, 3px radius, 3px/6px padding, `panel-muted` on `muted-text`. Completed states take Grove Green, failed states take Clay Red.
- **Rule:** The badge names a state. It never doubles as a button or a filter control.

### Approval Card (signature component)
The one place where the product's central mechanism becomes visible. A three-column grid (`34px symbol / content / actions`) capped at 760px, filled with Signal Blue Wash, bordered in Signal Blue mixed 30% into the hairline, and cut on the left by a 2–3px solid Signal Blue rule. A 32px rounded-square symbol carries a Signal Blue line icon. Actions sit on the trailing edge so the decision reads left-to-right: what is being asked → what it will do → approve or decline. It is the only content surface in the app allowed a tinted field and an asymmetric border, and that exclusivity is deliberate: an approval must never be confusable with an ordinary card.

**Two weights, one shape.** The card renders at two levels, and the level tracks the stakes:

- **Plan approval (`.plan`)** wears the full signature — Signal Blue wash, the left rule, the blue symbol. This is the product's headline gate: approving it authorizes the agent to work inside a real folder. It carries the plan summary as its heading, the working directory and publish destination as monospace paths, step and source counts, a plain-language note that individual files are not declared in advance, and a link into the plan tab for the full steps. It renders in the conversation flow, not in a panel, and it is a `role="group"` labelled by its heading. Nothing else opens alongside it — the inspector does not auto-reveal the plan tab, because a second simultaneous approval control would split the moment this card exists to own. The tab stays available on demand through the card's own link.
- **Tool approval (`.tool`)** keeps the same grid and rhythm but drops to a neutral `panel` field with a 1px hairline on all four sides and a muted symbol. A single write confirmation is a smaller decision than the plan that authorized it, and the color must say so. These do auto-reveal the activity tab, because a write only makes sense against the run that requested it.

**The Approval Weight Rule.** Only one approval level wears the wash and the left rule, and it is always the one with the widest consequence. If a second surface wants the full signature, the hierarchy is wrong, not the palette.

### Kanban Card
126px minimum height, `panel` on a 12px radius with a 1px border and no shadow, 12px padding, 8px internal gaps, left-aligned text that wraps freely. Cards are peers; nothing is visually promoted except through its lifecycle badge.

### Composer
The floating input dock: capped at `min(780px, 100% − 48px)`, centered, `panel` on a 12px radius with a `border-strong` stroke and the softened raised shadow. It is the only persistently elevated in-flow object in the app, because it is always available and always above scrolling content.

## Do's and Don'ts

### Do:
- **Do** use tone and a 1px hairline to group things; reach for `panel-muted` before you reach for a shadow.
- **Do** keep Signal Blue for approval and selection, and Grove Green for completion. Two events, no more.
- **Do** confirm irreversible acts before they run, and say plainly in the interface that they cannot be undone. Publishing copies files into the user's real folder and Pi Work cannot take them back; the copy admits that rather than implying a safety net.
- **Do** report partial outcomes honestly. A batch that publishes 3 of 5 files says so and names the failure; it never reports success for the whole batch.
- **Do** size interface chrome at 12–13px and reading content at 14px+.
- **Do** cap anything the user reads at ~760px and center it.
- **Do** define every color through the CSS custom-property layer so dark mode comes for free; both themes are re-tinted, never inverted.
- **Do** route every focus-indicator change through the single commented block in `styles.css` (search `focus`). Focus is a global concern in this codebase — bespoke rules are unlayered and therefore beat every Tailwind `focus-visible:ring-*` utility, so a one-off change in a component file will not do what it looks like it does.
- **Do** announce the supervision loop as state transitions, not as content. The conversation stage mounts two permanent visually-hidden regions — a polite `role="status"` carrying one short phrase for the current phase (thinking, running a tool, writing a response, complete, cancelled) and an assertive `role="alert"` that fires only when the agent needs a decision. Both are mounted before they ever hold text, because a region inserted at the same moment as its content is unreliably read.
- **Do** make every mutation report both outcomes in place. A save that succeeds says so next to the control that ran it — a short Grove Green line that clears itself after a beat — and a save that fails renders its message inline as a `form-error`. A credential field that simply empties on submit is indistinguishable from one that was wiped.
- **Do** verify each new label in both `en` and `zh-CN` before considering a layout done.
- **Do** respect `prefers-reduced-motion`; the app already gates its motion on it.

### Recorded exception: focus indicators

Focus indicators are **suppressed app-wide by explicit product decision.** This design system previously specified a 2px solid Signal Blue outline, and that outline shipped; it was then removed at the owner's direction because the ring read as visual noise during ordinary mouse use.

The cost is real and was accepted knowingly: a sighted keyboard user has no way to tell where focus is, and the app does not meet WCAG 2.2 *Focus Appearance*. Screen-reader users are unaffected — roles, labels, and the two live regions are intact.

The entire decision lives in one commented block in `styles.css`. Deleting that block restores the documented ring exactly as specified above; nothing else in the codebase needs to change. Treat it as reversible, not as settled taste.

### Don't:
- **Don't** put a shadow on a card, row, or panel that sits in the document flow.
- **Don't** introduce a gradient on a surface, a button, or a badge.
- **Don't** use a colored fill for an ordinary action — primary is slate, not blue.
- **Don't** hard-code a hex value in a component; every color goes through a token.
- **Don't** signal state with an icon or color alone — pair it with a label or badge text.
- **Don't** exceed 24px of spacing to separate sections; use a border or a tonal change instead.
- **Don't** grow control heights past 30px, page headers past 68px, or the topbar past 46px. Density is the point, and these are the settled numbers — `data-compact` exists to go one step tighter still, so it must always resolve below the default it overrides.
- **Don't** copy the plan approval card's tinted field or left rule onto any other component, including the tool approval variant.
- **Don't** spend Grove Green on an informational note. It marks a completion that happened, not a description of one that might.
- **Don't** put `aria-live` on streaming text, a thought log, or an approval card body. A live region on growing content re-reads the whole thing on every token, and an approval card under `role="alert"` interrupts with its full contents; approval cards are a `role="group"` labelled by their heading, and the short live region does the announcing.
- **Don't** hoist a page's description above its title as a kicker. `PageHeader` reads title then detail; the slot above the title is reserved for location — the folder you are in — and nothing else. A description that also appears elsewhere on the same screen belongs in one of the two places, not both.
- **Don't** widen the focus suppression past real controls. The global block nulls `outline` and `box-shadow` only on an explicit `:is()` list of controls; an unscoped `:focus { box-shadow: none }` would also strip elevation from focused *containers* — the command dialog takes `tabindex="-1"` and would lose its shadow. Two of the three exempted rules are deliberate: `.skip-link:focus` (transform, not a border) and the turn-navigator keyboard preview.

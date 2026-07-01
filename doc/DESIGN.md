# Raagam ERP — Design System

Design DNA distilled from the PRD interview (Design DNA + System Integration / UI sections).

## Personality
- **Friendly & approachable** yet professional — used daily by 50–100 people from
  factory-floor supervisors to the accounts team and the MD.
- **Dense & data-rich** — screens show a lot at once (tables, ledgers, dashboards);
  optimise for scanning, not whitespace.
- **Instant & confirming** — actions feel immediate; every save/confirm gives clear,
  unmistakable feedback (toasts, status pills).
- **Web + mobile equal priority** — office staff on desktop, supervisors on phones.

## Color
Light theme is primary; a dark theme exists for low-light factory areas.

| Token | Light | Use |
|-------|-------|-----|
| background | #f6f7f9 | app canvas |
| surface | #ffffff | cards, tables |
| surface-muted | #f1f3f5 | table headers, subtle fills |
| foreground | #16181d | primary text |
| muted-foreground | #5b6472 | secondary text |
| border | #e3e6ea | dividers, inputs |
| primary | #4f46e5 | primary actions, links (indigo) |
| accent | #0d9488 | secondary highlight (teal) |

### Status / traffic-light (T&A dashboard, statuses)
| Token | Color | Meaning |
|-------|-------|---------|
| success | #15803d | on track / approved / completed |
| warning | #b45309 | due soon / pending review |
| danger | #b91c1c | overdue / rejected / negative stock |
| info | #1d4ed8 | informational / in progress |

Each status has a soft background variant for pills and row highlights.

## Typography
- Sans: Geist (system fallback). Base size **14px** (dense UIs read better tighter).
- Scale: 12 (meta), 14 (body), 16 (section), 20 (page title), 24 (dashboard KPI).
- Mono: Geist Mono for codes, amounts, IDs.

## Spacing & shape
- 4px base grid. Compact paddings (tables: 8px/12px cells).
- Radii: sm 4px, md 6px, lg 8px. Subtle shadows only.

## Components
- **Button** — primary (indigo), outline, ghost, danger, subtle. Sizes sm/md/lg/icon.
- **Input / Select / Label** — 36px height, clear focus ring.
- **Card** — header (title + actions) + body; the unit of layout.
- **DataTable** — dense rows, sticky header, right-aligned numerics, zebra optional.
- **StatusPill** — soft bg + colored text; traffic-light semantics.
- **Tabs** — for multi-section detail screens (e.g. order detail, cost sheet).
- **Toast** — bottom-right; success/error; the "clear & confirming" feedback.
- **KPI stat** — big number + label + delta, for dashboards.

## Key screens
- **Login** — email/password and phone-OTP, single card.
- **App shell** — left sidebar (modules, role-filtered), top bar (location switcher,
  user menu, alerts), responsive to a bottom nav on mobile.
- **Order T&A dashboard** (landing) — KPI row + "milestones due this week / overdue"
  with traffic lights + per-order progress.
- **Sales pipeline** — dense list/table of opportunities by stage.
- **Cost sheet** — line-item editor computing FOB; clone-and-revise.
- **Order detail** — tabs: line items, revisions, T&A, amendments.

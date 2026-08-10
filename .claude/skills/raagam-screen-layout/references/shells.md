# The shells — API and reasoning

Everything here is documented in no other file. `doc/ui/LAYOUT.md` covers the anatomy,
field width, grouping and child rows; this covers the surfaces themselves, the save
model and the small pure modules that support them.

---

## `MasterFullScreen` — one layout, two mounts

`components/masters/master-full-screen.tsx`

```tsx
<MasterFullScreen
  ref={shellRef}                 // MasterFullScreenHandle — see goToSection
  mount="overlay" | "page"       // default "overlay"
  open                           // always true on a page mount
  dirty={dirty}                  // PAGE MOUNT ONLY, and required there
  onClose={() => setMode("list")}
  modeLabel={<>Editing <b>ACME</b></>}   // overlay only
  header={/* optional */}
  sections={sections}
  footer={{ status, onCancel, onSave, saveLabel, canSave, onBlockedSave,
            onSaveDraft, draftLabel, isPending, extra }}
/>
```

### What is identical across mounts, and must stay so

The content pane, byte for byte:

```tsx
<div data-focus-scope data-focus-region="content" className="min-h-0 flex-1 overflow-y-auto">
```

`data-focus-scope` is what makes `isEditorScope()` true, and it is the marker AGENTS.md
records **~51 page-level editors as missing** (`--check tab-page-form`: "Tab keeps
native order here, so it leaves the form"). A page mount cannot lack it, because it is
not conditional on the mount. That is the single highest-value property of this shell.

`registerContentEdge` is keyed on the same pane, so Tab-off-last-field and
Enter-off-last-field both open the next section from **one** registration.

### What differs, and why

| | `overlay` | `page` |
|---|---|---|
| Root | `fixed inset-0 z-[80]` | `min-h-0 flex-1`, in flow, bordered |
| Reload guard | `useModalGuard(open)` | `useUnsavedGuard(dirty \|\| isPending)` |
| Body scroll lock | yes | no |
| Escape | own `document` listener | **none** |
| Topbar + ✕ | rendered | not rendered |
| Footer | bottom of the fixed root | `sticky bottom-0` with `env(safe-area-inset-bottom)` |

- **Reload guard.** `useModalGuard` blocks the silent PWA auto-update for as long as
  the surface is mounted. On a route that is forever, so the page would never receive a
  deploy — the same failure AGENTS.md records for an ungated tooltip flag. A page gates
  on real dirtiness instead, which is why `dirty` is required there.
- **Escape.** The provider's window-bound last layer already does `hasOpenModalInDom()`
  → `confirmDiscard()` → `router.back()`. A second listener would ask the discard
  question twice, and its `preventDefault()` would stop the page ever being left —
  breaking the bottom rung of "Escape unwinds one layer per press".
- **Root height.** `min-h-0 flex-1` requires the host to be `flex h-full flex-col`.
  `min-h-0` is not decoration: a flex item defaults to `min-height:auto` and refuses to
  shrink below its content, so without it a long record pushes the footer off the
  bottom.

### `header` is optional

Omit it on a page mount whose route already renders a `PageHeader` — two title bands
stacked is the same record announced twice.

---

## Sections

```ts
type FullScreenSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  done?: boolean;      // quiet "has data" dot
  problems?: number;   // red count; replaces the dot
  content: ReactNode;  // rendered ONLY while active
};
```

`problems` replaces `done` rather than sitting beside it: a section with blocking
problems is not "done", and two indicators on a 228px rail item is where the label
starts truncating.

A **count**, not a dot — across ten sections a dot says "something is wrong in here"
and a count says how much is left.

The badge uses `bg-danger-soft text-danger`, the app's existing danger idiom. There is
no `--danger-foreground` token and `--danger` inverts to a light red in dark mode, so a
filled pill would need hardcoded white text and fail one theme.

### `goToSection`

```ts
type MasterFullScreenHandle = {
  goToSection(key: string,
              land?: "first" | "last" | "problem" | { fieldId: string }): void;
};
```

`"problem"` targets `[data-dup-error]` then `[data-required-empty]` — duplicate first,
the same precedence `holdReason()` applies, because "already exists" is the more useful
thing to say. The operator lands on a field **already holding**, so the reveal hands off
to the existing cursor hold: the two are one mechanism seen from opposite ends.

The 60 ms delay before landing is load-bearing — a section switch remounts the pane, so
the target does not exist until after the commit. Do not "optimise" it into a
`useLayoutEffect`.

---

## The save model

### `footer.onBlockedSave` — why Save stays clickable

Supplying it makes Save dimmed but **enabled** when `canSave` is false, and clicking it
calls this instead of `onSave`.

This is a keyboard fix, not a UX nicety. `submitTargetOf` (`lib/focus.ts`) resolves a
surface's primary action to the footer's **last non-disabled button**. Disable Save and
Ctrl+S and Enter-off-the-last-field silently reroute to "Save as Draft" or Cancel. Kept
enabled, all three entry points land on one handler.

It deliberately carries **no `aria-disabled`**: the button does something when clicked,
and telling a screen reader otherwise would be a lie about a control that acts.

### `lib/screens/validity.ts`

```ts
sectionValidity({ sections, values, fields, extra })
  → { problems, blocking, bySection, canSave, first }
```

- `fields` are per-field `required` declarations, matching the `*` the form already
  draws. A field hidden by a `when` must not reach this list — filter first, so
  "requiring a hidden field" is unrepresentable rather than merely discouraged.
- `extra` carries what no single field can know: a live duplicate answer, a cross-tab
  rule. Each entry names its **section**, which is the whole point — the current screens
  compute exactly these and throw the location away.
- `isBlocking` blocks everything except `"format"`. The line is: does this say the
  RECORD is incomplete, or that a VALUE is malformed *while still being typed*? A format
  error fires against half-typed input, and caging an operator on a value they are in
  the middle of getting right is the mistake `consignee-master-screen.tsx` avoids by
  keeping its GSTIN check plain amber text.

**Deliberately not a hook.** There is no state — it derives from `values`. A `useMemo`
would never hit, because callers build `fields` inline so the dep array changes identity
every render. Staying a plain function also lets the *server* run the same code.

### `lib/screens/workflow.ts`

`Workflow`, `WorkflowStatus`, `WorkflowTransition`, `statusOf`, `nextActions`,
`isLocked`, `workflowIssues`. Client-side only; needs no migration.

**A workflow bar goes in `header.right`, never the footer.** `submitTargetOf` takes the
footer's last button by position, so `Approve` after `Save` means *Enter off the last
field approves the document*. "Workflow separate from Save" is therefore a keyboard
requirement, not a layout preference.

`statusOf` returns a readable stand-in for an undeclared status rather than throwing or
returning null — a row can hold a value the spec has not caught up with, and neither
crashing nor rendering an empty pill is honest.

---

## `components/ui/tabs.tsx`

A real tablist: arrow keys, roving tab stop, ARIA roles, controlled `value`/`onChange`,
per-tab `problems` count and `done` dot, and auto-scroll of the active tab into view.

**Prefer the section rail for a record.** The strip is for module- or document-level
navigation. If a strip is used for a record, it must still carry `problems`, or a
blocked Save is unexplainable with one panel mounted at a time.

---

## `lib/ui/sizes.ts` and `lib/ui/tone.ts`

`FieldSize` and `StatusTone` live in `lib/ui/` rather than beside their components, and
`field.tsx` / `status-pill.tsx` re-export them.

The reason is a purity rule: `lib/screens/**` must be loadable by **plain Node** — by
`lib/data-io`, by `"use server"` action files, by check scripts under type stripping.
One `.tsx` in that import graph and the constraint stops being provable by reading the
graph. `import type` is erased and would in fact work, which is exactly why the rule is
"no `.tsx` at all": a rule that holds only while nobody drops the `type` keyword is not
a rule.

The Tailwind class maps stay in the components. These files are the vocabulary; those
are the rendering.

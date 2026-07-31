#!/usr/bin/env python3
"""Audit a Raagam checkout for screens that have drifted out of doc/ui/LAYOUT.md.

The layout contract is written down and research-backed, and it was still ignored
by 58 of 60 master editors -- because nothing checked. 92 screens had drifted into
29 different `grid-cols-*` values before anyone counted. This is the counter.

Findings are CANDIDATES to inspect, not verdicts. The checks are textual
heuristics, so a hit may legitimately be fine (LAYOUT.md names real exemptions)
and a miss does not prove compliance. Read the flagged file before changing it.

Checks run against a comment-stripped copy of each file, because this codebase
documents its own past bugs in comments -- searching raw text finds the bug
description and reports the fix as the defect.

  NOTE ON THE DUPLICATED SCANNER
  The file-walking / comment-stripping helpers below are copied from
  .claude/skills/raagam-keyboard-contract/scripts/audit_keyboard.py rather than
  imported. That is deliberate: `.claude/` is gitignored, so the keyboard audit
  is a local-only tool. This one lives in tracked `scripts/` so the whole team
  and CI actually get it, which means it cannot import from there.

Usage:
    python scripts/audit_layout.py .
    python scripts/audit_layout.py . --check screen-grid
    python scripts/audit_layout.py . --quiet     # findings only, no summary
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SKIP_DIRS = {
    "node_modules", ".next", ".git", "dist", "build", "out",
    "coverage", "public", ".claude", "supabase",
}

SOURCE_SUFFIXES = {".tsx", ".ts"}

# The primitives OWN the classes every check below complains about. They are the
# one place a `grid-cols-*` or an `@container/editor` is correct by definition.
PRIMITIVES = {
    "components/masters/section-grid.tsx",
    "components/masters/detail-section.tsx",
    "components/masters/child-grid.tsx",
    "components/masters/master-full-screen.tsx",
    "components/masters/master-list-shell.tsx",
    "components/ui/field.tsx",
    "components/ui/sheet.tsx",
    "components/ui/data-table.tsx",
    # The shared picker trigger/clear classes -- the same role input.tsx plays
    # for inputs, so it owns the size and type rules rather than repeating them.
    "components/masters/picker-classes.ts",
    # Owns the row-action cluster's flex/gap and the action column's fixed width
    # (LAYOUT.md 6a), so it is the one place those classes are correct.
    "components/ui/row-actions.tsx",
    "components/ui/tooltip.tsx",
    # The mobile two-step delete, and the mobile card that hosts it -- both
    # legitimately render an action cluster, just not the desktop one.
    "components/masters/delete-confirm-button.tsx",
    "components/masters/mobile-card-list.tsx",
    # The two engines that OWN the desktop cell on behalf of their screens.
    "components/masters/simple-master-screen.tsx",
}

# Full-page singleton editors: a settings form that legitimately has no Sheet and
# no record list to open from, so there is no surface to inherit the density
# container from and declaring it locally is correct, not a clone. Kept separate
# from PRIMITIVES because these are screens -- every OTHER check still applies to
# them. Add to this list only when a screen is genuinely a standalone page form.
PAGE_EDITORS = {
    "components/masters/default-account-head-screen.tsx",
}


@dataclass
class Finding:
    check: str
    path: Path
    line: int
    message: str


def iter_sources(root: Path):
    for path in root.rglob("*"):
        if path.suffix not in SOURCE_SUFFIXES or not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        yield path


def strip_comments(text: str) -> str:
    """Blank out // and /* */ comments, preserving length so line numbers survive.

    String literals are tracked so a "//" inside a URL or className is not
    mistaken for a comment.
    """
    out = list(text)
    i, n = 0, len(text)
    state: str | None = None
    quote = ""
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if state is None:
            if c == "/" and nxt == "/":
                state, out[i], out[i + 1] = "line", " ", " "
                i += 2
                continue
            if c == "/" and nxt == "*":
                state, out[i], out[i + 1] = "block", " ", " "
                i += 2
                continue
            if c in "\"'`":
                state, quote = "str", c
            i += 1
        elif state == "line":
            if c == "\n":
                state = None
            else:
                out[i] = " "
            i += 1
        elif state == "block":
            if c == "*" and nxt == "/":
                out[i], out[i + 1], state = " ", " ", None
                i += 2
                continue
            if c != "\n":
                out[i] = " "
            i += 1
        else:  # inside a string literal
            if c == "\\":
                i += 2
                continue
            if c == quote:
                state = None
            i += 1
    return "".join(out)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def is_editor_screen(code: str) -> bool:
    """True when the file renders a master editor surface or a section of one.

    Scopes the layout checks to the screens the contract governs. A picker, a
    chart, a nav shell or a report view legitimately writes its own grid.

    `@container/editor` counts as a surface even though only the primitives may
    declare it (see check_editor_clone). A hand-rolled clone renders none of the
    components below -- `vendor-master-screen.tsx` has zero `DetailSection` --
    so keying purely on those tags let the worst-drifted files in the repo skip
    every check by having drifted far enough.
    """
    return bool(
        re.search(r"<(Sheet|MasterFullScreen|DetailSection|SectionGrid|FieldGrid)\b", code)
        or "@container/editor" in code
    )


# --------------------------------------------------------------------------
# Checks. Each takes (path, code, slug) where `code` is comment-stripped source
# and `slug` is the repo-relative posix path.
# --------------------------------------------------------------------------

def check_screen_grid(path: Path, code: str, slug: str):
    """LAYOUT.md §1: screens never write their own grid / span / gap classes.

    Width belongs to `<Field size>` and column count to `SectionGrid` /
    `DetailSection cols`. A hand-rolled grid is how 92 screens ended up with 29
    different `grid-cols-*` values and three competing width systems.

    `@lg/section:col-span-*` is the contract's OWN vocabulary and is never
    flagged. Bare `sm:col-span-2` is the legacy "full width of a 2-col section"
    idiom -- still valid inside `cols={2}`, so it is reported only in a file that
    has moved to the 12-col track, where it means something else entirely.
    """
    if slug in PRIMITIVES or not is_editor_screen(code):
        return
    on_12_col_track = "cols={12}" in code
    for m in re.finditer(r"(?<![\w:/-])(grid-cols-\[|grid-cols-\d|col-span-\d)", code):
        # Skip the contract's own container-query spans.
        before = code[max(0, m.start() - 20): m.start()]
        if before.endswith("@lg/section:") or before.endswith("@4xl/sections:"):
            continue
        if m.group(1).startswith("col-span") and not on_12_col_track:
            continue  # legacy 2-col idiom, still correct where it sits
        yield Finding(
            "screen-grid", path, line_of(code, m.start()),
            f"screen writes its own `{m.group(1)}...`; use SectionGrid / DetailSection cols / Field size",
        )


def check_screen_table(path: Path, code: str, slug: str):
    """LAYOUT.md §1/§6: repeating rows are a ChildGrid, never a hand-rolled table.

    A raw <table> in an editor reimplements ChildGrid's card/inline modes, its
    pagination and -- the part that actually breaks -- its keyboard navigation:
    `gridKeyNav` keys off `data-grid-row`, so arrows silently do nothing in a
    hand-rolled table's card fallback.
    """
    if slug in PRIMITIVES or not is_editor_screen(code):
        return
    m = re.search(r"<table\b", code)
    if m:
        yield Finding(
            "screen-table", path, line_of(code, m.start()),
            "hand-rolled <table> in an editor; use ChildGrid (rows) or DataTable (lists)",
        )


def check_field_track(path: Path, code: str, slug: str):
    """`cols={12}` and `<Field>` are one mechanism and must appear together.

    `cols={12}` with bare <div> children puts each child in its own one-twelfth
    column -- the single most destructive way to get this wrong. The reverse,
    `<Field>` with no 12-col track, is harmless (the `@lg/section:` spans simply
    do not match) but almost always means the author expected sizing to work.
    """
    if slug in PRIMITIVES:
        return
    has_track = "cols={12}" in code or "<FieldGrid" in code
    has_field = re.search(r"<Field\b", code) is not None
    if has_track and not has_field:
        m = re.search(r"cols=\{12\}", code)
        yield Finding(
            "field-track", path, line_of(code, m.start()),
            "cols={12} with no <Field> children; every child collapses to 1/12 of a row",
        )
    elif has_field and not has_track:
        m = re.search(r"<Field\b", code)
        yield Finding(
            "field-track", path, line_of(code, m.start()),
            "<Field size> outside a cols={12} / FieldGrid track; spans will not apply",
        )


def check_editor_clone(path: Path, code: str, slug: str):
    """Only the two real editor surfaces may declare `@container/editor`.

    A screen that declares it is a hand-rolled clone of Sheet / MasterFullScreen
    -- it copied the layout but not the focus trap, the sheetStack Escape
    ordering, the autofocus or the Ctrl+S wiring, and then drifts from them.
    `vendor-master-screen.tsx` said so in its own comment for months.
    """
    if slug in PRIMITIVES or slug in PAGE_EDITORS:
        return
    m = re.search(r"@container/editor", code)
    if m:
        yield Finding(
            "editor-clone", path, line_of(code, m.start()),
            "declares @container/editor; render Sheet / MasterFullScreen instead of cloning it",
        )


def check_text_size_noop(path: Path, code: str, slug: str):
    """LAYOUT.md §7: `text-base md:text-sm` lives in the control, not the call site.

    The iOS-zoom guard moved into input.tsx / select.tsx / combobox.tsx /
    textarea.tsx. Every remaining copy is a no-op that survives review because it
    looks deliberate, and it hides the one case that is NOT a no-op: a call site
    fighting the control's own size.
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    for m in re.finditer(r"text-base\s+md:text-sm", code):
        yield Finding(
            "text-size-noop", path, line_of(code, m.start()),
            "redundant `text-base md:text-sm`; the control primitive already sets it",
        )


# Field names whose values are digits, an address or a URL rather than words --
# LAYOUT.md §11's "digit formats" exemption, expressed as the binding name.
CONTACT_FIELD = re.compile(
    r"value=\{[^}]*\b("
    r"land_?line|mobile|whats_?app|phone|fax|pin|pincode|isd|"
    r"email|website|url"
    r")\b",
    re.I,
)


def _jsx_open_tag(code: str, start: int) -> str:
    """The full opening tag beginning at `start`, brace-aware.

    A naive `<Input[^>]*` stops at the `>` of an arrow function -- and almost
    every JSX input has an `onChange={(e) => ...}`, so it would read only the
    first attribute or two and miss `uppercase` sitting after the handler. Track
    brace depth and end at the first `>` that is genuinely outside a JSX
    expression container.
    """
    depth = 0
    for i in range(start, len(code)):
        c = code[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0:
            return code[start : i + 1]
    return code[start : start + 400]


def check_caps_input(path: Path, code: str, slug: str):
    """Master field values are stored in CAPITALS (client 2026-07-23).

    `<Input uppercase>` is the mechanism: it uppercases the keystroke AND adds a
    CSS text-transform, so rows saved before the rule still display in caps.

    Scoped to `components/masters/` on purpose. A repo-wide version fires on
    hundreds of legitimate numeric, date and id fields and gets ignored, which is
    how the layout contract was ignored by 58 of 60 editors before this script
    existed. Narrow and believed beats broad and muted.

    An `<Input` is exempt when it declares a `type=` (number / date / password /
    email are not caps candidates), because free text is the only case the rule
    is about. `ValidatedInput` is a different tag and never matches -- it owns
    its own casing via the format's transform.
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    if "components/masters/" not in slug:
        return
    for m in re.finditer(r"<Input\b", code):
        tag = _jsx_open_tag(code, m.start())
        if "uppercase" in tag or "type=" in tag:
            continue
        # A search box is not a field value -- forcing the operator's query to
        # caps changes nothing about what is stored and everything about how the
        # toolbar reads. Every master list has one, which is why this exemption
        # is worth more than the findings it removes.
        if re.search(r'placeholder="Search', tag, re.I):
            continue
        # A derived / auto-generated field the user cannot type into. These
        # render placeholders like "(auto)" and "#3"; uppercasing turns them
        # into "(AUTO)", which reads as data rather than as a hint.
        if re.search(r"\b(readOnly|disabled)\b", tag):
            continue
        # Digit / contact formats. LAYOUT.md §11 exempts these because
        # `uppercase` is a no-op on digits -- adding it would be noise that
        # reads as a mistake. Matched on the bound field name, which is the
        # only signal available statically.
        #
        # These SHOULD be `ValidatedInput format="…"`, and several still are
        # not; that is a real gap this check cannot express, because the tag it
        # would flag is the tag it is told to ignore. Fix them by conversion,
        # not by adding `uppercase`.
        if re.search(CONTACT_FIELD, tag):
            continue
        yield Finding(
            "caps-input", path, line_of(code, m.start()),
            "field value not in CAPS; add `uppercase` to <Input> or give it a type=",
        )


def check_row_actions(path: Path, code: str, slug: str):
    """LAYOUT.md 6a: no screen writes its own View/Edit/Delete cell.

    131 files declared their own `header: ""` action column and drifted into six
    incompatible dialects with four different delete confirmations -- inline
    two-step, `window.confirm`, one-click-no-confirm, and Deactivate-only. Three
    signals, because the dialects do not look alike:

      1. a hand-declared `header: ""` column   -> use rowActionsColumn/actions
      2. a ghost Edit/Delete/Del/Deactivate    -> the labels the dialects used
         button inside a table cell
      3. `window.confirm`                      -> never the delete confirmation

    Signal 2 deliberately looks for the LABEL, not the handler: `remove(r)` is
    also called from a Sheet footer, which is fine.
    """
    if slug in PRIMITIVES:
        return

    # A headerless column is not automatically an action column -- a colour
    # swatch or an expand chevron legitimately has no header. Require something
    # clickable in the next few lines before calling it one.
    for m in re.finditer(r'header:\s*""', code):
        window = code[m.start(): m.start() + 600]
        if not re.search(r"<Button|onClick=|<RowActions", window):
            continue
        yield Finding(
            "row-actions", path, line_of(code, m.start()),
            'hand-declared `header: ""` action column; use rowActionsColumn() '
            "or MasterListShell's `actions` (LAYOUT.md 6a)",
        )

    # A row action's giveaway is the label sitting in a `cell:` renderer. The
    # `cell:` lookback matters: the same button in a Sheet footer or on a detail
    # card is not a row action, and flagging it sends the reader somewhere the
    # rule does not apply.
    for m in re.finditer(
        r'<Button[^>]*?>\s*(Edit|Delete|Del|Deactivate|Activate)\s*</Button>', code, re.S
    ):
        if "cell:" not in code[max(0, m.start() - 500): m.start()]:
            continue
        yield Finding(
            "row-actions", path, line_of(code, m.start()),
            f"`{m.group(1)}` rendered as its own button; row CRUD belongs to "
            "<RowActions> (LAYOUT.md 6a)",
        )

    # This flags confirm() only where it is guarding a DELETE, which is the thing
    # standardised here. Two narrowings, both to keep the finding truthful:
    #
    #   * a file declaring its own `confirm` is not calling the browser dialog --
    #     several workflow screens have a local `function confirm(id)` that
    #     confirms a RECORD;
    #   * a confirm() in a file with no delete action is guarding something else
    #     (a status transition that wins an opportunity, say). That may still be
    #     worth replacing with an in-app dialog, but it is not this rule's claim.
    #
    # reload-guard owns the one confirm() that is correct by design.
    deletes_something = re.search(r"\bdelete[A-Z]\w*\s*\(", code) is not None
    if slug != "lib/reload-guard.ts" and deletes_something:
        shadowed = re.search(r"\b(?:function|const|let)\s+confirm\b", code) is not None
        pattern = r"\bwindow\.confirm\s*\(" if shadowed else r"\b(?:window\.)?confirm\s*\("
        for m in re.finditer(pattern, code):
            yield Finding(
                "row-actions", path, line_of(code, m.start()),
                "window.confirm as a delete guard; the app's only delete "
                "confirmation is the two-step in <RowActions> (LAYOUT.md 6a)",
            )


# An <option ...> opening tag. No `>` can appear inside the attributes of one --
# option attrs are `key={x}` / `value={x}`, never an arrow function -- so the
# lazy character class is safe here in a way it is not for <Input (see
# _jsx_open_tag).
OPTION_TAG = re.compile(r"<option\b[^>]*>")

# The row's primary key handed straight to the <option> AS ITS VALUE:
# `<option key={c.id} value={c.id}>`. A row id in an option's value is a stored
# record by definition -- an enum member is its own value (`value={m}`,
# `value={o.value}`), it has no id.
#
# `value=`, not the whole tag, and the distinction earns its keep: the two HSN
# Assign screens are built alike but store different things. Materials writes
# `items.hsn_id`, a uuid FK -> `value={o.id}` -> a picker fits and it is flagged.
# Processes writes `processes.hsn_code`, a plain TEXT column -> `key={o.id}
# value={o.code ?? ""}` -> DataPicker's contract is `value` = row id, so the
# id-based picker does not fit and it is not flagged.
#
# The gap this leaves, stated rather than hidden: a select storing a natural KEY
# from a real table is now invisible here. Those exist -- `CurrencyPicker` is
# code-keyed (`currencies` PK = code) -- so a code-keyed select CAN deserve a
# picker. Nothing static separates that from Process HSN's TEXT column; the
# column type decides, and only a human can read it.
STORED_ID = re.compile(r"\bvalue=\{[^}]*\.id\b[^}]*\}")

# `{MADE_TYPES.map((m) => …)}` -- a module-level constant, not a table. Belt and
# braces beside STORED_ID (a const array of strings has no `.id` to match), but
# it states the exemption instead of leaving it to a coincidence.
SCREAMING_CASE = re.compile(r"[A-Z][A-Z0-9_]{2,}")
TRAILING_IDENT = re.compile(r"([A-Za-z_$][\w$]*)\s*$")

# A blank first option reading "All …" is a list filter, not a field: it edits
# the query, not the record, so there is nothing to Add / Modify / Delete.
FILTER_ALL = re.compile(r'<option\s+value=""\s*>\s*All\b')

SELECT_ID = re.compile(r'\bid="([^"]+)"')
SELECT_ARIA = re.compile(r'\baria-label="([^"]+)"')
DECL_NAME = re.compile(r"\b(?:const|let|function)\s+([A-Za-z_$][\w$]*)\s*[=(]")

# How far a declaration may sit above a `<Select>` and still be read as its
# name. A helper whose whole body is the select -- `const uomSelect = (…) => (`
# -- puts them within a line or two; anything further is a declaration the
# element merely happens to follow. Without the cap, `const hsnSelect` claimed
# all five selects in its file including one 2,807 characters later, which would
# have let one exemption silence a field nobody had looked at.
DECL_REACH = 200


def _select_names(code: str, start: int) -> set[str]:
    """The names a `<Select>` goes by, for the exemption sets below.

    Three sources, in the order a reader would reach for them:

      * `id=` -- most fields have one;
      * `aria-label="…"` -- what the control is called when it has no id, and
        the name a screen reader already announces (`"Bulk HSN"`);
      * the declaration immediately above it, within DECL_REACH -- for a helper
        whose entire body is the select, rendered from several call sites and so
        owning no single id (`uomSelect`, `hsnSelect`).

    All three beat a line number, which every edit above the field moves.
    """
    names = set()
    tag = _jsx_open_tag(code, start)
    for pattern in (SELECT_ID, SELECT_ARIA):
        attr = pattern.search(tag)
        if attr:
            names.add(attr.group(1))
    decls = DECL_NAME.findall(code[:start])
    if decls and start - code.rfind(decls[-1], 0, start) <= DECL_REACH:
        names.add(decls[-1])
    return names


# Fields that are select-only for a STRUCTURAL reason no static check can see:
# application code branches on the VALUE, so the list must not grow. Each one
# carries its reasoning beside it in its own file; it is repeated here because
# comments are stripped before the checks run, so the script cannot read the one
# thing that justifies the exemption.
#
#   mt-fabric-type   (material-master) Shade and the Mixing grid gate on the
#                    NAME -- `.includes("yarn") && .includes("dyed")` and
#                    `=== "melange"`. A type added here would do nothing; one
#                    RENAMED here breaks both silently.
#   mt-item-class    (material-master) `itemClassForm(selectedClassCode)` picks
#                    the whole form from the class CODE, so a class added here
#                    opens a form that does not exist.
#   cat-item-class   (category-master) same shape: `showFabricStructure`,
#                    `showSubCategories` and Category Type are all read off
#                    `selectedClassCode`.
#   cop-class        (commodity-picker) the class a commodity is classified
#                    INTO, and the screens reading commodities branch on it. A
#                    class invented inside a quick-create would classify the row
#                    into something no form knows how to show.
#   ma-item-class    (material-attribute) the rest of the form is read off the
#                    chosen class -- its attribute values and its code -- and
#                    the list is pre-filtered to accessory classes, which a
#                    picker's "+ Add" would quietly widen.
#
# All five are Item Class or a class-like parent, which is the pattern rather
# than a coincidence: a field that selects which QUESTIONS the form asks cannot
# also be a field the operator extends from inside that form.
#
# Widening this set is a decision about the app, not about the audit: add to it
# only when the code genuinely branches on the value, and put the reason in BOTH
# places.
STRUCTURAL_SELECTS = {
    ("components/masters/material-master-screen.tsx", "mt-fabric-type"),
    ("components/masters/material-master-screen.tsx", "mt-item-class"),
    ("components/masters/category-master-screen.tsx", "cat-item-class"),
    ("components/masters/commodity-picker.tsx", "cop-class"),
    ("components/masters/material-attribute-master-screen.tsx", "ma-item-class"),
}

# NOT settled -- deliberately a separate set, and the separation is the point.
# These are silenced so the check can reach zero, because a report carrying a
# permanent known hit trains people to skim output that should be empty, and a
# skimmed audit protects nothing. But nothing about them has been DECIDED, so
# they do not belong in a list named "structural" where a later reader would
# take them for resolved.
#
#   uomSelect  (material-master) The `uoms` master has no picker in this
#              codebase, and one written for it would have to carry `limitTo` --
#              a list narrowed by ANOTHER field's rows, which no existing picker
#              does. So this is a new shared component plus a decision about
#              what "+ Add" means when the list is deliberately restricted (a
#              unit added inline would sit outside every conversion row and
#              reintroduce the unreachable Purchase Uom the limit exists to
#              prevent). Converting it is a design question, not a swap.
#
#   hsnSelect  (material-hsn-assign, the row field) The ADAPTER cannot express
#   Bulk HSN   (material-hsn-assign, the bulk field) a value this field needs:
#              null. Clearing an HSN is half of what a bulk assign screen does
#              -- `bulkApply` offers "— cleared —" and writes null to
#              `items.hsn_id` -- and `LookupDialogPicker` is `clearable={false}`
#              with an `onChange` of `(id) => onChange(id ?? "")`, which never
#              emits null. That is correct for the ~78 config-lookup fields it
#              serves, which clear by picking something else. Two costs on top:
#              there is nothing for a CRUD bar to do (the HSN list is maintained
#              on the HSN master; this screen only assigns from it), and it is
#              one control per row across a bulk grid, where hundreds of
#              `DataPicker` instances buy nothing.
#
#              Open, not structural: a bare `DataPicker` DOES support
#              `clearable`, so this converts the day someone decides
#              search-as-you-type is worth the per-row cost. Nothing forbids it.
#              Its sibling `process-hsn-assign-screen.tsx` needs no entry at
#              all -- storing a code string in `value=`, it falls out of the
#              rule by itself.
#
# When UOM gets a picker, when a clearable HSN picker is worth building, these
# entries go away -- they are not exemptions to defend, they are debts to pay.
OPEN_QUESTIONS = {
    ("components/masters/material-master-screen.tsx", "uomSelect"),
    ("components/masters/material-hsn-assign-screen.tsx", "hsnSelect"),
    ("components/masters/material-hsn-assign-screen.tsx", "Bulk HSN"),
}


def _select_blocks(code: str):
    """Yield `(start, body)` for every `<Select> … </Select>` pair.

    Paired with a stack so a Select nested inside another is attributed to the
    inner one. Comments are already stripped by the caller, which matters more
    here than anywhere else in this file: four masters screens *describe* a
    `<Select>` in prose and would otherwise leave an unclosed open tag that
    swallows the rest of the file into one block.
    """
    events = sorted(
        [(m.start(), "open") for m in re.finditer(r"<Select\b", code)]
        + [(m.start(), "close") for m in re.finditer(r"</Select\s*>", code)]
    )
    stack: list[int] = []
    for idx, kind in events:
        if kind == "open":
            stack.append(idx)
        elif stack:
            start = stack.pop()
            yield start, code[start:idx]


def check_stored_select(path: Path, code: str, slug: str):
    """LAYOUT.md §5a: stored data is a DataPicker, never a plain <Select>.

    A `<Select>` whose `<option>`s are mapped off table rows is a dropdown the
    operator cannot add to, rename from or delete out of -- they leave the form
    they are filling, go to that master's own screen, create the row, come back
    and start again. That is the flow §5a removed for 78 fields; the ones that
    were missed stayed as plain `<Select>`s and the client found them.

    The tell is a row id reaching the option AS ITS VALUE -- `<option key={c.id}
    value={c.id}>` -- because only a stored record has one (see STORED_ID for
    what a code-keyed value means and why it is left alone).

    Four things that are NOT this:

      * `filter-bar.tsx` and any block with a blank `All …` option -- a filter
        owns no record;
      * a fixed code list (`MADE_TYPES`, `BUSINESS_ENTITIES`, Yes/No, a status
        enum). §5a's own words: "Enums are not this." There is nothing to
        create, and it already drops down and already searches;
      * the primitives, which render whatever options their caller passes;
      * the named `STRUCTURAL_SELECTS` and `OPEN_QUESTIONS` -- the judgement
        calls, and the only exemptions here a reader has to take on trust. Both
        are keyed on the field's own name and both write out why, in the screen
        as well as here; the second set says the question is still open.

    Scoped to `components/masters/` for the same reason check_caps_input is:
    narrow and believed beats broad and muted.
    """
    if slug in PRIMITIVES or slug == "components/masters/filter-bar.tsx":
        return
    if "components/masters/" not in slug:
        return
    for start, body in _select_blocks(code):
        if FILTER_ALL.search(body):
            continue
        if any(
            (slug, n) in STRUCTURAL_SELECTS or (slug, n) in OPEN_QUESTIONS
            for n in _select_names(code, start)
        ):
            continue
        for m in OPTION_TAG.finditer(body):
            tag = m.group(0)
            if "key={" not in tag or not STORED_ID.search(tag):
                continue
            # Walk back to the `.map(` that produced this option and let a
            # SCREAMING_CASE source off -- that is a constant, not a query.
            mapped = body.rfind(".map(", 0, m.start())
            ident = TRAILING_IDENT.search(body, 0, mapped) if mapped != -1 else None
            if ident and SCREAMING_CASE.fullmatch(ident.group(1)):
                continue
            yield Finding(
                "stored-select", path, line_of(code, start),
                "plain <Select> over stored rows; stored data is a "
                "<DataPicker> -- LookupDialogPicker for a config_lookups kind, "
                "a thin adapter for a table (LAYOUT.md 5a)",
            )
            break


# The pickers whose CRUD bar is switched on by permission props alone. The
# select-only ones -- LevyPicker, AttributePicker, a bare RecordPicker -- accept
# no perms at all, so there is nothing here for them to omit.
#
# The rich-master four were added when every one of their 36 call sites already
# passed a permission, so they cost nothing on the day. That IS the point: this
# check earns its keep on the call site nobody has written yet, and a picker is
# cheapest to cover before it has a violation, not after.
MANAGED_PICKERS = (
    "LookupDialogPicker",
    "CategoryPicker",
    "ItemPicker",
    "CountryPicker",
    "BankPicker",
    "CurrencyPicker",
    "CommodityPicker",
)

PICKER_PERM = re.compile(r"\bcan(?:Create|Edit|Delete)\b")


def check_picker_perms(path: Path, code: str, slug: str):
    """LAYOUT.md 5a: a managed picker with no permissions is a dead dropdown.

    `LookupDialogPicker` defaults every permission to false, so a call site that
    passes none of `canCreate` / `canEdit` / `canDelete` renders a list with no
    pencil, no bin and no "+ Add" -- indistinguishable, on screen, from the plain
    `<Select>` the picker sweep was meant to replace, while passing every check
    that looks for a `<Select>`. Employee's Category / Department / Designation
    shipped exactly like that, next to a Team field on the same row that had
    them. The right component with no permissions is the same bug as the wrong
    component.

    One of the three is enough -- the omission of all three is the tell, and
    `canDelete` deliberately defaults to `canEdit`.

    `<ItemPicker>` is exempt WITHOUT `quickCreateClassId`. Its manage config is
    `quickCreateClassId && (canCreate || canEdit || canDelete)`, so with no class
    to create into there is nothing to scope a new item to and perms would be
    dead code -- the three rate screens that do this each say so in a comment.
    That is a STRUCTURAL select-only, marked by the missing scoping prop rather
    than by the missing perms, and `quickCreateClassId` WITH no perms is still a
    bug: the author asked for a CRUD bar and silently did not get one.

    `<CategoryPicker>` gets NO such exemption, despite looking symmetrical.
    Only its Add is gated (`canAdd = canCreate && !!itemClassId`); `manage` is
    `canAdd || canEdit || canDelete`, so `canEdit` / `canDelete` light up the
    pencil and bin with or without `itemClassId`. Perms are never dead code
    there, so omitting all three is always a real loss.

    Scoped WIDER than check_stored_select -- masters plus orders and sales --
    and the asymmetry is deliberate. This check sits at zero, so a new tree adds
    insurance and no noise. `stored-select` has live hits and a documented blind
    spot; pointing it at trees this sweep never audited would hand it a backlog
    nobody has triaged, and an audit carrying a standing backlog stops being read.
    """
    if slug in PRIMITIVES:
        return
    if not any(
        s in slug
        for s in ("components/masters/", "app/(app)/masters/",
                  "app/(app)/orders/", "app/(app)/sales/")
    ):
        return
    for m in re.finditer(r"<(" + "|".join(MANAGED_PICKERS) + r")\b", code):
        name = m.group(1)
        tag = _jsx_open_tag(code, m.start())
        if PICKER_PERM.search(tag):
            continue
        if name == "ItemPicker" and "quickCreateClassId" not in tag:
            continue
        yield Finding(
            "picker-perms", path, line_of(code, m.start()),
            f"<{name}> passes none of canCreate/canEdit/canDelete; it renders "
            "with no Add / Modify / Delete -- a picker-shaped <Select> "
            "(LAYOUT.md 5a)",
        )


CHECKS = {
    "screen-grid": check_screen_grid,
    "screen-table": check_screen_table,
    "field-track": check_field_track,
    "editor-clone": check_editor_clone,
    "text-size-noop": check_text_size_noop,
    "caps-input": check_caps_input,
    "row-actions": check_row_actions,
    "stored-select": check_stored_select,
    "picker-perms": check_picker_perms,
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("root", type=Path, help="repo root to scan")
    parser.add_argument("--check", action="append", choices=sorted(CHECKS),
                        help="run only these checks (repeatable)")
    parser.add_argument("--quiet", action="store_true", help="findings only")
    parser.add_argument("--files", action="store_true",
                        help="one line per file per check, not per occurrence")
    args = parser.parse_args()

    root: Path = args.root.resolve()
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 2

    selected = {k: CHECKS[k] for k in (args.check or CHECKS)}
    findings: list[Finding] = []
    scanned = 0

    for path in iter_sources(root):
        try:
            code = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        scanned += 1
        slug = rel(path, root)
        for check in selected.values():
            findings.extend(check(path, code, slug))

    if args.files:
        seen: set[tuple[str, str]] = set()
        deduped = []
        for f in findings:
            key = (f.check, str(f.path))
            if key not in seen:
                seen.add(key)
                deduped.append(f)
        findings = deduped

    findings.sort(key=lambda f: (f.check, str(f.path), f.line))
    for f in findings:
        print(f"[{f.check}] {rel(f.path, root)}:{f.line}  {f.message}")

    if not args.quiet:
        by_check: dict[str, int] = {}
        files_by_check: dict[str, set[str]] = {}
        for f in findings:
            by_check[f.check] = by_check.get(f.check, 0) + 1
            files_by_check.setdefault(f.check, set()).add(str(f.path))
        print()
        print(f"scanned {scanned} source files under {root}")
        for name in sorted(selected):
            n = by_check.get(name, 0)
            files = len(files_by_check.get(name, ()))
            print(f"  {name:<16} {n:>5}  in {files} file(s)")
        if findings:
            print()
            print("These are heuristics, and doc/ui/LAYOUT.md names real exemptions.")
            print("Read each file before changing it.")

    # Always exit 0: an advisory audit, not a gate. Wiring it into CI as a
    # blocker would turn every legitimate exception into a broken build --
    # the same call audit_keyboard.py makes.
    return 0


if __name__ == "__main__":
    sys.exit(main())

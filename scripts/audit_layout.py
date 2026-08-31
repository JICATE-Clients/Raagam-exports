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

# The hint-text rules live in their own module because BOTH this checker and
# scripts/sweep_placeholders.py have to apply the same definition of "clutter".
# The sweep already imports this file for its file-walking helpers, so the rules
# cannot live here without making a cycle. See scripts/hint_rules.py.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from hint_rules import (            # noqa: E402
    KEEP_BY_DEFAULT,
    SEARCH_TEXT,
    classify_hint,
    governing_label,
    hint_attr_span,
    is_jsx_attribute,
)

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
        # `.next` is listed, but the VERIFICATION build writes `.next-verify`
        # (scripts/build-check.mjs, via NEXT_DIST_DIR) and Next generates
        # hundreds of route `.ts` files under it. Unskipped, the scan counted
        # them: the same command reported 1371 files with a verify build on
        # disk and 1118 without, which is a scan size you cannot quote. Match
        # the whole family by prefix rather than adding one more literal, since
        # the dist dir is deliberately overridable.
        if any(part in SKIP_DIRS or part.startswith(".next") for part in path.parts):
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
    # A SIZED field, not merely a `<Field>`. An unsized one outside a track is the
    # documented way to use `IdentityRow`, which owns its own track widths and
    # says so ("wrap the children in plain <div>s, or <Field> without a size" --
    # section-grid.tsx). Flagging those made a screen that had correctly moved its
    # header onto an IdentityRow look like a regression, and the message already
    # said "<Field size>" -- it just was not testing for one.
    has_field = any(
        "size=" in _jsx_open_tag(code, m.start()) for m in re.finditer(r"<Field\b", code)
    )
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


CAPS_EXEMPT = re.compile(r"caps-input:\s*exempt\b[^\n]*\S", re.I)


def check_caps_input(path: Path, code: str, slug: str):
    """Field values are stored in CAPITALS (client 2026-07-23).

    THIS CHECK ASKS THE INVERSE QUESTION SINCE 2026-08-18, because the primitive
    changed under it. `uppercase` used to be opt-IN, so the question worth asking
    was "which field forgot it" -- and the answer had to be scoped to
    `components/masters/`, because repo-wide it fired on hundreds of legitimate
    numeric, date and id fields and would have been ignored.

    That scope was doing real harm by the end: it reported a clean pass over the
    ONE directory that was already correct, while 873 of 968 `<Input>` under
    `app/(app)` typed in lower case. A check that inspects only the compliant
    corner is not passing, it is blind -- and the two read identically.

    Now that `Input` / `Textarea` capitalise BY DEFAULT (`capsByDefault` in
    components/ui/input.tsx), forgetting is impossible and the remaining risk is
    the opposite one: a call site that opts OUT silently. So this flags a bare
    `uppercase={false}` carrying no reason, and it runs REPO-WIDE, because an
    unexplained opt-out is equally wrong wherever it sits.

    The exemption is a `caps-input: exempt -- <reason>` comment in the few lines
    above the tag -- the convention `cascade-filter`, `truncate-reveal` and
    `toolbar-size` already use. The reason is the whole point: opting out is
    legitimate for a URL (case-sensitive path), an email, a uuid, a search query
    and LC/PO terms, and each of those is a sentence someone should have to write
    rather than a pattern this script can infer.
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    # THE REASON LIVES IN A COMMENT, AND `code` HAS NO COMMENTS -- every check is
    # handed comment-stripped source, so an exemption has to be read off the RAW
    # file and matched by LINE. This is `truncate-reveal`'s exact shape (and
    # `autofill`'s, and `created-by`'s). Written any other way, the check flags
    # precisely the opt-outs that do carry their reason -- which is how the first
    # cut of it behaved, reporting 23 findings that were all correctly annotated.
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in CAPS_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)
    for m in re.finditer(r"<(?:Input|Textarea)\b", code):
        tag = _jsx_open_tag(code, m.start())
        if not re.search(r"uppercase=\{\s*false\s*\}", tag):
            continue
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        yield Finding(
            "caps-input", path, line,
            "opts out of CAPITALS with no reason; add a "
            "`caps-input: exempt -- <reason>` comment above it",
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
#   ma-item-class    (material-attribute) the rest of the form is read off the
#                    chosen class -- its attribute values and its code -- and
#                    the list is pre-filtered to accessory classes, which a
#                    picker's "+ Add" would quietly widen.
#
# All four are Item Class or a class-like parent, which is the pattern rather
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
    if slug in PRIMITIVES or slug == "components/ui/filter-bar.tsx":
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


# Row builders that legitimately carry no disable flag, keyed
# "<file slug>#<variable>" so an exemption cannot quietly spread to the next
# list in the same file. Each says WHY -- an unexplained exemption is how the
# layout contract drifted before this script existed.
#
# Two reasons qualify, and only two:
#   * the source table has no disable column at all, or
#   * the picker FILTERS a list rather than SETTING a stored value -- narrowing
#     a search to a since-retired buyer is a legitimate thing to want, and the
#     rule is about fields that write.
FLAGLESS_PICKERS = {
    # `sales_orders` is a document with a status, not a master with a flag. The
    # same list, under four names, on four screens.
    "app/(app)/orders/advised-items/page.tsx#orderItems": "sales_orders: document",
    "app/(app)/orders/garment-processes/page.tsx#pickerItems": "sales_orders: document",
    "app/(app)/orders/_garment-order/garment-order-screen.tsx#orderItems": "sales_orders: document",
    "app/(app)/orders/packing-advice/packing-advice-screen.tsx#orderItems": "sales_orders: document",
    # `color_card_colors` is a child of a colour card -- no flag of its own.
    "app/(app)/orders/_garment-order/garment-order-screen.tsx#dyeColorItems": "color_card_colors: no flag",
    # Not a master at all: the Style(s) TAB'S OWN ROWS, offered to the Prices tab
    # so a price names a line of this PO. They are grid rows the operator typed a
    # moment ago -- there is no stored row to switch off.
    "app/(app)/orders/_garment-order/garment-order-screen.tsx#styleLineItems": "the document's own grid rows",
    # Filter, not a field: this picker narrows the order list on a landing page,
    # and `getBuyers()` already filters inactive buyers server-side.
    "app/(app)/orders/advised-items/page.tsx#customerItems": "filter, not a field",
    # `attribute_values` is a CHILD of the Attribute row; the parent is what
    # gets switched off.
    "components/masters/lookup-picker.tsx#rows": "attribute_values: no flag",
    # `public.currencies` (0004) is code / name / symbol -- an ISO currency is
    # retired by deleting the row, there is nothing to flag.
    "components/masters/currency-picker.tsx#rows": "currencies: no flag",
}

# The two shapes a picker's option rows arrive in. Anything typed as one of
# these must carry the flag; `PickerItem` accepts all three spellings via
# `Deactivatable`, so passing the raw service row is the normal answer.
PICKER_ROW_DECL = re.compile(
    r"\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*:\s*(?:PickerRow|PickerItem)\[\]"
)
# The flag, in any spelling the schema uses, or the shared reader.
INACTIVE_KEY = re.compile(r"\b(?:inactive|is_active|blocked|isInactive)\b")


def check_picker_inactive(path: Path, code: str, slug: str):
    """AGENTS.md STANDING: a disabled row is not offered for selection.

    A master row switched off (`inactive` / `blocked` true, `is_active` false)
    must drop out of every field that PICKS a value. `DataPicker` enforces it --
    it hides a row flagged `inactive`, keeping only the one the record already
    holds -- but it can only hide what the adapter tells it about, and the
    adapter can only pass on what the service SELECTed. This check watches the
    handoff, which is the link that silently breaks: SBI stayed in the Bank
    dropdown for exactly this reason.

    Fires on a `PickerRow[]` / `PickerItem[]` list whose builder never mentions
    the flag in any of its three spellings. Deliberately shallow -- it cannot
    know whether the SOURCE has a disable column, so `FLAGLESS_PICKERS` carries
    the ones that genuinely do not, each naming its table.

    Not a `<Select>` check: `stored-select` already says a stored-data field
    should not be a `<Select>` at all, and duplicating the rule here would put
    two findings on one line.
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    for m in PICKER_ROW_DECL.finditer(code):
        if f"{slug}#{m.group(1)}" in FLAGLESS_PICKERS:
            continue
        # The builder runs from the declaration to the end of its initializer.
        # `useMemo(...)` and a bare `.map(...)` both terminate at the first
        # `;` that is not inside the expression -- close enough, and a false
        # NEGATIVE here is safer than a false positive on a 900-line screen.
        end = code.find(";", m.end())
        body = code[m.end(): end if end != -1 else len(code)]
        if ".map(" not in body:
            continue  # a prop declaration, not a builder -- the producer is checked
        if INACTIVE_KEY.search(body):
            continue
        yield Finding(
            "picker-inactive", path, line_of(code, m.start()),
            "picker rows built without the disable flag; a switched-off row "
            "stays selectable. Pass `inactive: isInactive(row)` (or hand "
            "RecordPicker the raw row) -- AGENTS.md, 'Disabled rows'",
        )


# Any of the live duplicate check's forms counts as wired: the descriptor field
# (`SimpleMasterScreen`), one of the two hooks (every other shell), or a bare
# `dupFieldProps` call. That last one is not a loophole -- `dupFieldProps` is the
# ONLY thing allowed to emit `data-dup-error` (see below), so a screen calling it
# is by definition showing a live duplicate. It is how a duplicate that lives in
# a CHILD GRID is reported, where the candidates are all already on screen and
# there is no table to ask (attribute-master-screen.tsx: two identical attribute
# values under one item class).
DUP_WIRED = re.compile(r"\b(?:useDuplicateCheck|useDuplicateName|dupCheck|dupFieldProps)\b")
# An opt-out, written in the screen it applies to and required to say why.
# Matched against RAW text -- it is a comment, which `code` has blanked out.
DUP_EXEMPT = re.compile(r"dup-check:\s*exempt\b[^\n]*\S", re.I)


def check_dup_check(path: Path, code: str, slug: str):
    """AGENTS.md STANDING: a master says "already exists" WHILE the operator types.

    Every masters child either runs a live duplicate check on the column that is
    its identity, or carries a written exemption. Without one, a second copy of a
    record saves silently -- which is how 50 of 92 screens shipped, and how the
    auto-code masters accepted duplicate names for months (the on-save guard sat
    in the `else` of `if (!code) generateUniqueCode(...)`, and those forms have no
    code box, so it never ran).

    Exempt with a comment naming the reason, e.g.

        // dup-check: exempt -- rate card keyed by (item, effective_from); a
        // second row on a LATER date is how a revision is entered.

    Genuinely exempt: dated / versioned documents (rate cards, levies, work
    timings, holidays), auto-numbered entry docs, and any master whose identity
    is a combination rather than one column. `employees` is exempt ON NAME
    specifically -- two workers legitimately share a name, and a duplicate error
    HOLDS THE CURSOR, so checking it would cage the operator on a correct value.

    Also flags a hand-written `data-dup-error`. That attribute is what the
    keyboard hold reads, and `dupFieldProps()` is the only thing allowed to emit
    it -- spelling it by hand skips the paired `aria-describedby` and can pin the
    cursor with no message on screen saying why.
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    if "components/masters/" not in slug:
        return

    for m in re.finditer(r'data-dup-error\s*=', code):
        yield Finding(
            "dup-check", path, code[: m.start()].count("\n") + 1,
            "hand-written `data-dup-error` -- emit it via dupFieldProps(error, id) "
            "so the message and the keyboard hold stay paired",
        )

    if not slug.endswith("-master-screen.tsx"):
        return
    if DUP_WIRED.search(code):
        return
    # The exemption is a comment, so it survives only in the raw file.
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    if DUP_EXEMPT.search(raw):
        return
    yield Finding(
        "dup-check", path, 1,
        "no live duplicate check -- wire useDuplicateName (or the SimpleMaster "
        "`dupCheck` descriptor) on this master's identity column, or add a "
        "`// dup-check: exempt -- <reason>` comment",
    )


# The near-miss half of the same rule. `spellSuggest` is the SimpleMaster
# descriptor key; `useSpellSuggest` is the hook every other shell calls.
SUGGEST_WIRED = re.compile(r"\b(?:useSpellSuggest|spellSuggest)\b")
SUGGEST_EXEMPT = re.compile(r"spell-suggest:\s*exempt\b[^\n]*\S", re.I)


def check_spell_suggest(path: Path, code: str, slug: str):
    """AGENTS.md STANDING: a near-miss is offered, not just an exact collision.

    The duplicate check fires only on an EXACT match, so TUTICORN typed beside an
    existing TUTICORIN sails past it and becomes a second master meaning the same
    thing -- and every record pointing at either one is now split across the two.
    A master that runs a duplicate check therefore also offers the close names it
    knows: `useSpellSuggest` + <SpellSuggestHint>, or `spellSuggest` on a
    SimpleMaster descriptor.

    Only screens that already have a duplicate check are flagged. The chip
    attaches to the field the check guards, so without one there is nothing to
    attach to, and the dup-check rule above is the finding that matters.

    Exempt with a comment naming the reason, e.g.

        // spell-suggest: exempt -- the guarded field is an account number; a
        // digit string has no spelling, so every chip is a different real
        // account offered beside the one being typed.

    Genuinely exempt: a field holding an ID or code rather than a name (employee
    ID, account number, leave-type code), a <Textarea>, where the strip would
    claim the ArrowDown and Enter that mean "next line" and "new line", and a
    name the SYSTEM composes (material-master-screen.tsx gates the hook on
    `nameIsComposed` instead -- correcting the app's own output is not a typo fix).
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    if "components/masters/" not in slug or not slug.endswith("-master-screen.tsx"):
        return
    if not DUP_WIRED.search(code):
        return  # no duplicate check to hang a suggestion off -- dup-check covers it
    if SUGGEST_WIRED.search(code):
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    if SUGGEST_EXEMPT.search(raw):
        return
    yield Finding(
        "spell-suggest", path, 1,
        "duplicate check but no near-miss suggestion -- an EXACT-match check lets "
        "a one-character miss create a second master meaning the same thing; wire "
        "useSpellSuggest + <SpellSuggestHint> (or `spellSuggest` on the descriptor), "
        "or add a `// spell-suggest: exempt -- <reason>` comment",
    )


# The classes that hide text. A responsive prefix hides it just as well
# (`@2xl/editor:truncate`, `md:line-clamp-2`), so the prefix is optional rather
# than absent -- matching only the bare word misses the container-query form,
# which is exactly where a field gets narrow enough to clip.
TRUNCATING_CLASS = re.compile(
    r"""(?:^|[\s"'`])(?:[A-Za-z0-9@:\[\]/._-]+:)?(truncate|text-ellipsis|line-clamp-\d+)\b"""
)

# An opt-out written beside the line it applies to, required to say why.
# Matched against RAW text -- it is a comment, which `code` has blanked out.
TRUNCATE_EXEMPT = re.compile(r"truncate-reveal:\s*exempt\b[^\n]*\S", re.I)

# The primitives that OWN the reveal and must write `truncate` themselves.
TRUNCATE_OWNERS = {
    "components/ui/truncated.tsx",
    "components/ui/tooltip.tsx",
}

# Chrome, not data. Navigation, toolbars and search results truncate as a layout
# decision, and the full text is reached by opening the thing rather than by
# reading a bubble over it. Listed wholesale, each with its reason, rather than
# sprinkling the same exemption comment through them -- same rationale as
# FLAGLESS_PICKERS. A file here that starts rendering VALUES comes back off it.
CHROME_TRUNCATION = {
    "components/shell/mobile-nav.tsx": "nav labels, a fixed vocabulary",
    "components/shell/topbar.tsx": "toolbar chrome",
    "components/shell/notifications-bell.tsx": "previews; opening shows the whole thing",
    "components/search/search-palette.tsx": "results re-render on every keystroke",
    "components/dashboard/cards.tsx": "tile chrome",
    "components/dashboard/charts.tsx": "axis labels, already carry title=",
    "components/dashboard/lists.tsx": "dashboard tiles link to the record",
    "components/ui/sheet.tsx": "sheet chrome; the title comes from the caller",
}


def comment_only_lines(raw: str, code: str) -> list[bool]:
    """Per line (0-based), True when the line carries nothing but a comment.

    `strip_comments` blanks comments to spaces and preserves length, so the two
    texts agree line for line and a line that lost characters held a comment.
    Losing characters is not enough on its own, though: a JSX comment is
    `{/* ... */}` and the BRACES are code, so the first and last lines of one
    still hold `{` and `}` after stripping. Those count as comment-only; a line
    with anything else left does not.
    """
    out = []
    for r, c in zip(raw.split("\n"), code.split("\n")):
        out.append(c != r and c.strip(" \t{}") == "")
    return out


def exempt_above(exempt: set[int], commentish: list[bool], line: int) -> bool:
    """True when an exemption marker governs `line`.

    The marker may sit on the line itself (a trailing comment) or anywhere in
    the contiguous comment block immediately above it. Walk up while the lines
    are comment-only, stop at the first that carries code.

    Written as a walk rather than a fixed window because the first attempt
    capped it at three lines above, and the reason for one real exemption in
    `master-full-screen.tsx` ran to four -- so a correctly written opt-out
    silently did nothing. A window that quietly drops an exemption is worse
    than no exemption: it teaches people to write shorter reasons.
    """
    if line in exempt:
        return True
    n = line - 1
    while n >= 1 and commentish[n - 1]:  # list is 0-based, `line` is 1-based
        if n in exempt:
            return True
        n -= 1
    return False


def check_truncate_reveal(path: Path, code: str, slug: str):
    """LAYOUT.md §14: a clipped VALUE must still be readable.

    `truncate` on its own is a dead end -- the ellipsis says text is missing and
    nothing gets it back. `<Truncated>` (components/ui/truncated.tsx) measures
    the box and, ONLY when something is actually hidden, reveals the whole value
    on hover or press-and-hold.

    The worst case is the one with no ellipsis at all: an `<input>` has no
    `text-overflow` of its own, so a picker's selected value used to stop
    mid-word and read as the whole thing. That is why the pickers carry
    `text-ellipsis` as well as the bubble.

    Values only. Chrome lives in CHROME_TRUNCATION above; anything else opts out
    per line with a `truncate-reveal: exempt -- <reason>` comment, because the
    judgement is "is this a value" and only the file can answer it.
    """
    if not slug.endswith(".tsx"):
        return
    if slug in TRUNCATE_OWNERS or slug in CHROME_TRUNCATION:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in TRUNCATE_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)
    for m in TRUNCATING_CLASS.finditer(code):
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        yield Finding(
            "truncate-reveal", path, line,
            f"`{m.group(1)}` hides a value with no way to read it; render it "
            "through <Truncated> (components/ui/truncated.tsx), or add a "
            "`truncate-reveal: exempt -- <reason>` comment",
        )


# The five primitives OWN the opt-out, so they are the one place these
# attributes are written rather than inherited.
AUTOFILL_OWNERS = {
    "components/ui/input.tsx",
    "components/ui/textarea.tsx",
    "components/ui/select.tsx",
    "components/ui/data-picker.tsx",
    "components/ui/combobox.tsx",
}

# Input types that raise no suggestion list at all: a checkbox has nothing to
# remember, and a date/time control opens its own OS picker instead.
AUTOFILL_SAFE_TYPES = {
    "checkbox", "radio", "file", "hidden", "range", "color",
    "submit", "button", "image", "reset",
    "date", "time", "datetime-local", "month", "week",
}

# Lowercase = the raw DOM element. `<Input>` / `<Select>` are the primitives.
RAW_FIELD_TAG = re.compile(r"<(input|textarea|select)(?=[\s/>])")
TYPE_ATTR = re.compile(r"""\btype\s*=\s*["']([a-z-]+)["']""")
AUTOFILL_EXEMPT = re.compile(r"autofill:\s*exempt\s*--")


def _jsx_open_tag(code: str, start: int) -> str:
    """The full opening tag at `start`, brace- and string-aware.

    `>` occurs constantly inside attribute expressions (`onChange={(e) => ...}`),
    so the tag ends at the first `>` sitting at brace depth 0 outside a string.
    A naive search for the next `>` stops inside the first arrow function and
    reports every field as missing attributes that are three lines further down.
    """
    depth = 0
    quote = None
    i = start
    while i < len(code):
        c = code[i]
        if quote:
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0:
            return code[start:i + 1]
        i += 1
    return code[start:start + 500]


def check_autofill(path: Path, code: str, slug: str):
    """AGENTS.md "Browser autofill": a raw field must turn Chrome's list off.

    Chrome re-offers every value ever typed into a field as a plain white
    dropdown. Beside a field whose real options come from a master table that
    reads as a stored row and writes a value no master has; on a shared
    shop-floor machine it hands the previous operator's customer names and
    salary figures to the next one; and it EATS the ArrowDown the keyboard
    contract gives to the field's own list.

    `Input`, `Textarea`, `Select`, `DataPicker` and `Combobox` all set
    `autoComplete="off"` plus the `data-1p-ignore` / `data-lpignore` /
    `data-form-type` trio -- the password managers ignore `autocomplete` and
    read only their own opt-outs -- so a screen built on them is covered. A RAW
    lowercase `<input>` / `<textarea>` / `<select>` inherits none of it.

    `<select>` is here for a different reason than the text fields: it has no
    typing to remember, so there is no popup, but Chrome fills one from the
    saved address profile and quietly rewrites a State or Country nobody
    touched.

    Runs on comment-stripped source, which matters more here than for most
    checks: this codebase explains itself in prose, and half a dozen files
    contain the words "an <input> just shows them on one line".

    The one legitimate opt-in is a value belonging to the person rather than the
    business -- the login screen's email / current-password, so password
    managers still work. Mark those `autofill: exempt -- <reason>`.
    """
    if slug in AUTOFILL_OWNERS:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in AUTOFILL_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)
    for m in RAW_FIELD_TAG.finditer(code):
        name = m.group(1)
        tag = _jsx_open_tag(code, m.start())
        if name == "input":
            t = TYPE_ATTR.search(tag)
            if t and t.group(1).lower() in AUTOFILL_SAFE_TYPES:
                continue
        if "autoComplete" in tag:
            continue
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        fix = "the <Select> primitive" if name == "select" else "the <Input> / <Textarea> primitive"
        spread = " (it spreads props -- check the caller)" if "{..." in tag else ""
        yield Finding(
            "autofill", path, line,
            f"raw <{name}> leaves Chrome's autofill on{spread}; use {fix}, or set "
            "autoComplete=\"off\" plus data-1p-ignore / data-lpignore / "
            "data-form-type, or add an `autofill: exempt -- <reason>` comment",
        )


# A table whose rows are LINES OF A DOCUMENT rather than records in their own
# right. A PO line does not have its own creator worth a column -- the document
# above it does, and the detail page already shows that. Matched on the path
# because that is what actually distinguishes them: a `[id]` segment means the
# page is about one record, so every table on it is that record's parts.
LINE_TABLE_PATH = re.compile(r"/\[[A-Za-z]+\]/|[/-]tabs\.tsx$|/sections/|report-view|ioc-costing")


def check_created_columns(path: Path, code: str, slug: str):
    """LAYOUT.md: a record listing shows Created Date + Created User, one way.

    Six screens grew their own before `components/ui/created-columns.tsx`
    existed and no two agreed -- "Created Dt" vs "Created Date" vs plain
    "Created", `created_by_name` vs raw `created_by` vs `creator.full_name`,
    `fmtDate` on five and `fmtDateTime` on the sixth, and one that put the User
    BEFORE the Date. Four printed `{r.created_by}`, i.e. a 36-character uuid, at
    an operator.

    `MasterListShell` and `SimpleMasterScreen` splice the pair in for the screens
    built on them. A screen that renders a raw `<DataTable>` has to ask, and the
    ask is one call: `columns={withCreatedColumns(columns, rows)}`. It is safe
    everywhere -- `hasCreatedInfo` returns false when the rows carry no
    `created_at`, so a list whose service does not select it is unchanged rather
    than growing a column of dashes.

    Two findings:

      1. a raw <DataTable> on a record listing with no withCreatedColumns
      2. a hand-rolled Created column -- it will be STRIPPED by the splice, so
         this is how a vanished column is diagnosed in seconds

    Line-item tables inside a document detail page are out of scope by path.

    THE PAIR HAS THREE RENDERINGS, NOT ONE. AGENTS.md names them together --
    `withCreatedColumns` (desktop table), `createdMeta` (card) and
    `createdSection` (RecordViewSheet) -- as one declaration shown three ways. So
    a listing rendered as CARDS satisfies this rule through `createdMeta`, and
    demanding the table helper of it would be demanding a table.

    That is not hypothetical: Orders > Material BOM replaced its queue table with
    a `MobileCardList` grid (2026-08-17) and carries the pair on each card. The
    check fired anyway -- because it is FILE-level, the file's other, unrelated
    `<DataTable>` (the Requirement tab, exploded line items inside an editor tab
    panel) became the first match once the table helper left the file. Widening
    the guard keeps the granularity the check already had rather than inventing a
    per-table one it has never claimed.
    """
    if slug in PRIMITIVES or "created-columns" in slug:
        return
    for m in re.finditer(r'header:\s*"[Cc]reated[^"]*"', code):
        if "withCreatedColumns" in code:
            continue
        yield Finding(
            "created-columns", path, line_of(code, m.start()),
            "hand-rolled Created column; the wording is settled in "
            "components/ui/created-columns.tsx -- use withCreatedColumns(columns, rows)",
        )
    if LINE_TABLE_PATH.search(slug) or any(
        h in code for h in ("withCreatedColumns", "createdMeta", "createdSection")
    ):
        return
    m = re.search(r"<DataTable\b", code)
    if m:
        yield Finding(
            "created-columns", path, line_of(code, m.start()),
            "record listing with no Created Date / Created User; wrap the columns "
            "in withCreatedColumns(columns, rows) -- it self-hides when the rows "
            "carry no created_at",
        )


# --------------------------------------------------------------------------
# created-by-data
# --------------------------------------------------------------------------

# An exported service function, and the whole of its body up to the next
# top-level `export` (services in this repo are flat modules of them).
SERVICE_FN = re.compile(r"^export (?:async )?function (\w+)", re.M)

# A `.select("...")` argument, string literals only -- a `+`-joined embed list
# still matches piece by piece, which is all this needs.
SELECT_ARG = re.compile(r"\.select\(\s*((?:\s*\"[^\"]*\"\s*\+?)+)", re.S)

CREATED_BY_EXEMPT = re.compile(r"created-by:\s*exempt\b")


def check_created_by_data(path: Path, code: str, slug: str):
    """AGENTS.md: the Created pair needs a DATA half, and it is `withCreators()`.

    The column half is `withCreatedColumns` and is checked above. It renders
    `creatorName(row)`, which REFUSES to print anything uuid-shaped -- so a
    listing whose service hands back a raw `created_by` uuid shows a column of
    dashes. Not a missing column, not an error: the right column, wired up, with
    nothing in it. That is exactly how it was reported (client 2026-08-05), and
    why the column check passing means nothing on its own.

    `withCreators()` (lib/created-by.ts) resolves the uuids through
    `creator_names()` in one round trip. It is not a PostgREST embed on purpose
    -- `profiles_read_own` resolves an embed to null for every record made by
    anyone else -- and it costs nothing when there is nothing to resolve: no
    uuid-shaped `created_by` in the rows means no query at all.

    Two findings, and the second is the one that hides:

      1. a list function that fetches `created_at` and never resolves the name;
      2. a HAND-WRITTEN select that names `created_at` but not `created_by`.
         `withCreators` can only resolve a column the query actually fetched, so
         the call is there, the code reads as correct, and the cell is a dash.
         Five services were in that state -- Material HSN, Process HSN, TCS,
         Customer GST and the sales registers.

    Scoped to `list*` functions in a server service. A `get*` that returns one
    record has no array to resolve, and a line-item fetcher has no creator worth
    showing (the document above it does). Opt out per function with a
    `created-by: exempt -- <reason>` comment.
    """
    if not slug.startswith("lib/") or not slug.endswith(".ts"):
        return
    if "created-by.ts" in slug or "@/lib/supabase/server" not in code:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in CREATED_BY_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)

    bounds = [m.start() for m in SERVICE_FN.finditer(code)] + [len(code)]
    for i, m in enumerate(SERVICE_FN.finditer(code)):
        name = m.group(1)
        if not name.startswith("list"):
            continue
        body = code[bounds[i]:bounds[i + 1]]
        if ".from(" not in body:
            continue
        selects = " ".join(s.group(1) for s in SELECT_ARG.finditer(body))
        star = '"*' in selects.replace(" ", "")
        if not star and "created_at" not in selects:
            continue  # the rows carry no creation info; the pair self-hides
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        if not star and "created_by" not in selects:
            yield Finding(
                "created-by-data", path, line,
                f"{name}() selects created_at but not created_by, so the Created "
                "User column is a run of dashes -- withCreators() can only "
                "resolve a uuid the query fetched",
            )
        elif "withCreators(" not in body:
            yield Finding(
                "created-by-data", path, line,
                f"{name}() returns rows with created_at and no resolved creator; "
                "wrap the return in withCreators() (lib/created-by.ts) or add a "
                "`created-by: exempt -- <reason>` comment",
            )


# --------------------------------------------------------------------------
# required-hold
# --------------------------------------------------------------------------

# A JSX `required` prop: bare, or `required={expr}`. Not `required?:` (a type
# declaration) and not `.required` (a property read).
REQUIRED_PROP = re.compile(r"(?<![\w.?])required(?:=\{|\s|>|/>|$)", re.M)

# `export const fooInput = z.object({` -- the write-side schema every master
# parses its form through.
# `\s*` between `z` and `.object(` — a schema long enough to need `.superRefine()`
# is written `= z\n  .object({`, and matching only the one-line form reported
# Vendor as demanding nothing while `vendor-types.ts:236` requires `name`. A check
# that reports silence as health is worse than one that reports nothing at all.
ZOD_INPUT = re.compile(r"\b(?:export\s+)?const\s+(\w*Input)\s*=\s*z\s*\.object\(\{")

# A screen's own types module, e.g. `@/lib/masters/levy-types`.
TYPES_IMPORT = re.compile(r"""from\s+["']@/lib/masters/([a-z0-9-]+)-types["']""")

# Anything that makes a Zod entry non-mandatory.
OPTIONAL_MARK = re.compile(r"\.(optional|nullable|default)\s*\(")


def _brace_block(text: str, open_index: int) -> str:
    """The contents of the `{` at `open_index`, balanced."""
    depth = 0
    for i in range(open_index, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[open_index + 1:i]
    return text[open_index + 1:]


def _top_level_entries(body: str) -> list[tuple[str, str]]:
    """`key: expr` pairs at depth 0 of a z.object body, in order."""
    out: list[tuple[str, str]] = []
    depth = 0
    quote: str | None = None
    key: str | None = None
    start = 0
    i = 0
    while i < len(body):
        c = body[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif depth == 0 and c == ":" and key is None:
            j = i - 1
            while j >= 0 and (body[j].isalnum() or body[j] in "_$ \n\t"):
                j -= 1
            key = body[j + 1:i].strip()
            start = i + 1
        elif depth == 0 and c == "," and key is not None:
            out.append((key, body[start:i]))
            key = None
        i += 1
    if key is not None:
        out.append((key, body[start:]))
    return [(k, v) for k, v in out if k and k.isidentifier()]


def _format_helpers(root: Path) -> dict[str, bool]:
    """`lib/validation/formats.ts` helper name → is it optional?

    These schemas do not spell Zod out in full. A column reads `capsName()` or
    `nullableKind("ifsc")`, and the answer to "is this mandatory" lives in the
    helper's BODY, one file away. Reading only the schema file made every helper
    look mandatory, which reported Our Bank's SWIFT and IFSC as required when
    `nullableKind` says the opposite in its own name — a false positive that would
    have had the sweep cage the operator on two optional fields.
    """
    path = root / "lib" / "validation" / "formats.ts"
    try:
        code = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return {}
    out: dict[str, bool] = {}
    for m in re.finditer(r"\bexport\s+function\s+(\w+)\s*\(", code):
        brace = code.find("{", m.end())
        if brace == -1:
            continue
        out[m.group(1)] = bool(OPTIONAL_MARK.search(_brace_block(code, brace)))
    return out


def _mandatory_fields(types_code: str, helpers: dict[str, bool], stem: str) -> list[str]:
    """Field names the write-side schema insists on.

    Mandatory = the entry carries no `.optional()`, `.nullable()` or `.default()`.
    Single-token aliases (`pct`, `acHead`) are resolved against `const` bindings in
    the same file, which is how these schemas keep their rate columns short; helper
    CALLS are resolved against `formats.ts` (see `_format_helpers`).

    An unresolvable helper is treated as OPTIONAL. A false positive here would put
    a hold on a field the operator does not have to fill — a cage — while a false
    negative only leaves the status quo.
    """
    aliases: dict[str, str] = {}
    for m in re.finditer(r"\bconst\s+(\w+)\s*=\s*(z\.[^;]+);", types_code):
        aliases[m.group(1)] = m.group(2)

    # THE RECORD'S schema, not the first one in the file. A types module often
    # declares its CHILD schemas above the record's — department-types.ts has
    # `departmentLocationDivisionInput` and `departmentLocationInput` before
    # `departmentInput` — so taking the first match reported a nested child's
    # `division_id` as the screen's mandatory field and missed `short_name`, the
    # one that actually is. Prefer the module's own name (`department-types.ts`
    # → `departmentInput`), and otherwise the richest schema in the file, which is
    # the record's: a child schema is a handful of columns, the record is not.
    best = None
    for m in ZOD_INPUT.finditer(types_code):
        body = _brace_block(types_code, types_code.index("{", m.end() - 1))
        entries = _top_level_entries(body)
        exact = m.group(1) == f"{stem}Input"
        if best is None or exact or (not best[0] and len(entries) > len(best[1])):
            best = (exact, entries)
            if exact:
                break
    if best is None:
        return []
    out = []
    for key, expr in best[1]:
        resolved = aliases.get(expr.strip(), expr).strip()
        call = re.match(r"(\w+)\s*\(", resolved)
        if call and not resolved.startswith("z."):
            if helpers.get(call.group(1), True):
                continue  # optional, or a helper we cannot read
            out.append(key)
            continue
        if OPTIONAL_MARK.search(resolved):
            continue
        out.append(key)
    return out


def check_required_hold(path: Path, code: str, slug: str):
    """A mandatory field must DECLARE itself, or the cursor never holds on it.

    `data-required-empty` (client 2026-08-04) holds Tab / Enter / the arrows on a
    blank mandatory field, the same way `data-dup-error` does for a duplicate. The
    engine is global -- one window-capture listener, and `useRequiredHold()` is
    called by all five control primitives -- so a field participates purely by
    being declared `required`, which is the same prop that draws its `*`.

    Undeclared, the hold can never fire: the operator tabs past a blank mandatory
    field and meets the problem as a server error at Save instead. 30 of 58 master
    screens were in that state when this check was written, which is what a rule
    with no audit looks like after a few weeks.

    The write-side Zod schema is the source of truth, not a list kept here -- it
    is what `lib/data-io` and the server action already validate against, so a
    field it insists on is mandatory by definition and the two cannot drift.

    TWO SIGNALS, deliberately different in confidence:

      * a screen with mandatory fields and NO `required` anywhere -- unambiguous,
        and it names the fields so the fix is mechanical;
      * a screen declaring FEWER than its schema requires -- a candidate only. One
        `<Field required>` can legitimately cover a group, and a screen may not
        render every column of its schema. Read it before changing it.

    Exempt by construction and needing no comment: `readOnly` / composed fields
    (`Input readOnly` opts out of the hold itself -- a field the operator cannot
    type into is a cage with no exit), and a trailing star row in a grid, which is
    blank by design.

    A screen whose mandatory field HAS NO FIELD opts out per file with a
    `required-hold: exempt -- <reason>` comment. Two real shapes: a value the
    screen DERIVES rather than asks for (Department composes `short_name` from the
    name, and its own comment says pointing an error at it "would name a column the
    form never shows"), and one supplied by the ROUTE rather than the operator
    (Exchange Rate backs three register children and each passes its own
    `register`). Neither can hold a cursor, because neither is on screen.
    """
    if slug in PRIMITIVES or not slug.endswith("-master-screen.tsx"):
        return
    # From the RAW file: `code` has been comment-stripped, so the opt-out would be
    # invisible in it — the same reason check_truncate_reveal re-reads the source.
    try:
        if re.search(r"required-hold:\s*exempt\s*--", path.read_text(encoding="utf-8", errors="replace")):
            return
    except OSError:
        pass
    if not is_editor_screen(code):
        return

    m = TYPES_IMPORT.search(code)
    if not m:
        return
    types_path = path.parent.parent.parent / "lib" / "masters" / f"{m.group(1)}-types.ts"
    if not types_path.is_file():
        return
    try:
        types_code = strip_comments(types_path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return

    # `defect-detail` → `defectDetail`, so `defectDetailInput` can be matched by name.
    stem = re.sub(r"-(\w)", lambda k: k.group(1).upper(), m.group(1))
    fields = _mandatory_fields(types_code, _format_helpers(path.parent.parent.parent), stem)
    if not fields:
        return

    declared = len(REQUIRED_PROP.findall(code))
    if declared == 0:
        yield Finding(
            "required-hold", path, 1,
            f"{len(fields)} mandatory field(s) in {m.group(1)}-types.ts "
            f"({', '.join(fields[:6])}{'…' if len(fields) > 6 else ''}) and no "
            "`required` on this screen -- a blank one will not hold the cursor",
        )
    elif declared < len(fields):
        yield Finding(
            "required-hold", path, 1,
            f"declares {declared} `required` against {len(fields)} mandatory "
            f"field(s) in {m.group(1)}-types.ts -- check which are missing",
        )


# The header row's own components: every `<Button>` in them is a header-row
# button, so the whole FILE is the span. They are not exempt -- they are where
# the bug was. `data-io-toolbar.tsx` hardcoding `size="sm"` is what put a short
# Download beside a tall Add on 28 screens, and a check that skipped the
# declaring file would have passed happily throughout.
TOOLBAR_OWNERS = {
    "components/data-io/data-io-toolbar.tsx",
    "components/ui/filter-bar.tsx",
}

TOOLBAR_EXEMPT = re.compile(r"toolbar-size:\s*exempt\s*--")
BUTTON_TAG = re.compile(r"<Button(?=[\s/>])")
SIZE_ATTR = re.compile(r"""\bsize\s*=\s*["'](\w+)["']""")
# A height baked into the call site's className -- `h-7`, `h-9`. `h-full` and
# `h-auto` are not heights on this scale and do not match.
CLASS_HEIGHT = re.compile(r"""\bclassName\s*=\s*["'][^"']*\bh-(\d+)""")


def _header_row_spans(code: str) -> list[tuple[int, int]]:
    """Character spans of the file's header rows.

    Two shapes are recognised, and both are unambiguous:

      1. the innermost `<div>` around a `<DataIoToolbar>` -- that div IS the
         header row, by construction: the toolbar is never nested anywhere else;
      2. a `PageHeader` `actions={...}` expression.

    Deliberately NOT recognised: a bare `<div className="flex justify-end">`
    holding a single button. That shape is a header row on `accounts-client.tsx`
    and a form footer three files away, and nothing in the source separates
    them -- so it is left to the eye rather than guessed at here. Adding a third
    predicate is the way to widen this; widening rule 1 or 2 is not.
    """
    spans: list[tuple[int, int]] = []

    for m in re.finditer(r"<DataIoToolbar(?=[\s/>])", code):
        stack: list[int] = []
        best: tuple[int, int] | None = None
        for d in re.finditer(r"</?div\b", code):
            if d.group(0) == "<div":
                stack.append(d.start())
            elif stack:
                start = stack.pop()
                end = d.end()
                # Innermost enclosing div wins -- the later it opens, the tighter.
                if start < m.start() < end and (best is None or start > best[0]):
                    best = (start, end)
        if best:
            spans.append(best)

    for m in re.finditer(r"\bactions\s*=\s*\{", code):
        depth = 0
        for i in range(m.end() - 1, len(code)):
            if code[i] == "{":
                depth += 1
            elif code[i] == "}":
                depth -= 1
                if depth == 0:
                    spans.append((m.start(), i + 1))
                    break

    return spans


def check_toolbar_size(path: Path, code: str, slug: str):
    """LAYOUT.md §10 "The header row": one size across the row, and it is `md`.

    The row's fixed element is the search `Input` at `h-9`, so a `size="sm"`
    button beside it is 4px short, a font size down and 2px tighter on its icon
    gap. That is how `Download` (sm, inside DataIoToolbar) came to sit next to
    `+ Add Category` (md) on 28 list screens (client 2026-08-05).

    A height in the call site's `className` is the same bug wearing a fix:
    `size="sm" className="h-9"` matched the row's height and nothing else, which
    is why FilterBar's Filters button looked deliberate and read wrong. Same
    shape as --check text-size-noop, one property along.

    Scoped to header rows only (see `_header_row_spans`). A `+ Add line` inside a
    ChildGrid is `sm` on purpose and must stay -- `sm` is already the compact
    size, which is why grid rows never showed this. Contextual bars that are not
    the header row (bulk-selection, report toolbar) opt out per line with a
    `toolbar-size: exempt -- <reason>` comment.
    """
    if not slug.endswith(".tsx"):
        return
    spans = [(0, len(code))] if slug in TOOLBAR_OWNERS else _header_row_spans(code)
    if not spans:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in TOOLBAR_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)

    for m in BUTTON_TAG.finditer(code):
        if not any(s <= m.start() < e for s, e in spans):
            continue
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        tag = _jsx_open_tag(code, m.start())
        size = SIZE_ATTR.search(tag)
        height = CLASS_HEIGHT.search(tag)
        if height:
            yield Finding(
                "toolbar-size", path, line,
                f"`h-{height.group(1)}` in className on a header-row Button; the "
                "height belongs to `size=`, not the call site",
            )
        elif size and size.group(1) != "md":
            yield Finding(
                "toolbar-size", path, line,
                f'header-row Button is `size="{size.group(1)}"`; the row is '
                '`md` (LAYOUT.md §10) so it lines up with the search Input and '
                "the Add button beside it",
            )


# The files that legitimately GENERATE a required marker. Everywhere else, a
# `*` beside a label is written by hand and means nothing.
STAR_OWNERS = {
    "components/ui/field.tsx",            # `Field` draws it from `required`
    "components/ui/data-picker.tsx",      # draws its OWN label; same `required`
                                          # prop feeds `useRequiredHold` (:292)
    "components/masters/child-grid.tsx",  # a column's `required` header star
    "components/masters/simple-master-screen.tsx",
}
# Verified complete: `grep -rn "required && <span"` over components/ and lib/
# returns exactly six sites, all inside these four files. Every other star in
# the repo is typed by hand.

# `<span className="text-danger">*</span>` and friends, and a bare `*` sitting
# inside a <Label>. Both are the same defect wearing two spellings.
HAND_STAR = re.compile(r"""<span[^>]*className=["'][^"']*text-danger[^"']*["'][^>]*>\s*\*\s*</span>""")
LABEL_STAR = re.compile(r"""<Label\b[^>]*>[^<]*?\*""")
STAR_EXEMPT = re.compile(r"required-star:\s*exempt\s*--")


def check_required_star(path: Path, code: str, slug: str):
    """AGENTS.md "Mandatory fields": the `*` is DERIVED, never typed.

    `required` is stated once -- `<Field required>`, a picker's own `required`
    prop, or `ChildGridColumn.required` -- and from that one prop come the red
    star AND the `data-required-empty` marker that holds the cursor
    (`useRequiredHold`, components/ui/field.tsx).

    A hand-written star is therefore decoration with nothing behind it: the box
    looks mandatory and lets Tab, Enter and the arrows straight past. That is
    not a hypothetical. On 2026-08-10 a blank Name in the Category quick-create
    sheet -- reached from Material > New Yarn > Category > "+ Add" -- moved on
    freely, and so did the inline "+ Add" of EVERY picker in the app, because
    `data-picker.tsx` carried the same shape and ~160 call sites inherit it.

    This is the counterpart to `required-hold`, and it exists because that check
    cannot see these files: it is gated on `*-master-screen.tsx`, on
    `is_editor_screen`, and on a resolvable `lib/masters/<x>-types.ts`, which
    leaves 38 of the 243 files that render an editable control. This one asks a
    question every file can answer.

    A star that is genuinely not a requiredness marker opts out per line with a
    `required-star: exempt -- <reason>` comment.
    """
    if not slug.endswith(".tsx") or slug in STAR_OWNERS:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in STAR_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)

    seen: set[int] = set()
    for pattern, what in ((HAND_STAR, "a hand-written `*`"),
                          (LABEL_STAR, "a `*` typed into a <Label>")):
        for m in pattern.finditer(code):
            line = line_of(code, m.start())
            if line in seen or exempt_above(exempt, commentish, line):
                continue
            seen.add(line)
            yield Finding(
                "required-star", path, line,
                f"{what} -- the star is drawn by `<Field required>` (or a "
                "picker's `required` prop), which ALSO holds the cursor on a "
                "blank field. Typed by hand it is decoration and the field "
                "will not hold. Wrap the control in `<Field label=... required>` "
                "and delete the `*`, or add a `required-star: exempt -- <reason>` "
                "comment",
            )


# A filter facet that HOLDS an item class. All four spellings in the repo: the
# `useMasterFilter` bag (`filterValues.itemClass`), a screen-local `useState`
# (`fClass` / `setFClass`), a plain GET form's field name, and the setter call.
# Deliberately NOT `item_class_id` on its own -- that is the row COLUMN, and
# matching it would fire on every editor and every service in the repo.
CLASS_FACET = re.compile(
    r"""filterValues\.itemClass
      | \bset?FClass\b
      | \bsetFilter\(\s*["']itemClass["']
      | name\s*=\s*["']itemClass["']""",
    re.X,
)

# Mapping the RAW category list into options. The receiver is what matters:
# `categories.map` / `options.categories.map` is the full list, while the fixed
# screens map a DERIVED name (`filterCategories`, `categoryOptions`,
# `scopedCategories`) that the narrowing already produced. Anchored on `{` so it
# only sees a JSX option list, not a `useMemo` body building the derived list --
# that one legitimately maps the raw array, and is the fix, not the bug.
RAW_CAT_OPTIONS = re.compile(r"\{\s*(?:[\w.]+\.)?categories\.map\(")

CASCADE_EXEMPT = re.compile(r"cascade-filter:\s*exempt\b[^\n]*\S", re.I)


def check_cascade_filter(path: Path, code: str, slug: str):
    """AGENTS.md STANDING: a filter facet cascades off the facet beside it.

    A Category filter that lists every category in the business while an Item
    Class facet sits next to it offers pairs that CANNOT match a row -- the two
    row-level tests are independent `&&`s, so picking a Yarn category under
    Item Class = FABRIC empties the table with nothing on screen to say why.

    This is the filter-bar half of the `cascading-picker rule` the form fields
    have obeyed since 0223. The form half was never the problem; the filter half
    had no written home and nothing checking it, and duly reached three screens
    (client 2026-08-11): Material Attributes, HSN Assign to Materials, and the
    shared item-report filter bar behind three reports at once.

    Fires when a file declares an Item Class FACET and still maps the raw
    `categories` array into an option list. It cannot see whether the narrowing
    is correct, only whether the option list is the unscoped one -- which is
    exactly the shape all three bugs had.

    The reports case needed a DATA fix as well, and this check would not have
    caught that half on its own: `getItemReportFilterOptions()` selected
    `id, name`, so the client had nothing to scope BY. If a fix here means
    widening a select, the same lesson as `created-by-data` applies -- the
    column half passing says nothing about the data half.

    Exempt with a comment naming the reason, e.g.

        // cascade-filter: exempt -- the Category facet here is the vendor-type
        // flag, not a material category; there is no class to cascade off.
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    if not CLASS_FACET.search(code):
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    if CASCADE_EXEMPT.search(raw):
        return
    for m in RAW_CAT_OPTIONS.finditer(code):
        yield Finding(
            "cascade-filter", path, line_of(code, m.start()),
            "Category options mapped from the FULL list beside an Item Class "
            "facet -- narrow them to the selected class (and clear a held "
            "category that falls out of scope). AGENTS.md, 'Cascading filters'",
        )


REQUIRED_COLUMN = re.compile(r"required:\s*true")
MOBILE_ROW = re.compile(r"renderMobileRow\s*=\s*\{")
# `required` used as a JSX prop inside the hand-rolled row: bare (`<Input required`),
# assigned (`required={c.required}`), or the context wrapper itself.
BACKS_REQUIRED = re.compile(r"\brequired(?:\s*=\s*\{|\s*/?>|\s+)|RequiredScope")
GRID_MOBILE_EXEMPT = re.compile(r"grid-required-mobile:\s*exempt\b[^\n]*\S", re.I)


def _braced_body(code: str, open_idx: int, limit: int = 20000) -> str:
    """Source of the `{...}` expression starting at/after `open_idx`."""
    i = code.find("{", open_idx)
    if i == -1:
        return ""
    depth = 0
    for j in range(i, min(len(code), i + limit)):
        if code[j] == "{":
            depth += 1
        elif code[j] == "}":
            depth -= 1
            if depth == 0:
                return code[i:j]
    return code[i: i + limit]


def check_grid_required_mobile(path: Path, code: str, slug: str):
    """A `ChildGridColumn.required` that draws a star nothing holds.

    `ChildGrid`'s stacked-cards layout calls `renderMobileRow(row, i)` INSTEAD of
    the `columns.map(...)` that wraps each cell in `<RequiredScope required>`
    (child-grid.tsx). So on a grid rendering its own row, a column's `required`
    never reaches the control -- while STILL drawing the header `*`, which is the
    dangerous half: the star and the hold diverge, and AGENTS.md's whole design
    for mandatory fields is that one declaration produces both so they cannot.

    With `forceCards` the table layout never renders on any viewport, so there is
    no width at which the declaration starts working again.

    Every screen doing this today gets it right -- and that is the finding. Four
    of them (Order Amendment, MBA, Attribute, and Material Attribute) each
    rediscovered the rule and each left a comment warning the next reader. Four
    hand-written workarounds for one gap is what a missing check looks like; this
    is that check, so the FIFTH screen is told rather than left to find out from
    an operator that a `*` refuses nothing.

    The fix is never to delete the `required` -- the header star is wanted. It is
    to declare `required` on the control inside `renderMobileRow` too, exactly as
    those four do:

        <Field label={c.header} required={c.required}>{c.cell(r, i)}</Field>
        <Input required ... />            // when the row hand-rolls its control

    Exempt with `// grid-required-mobile: exempt -- <reason>`.
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    if not REQUIRED_COLUMN.search(code):
        return
    m = MOBILE_ROW.search(code)
    if not m:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    if GRID_MOBILE_EXEMPT.search(raw):
        return
    # Any hand-rolled row that backs the declaration counts -- a screen may have
    # several grids and only one of them required, so this is deliberately a
    # file-level "is the rule known here", not a per-grid pairing. A false
    # NEGATIVE is the right way to be wrong: this check exists to catch the
    # screen that never heard of the rule, not to police which grid wired it.
    for mm in MOBILE_ROW.finditer(code):
        if BACKS_REQUIRED.search(_braced_body(code, mm.start())):
            return
    yield Finding(
        "grid-required-mobile", path, line_of(code, m.start()),
        "a column declares `required` but this grid renders its own row, so the "
        "cell never gets RequiredScope -- the header `*` draws and nothing holds. "
        "Declare `required` on the control inside renderMobileRow too",
    )


# ---------------------------------------------------------------------------
# The 2026-08-19 de-clutter rules: ONE frame per grid, and no text that merely
# describes the box it is sitting in. LAYOUT.md §3 and §6.

def _tag_prop_offset(tag: str, name: str) -> int | None:
    """Offset of a TOP-LEVEL prop `name` in an opening tag, or None.

    A plain `name=` search over the tag text is wrong the moment a render prop
    is involved: `renderMobileRow={(row, i) => <Field label={c.header} .../>}`
    puts `label=` INSIDE the tag string, at brace depth 1, belonging to a
    different component. `grid-caption` reported two such grids as passing a
    caption when they pass none — and would equally have missed a real one had
    the nested match been the only hit.

    So: depth 0 only, and not inside a string.
    """
    depth = 0
    quote = None
    i = 0
    while i < len(tag):
        c = tag[i]
        if quote:
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif depth == 0 and tag.startswith(name, i):
            before = tag[i - 1] if i else " "
            after = tag[i + len(name):]
            if not (before.isalnum() or before == "_") and after.lstrip().startswith("="):
                return i
        i += 1
    return None


def _component_tag_start(code: str, start: int, name: str) -> int:
    """Index where the opening tag's PROPS begin — after `<Name` and any generic."""
    i = start + 1 + len(name)
    while i < len(code) and code[i].isspace():
        i += 1
    if i < len(code) and code[i] == "<":
        depth = 0
        while i < len(code):
            if code[i] == "<":
                depth += 1
            elif code[i] == ">":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
            i += 1
    return i


def _component_open_tag(code: str, start: int, name: str) -> str:
    """The opening tag at `start`, SKIPPING a TypeScript generic argument.

    `<ChildGrid<StyleRow> forceCards ... />` is not an occasional shape here --
    it is every one of the 30 call sites in the repo. `_jsx_open_tag` ends a tag
    at the first `>` outside braces, which is the one closing `<StyleRow>`, so
    the "tag" comes back as `<ChildGrid<StyleRow>` carrying no props at all.

    The first cut of `grid-single-frame` and `grid-caption` did exactly that and
    reported 0 and 3 findings against files grep proves carry 18 `forceCards`
    and 42 `label`. A prop check that never sees a prop passes silently and
    reads as compliance -- so this helper exists to make the tag real, and any
    new ChildGrid check must route through it rather than `_jsx_open_tag`.
    """
    return _jsx_open_tag(code, _component_tag_start(code, start, name))


CHILD_GRID_OPEN = re.compile(r"<ChildGrid\b")
LABEL_ATTR = re.compile(r"\blabel\s*=")

SINGLE_FRAME_EXEMPT = re.compile(r"grid-single-frame:\s*exempt\s*--")


def check_grid_single_frame(path: Path, code: str, slug: str):
    """`forceCards` never travels alone (LAYOUT.md §6, client 2026-08-19).

    `forceCards` answers "a wide row must not scroll sideways" by stacking the
    row -- and, incidentally, by drawing a bordered box around each one. So a
    section holding six lines drew SEVEN frames: its own, then one per row. The
    client reported the screen as a stack of boxes rather than a table.

    `flatRows` keeps the stack and keeps the per-row band -- the row's identity
    and the ✕ that carries `data-row-remove` for Ctrl+Del -- and drops only the
    border and its 10px of padding, leaving a hairline to say where a row ends.

    `listRows` passes too. There the row draws its own header, summary and all,
    which is a deliberate choice for an accordion row rather than a forgotten
    prop -- and the screen has visibly taken over the band's job.

    Table mode needs nothing: it already draws a single frame.
    """
    if slug in PRIMITIVES:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in SINGLE_FRAME_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)
    for m in CHILD_GRID_OPEN.finditer(code):
        tag = _component_open_tag(code, m.start(), "ChildGrid")
        if "forceCards" not in tag:
            continue
        if "flatRows" in tag or "listRows" in tag:
            continue
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        yield Finding(
            "grid-single-frame", path, line,
            "`forceCards` with no `flatRows` draws a bordered box per row, so "
            "the section's frame and every row's frame stack. Add `flatRows` "
            "for one frame with hairline rows, or a "
            "`grid-single-frame: exempt -- <reason>` comment",
        )


GRID_CAPTION_EXEMPT = re.compile(r"grid-caption:\s*exempt\s*--")
EMPTY_LABEL_ATTR = re.compile(r"\bemptyLabel\s*=")


def check_grid_caption(path: Path, code: str, slug: str):
    """A grid says its name once, and says nothing when empty (LAYOUT.md §6).

    Two bands, one mistake at two moments.

    The CAPTION (`label`) draws a band above the columns while the surrounding
    `DetailSection` / `FullScreenSection` already names the grid and the rail
    says it a third time. `ChildGrid`'s own prop comment has advised omitting it
    since 2026-08-05 and 42 call sites passed one anyway -- which is the lesson
    this check exists for: advice on a prop nobody is passing is never read.

    A `flushRows` grid is exempt by construction: it is allowed exactly one
    band, and `label` renders INSIDE it, naming the control while the grid is
    empty. Flagging it would push a screen into hand-rolling the band back.

    The EMPTY STATE (`emptyLabel`, and prose beside it) explains what the
    operator can already see. It survives only when it names a CAUSE they can
    act on and could not deduce -- "No sizes in the Sizes master yet" points at
    another screen; "Nothing to choose from" points at nothing.
    """
    if slug in PRIMITIVES or "components/ui/" in slug:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in GRID_CAPTION_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)

    for m in CHILD_GRID_OPEN.finditer(code):
        tag = _component_open_tag(code, m.start(), "ChildGrid")
        off = _tag_prop_offset(tag, "label")
        if off is None or "flushRows" in tag:
            continue
        # Report at the `label` prop, not the tag start: that is where a reader
        # looks, and it is where an exemption comment naturally goes. The tag
        # begins AFTER the generic, so its start is recovered rather than
        # assumed to be `m.start()`.
        line = line_of(code, _component_tag_start(code, m.start(), "ChildGrid") + off)
        if exempt_above(exempt, commentish, line):
            continue
        yield Finding(
            "grid-caption", path, line,
            "this grid passes `label`, but the section around it already names "
            "the grid -- the caption costs a band and repeats the rail. Drop "
            "`label` (the Add button is independent), or add a "
            "`grid-caption: exempt -- <reason>` comment",
        )

    for m in EMPTY_LABEL_ATTR.finditer(code):
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        yield Finding(
            "grid-caption", path, line,
            "a prose empty state describes what the operator can see. Keep it "
            "only when it names a CAUSE elsewhere (\"No sizes in the Sizes "
            "master yet\"); otherwise drop it, or add a "
            "`grid-caption: exempt -- <reason>` comment",
        )


PLACEHOLDER_ATTR = re.compile(r"\bplaceholder\s*=")
PLACEHOLDER_EXEMPT = re.compile(r"placeholder-blank:\s*exempt\s*--")

# These DEFAULT the empty state or forward a caller's prop through; they are
# the declaration, not a call site. Blanking them is how the rule is delivered.
PLACEHOLDER_OWNERS = {
    "components/ui/input.tsx",
    "components/ui/textarea.tsx",
    "components/ui/select.tsx",
    "components/ui/data-picker.tsx",
    "components/ui/combobox.tsx",
    "components/ui/multi-select.tsx",
    "components/ui/field.tsx",
    "components/masters/child-grid.tsx",
}


def check_placeholder_blank(path: Path, code: str, slug: str):
    """An unfilled field shows NOTHING -- and that reaches `placeholder` too.

    LAYOUT.md §3 blanked the pickers' and selects' default empty state on
    2026-08-17, then exempted "an explicit `placeholder`, which still wins".
    That clause was a general escape hatch, and 352 placeholders survived a
    sweep whose whole subject was that an empty control says nothing. It was
    narrowed on 2026-08-19: the exemption is the two STATES, not the prop.

    A placeholder survives when it names a state of the RECORD -- "No
    projection" on Rejection Rule, "Pick a Style first" on the Combo picker,
    `All` on a filter facet. It goes when it describes the box: "Why is this
    order being amended?" restates the label above it, "1" reads as a default
    the operator did not set, and "(auto)" annotates a field that is already
    `readOnly` and therefore already out of the Tab path.
    """
    if slug in PLACEHOLDER_OWNERS or slug in PRIMITIVES:
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in PLACEHOLDER_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)
    for m in PLACEHOLDER_ATTR.finditer(code):
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        # ONLY FLAG WHAT THE SWEEP WOULD ACTUALLY REMOVE. A check that also
        # reports every deliberate keeper cannot be read as a gate -- it stood at
        # 236 findings, all of them decided, which is the same "0 findings means
        # nothing" failure one step along. Buckets D (names a state) and E (a
        # computed value) are the keepers; see the shared rule-set above.
        if not is_jsx_attribute(code, m.start()):
            continue                      # a component declaring its own prop
        try:
            _, _, src, dyn = hint_attr_span(code, m.start())
        except ValueError:
            continue
        if not dyn and SEARCH_TEXT.match(src):
            continue                      # a search box keeps its words
        bucket, _reason = classify_hint(src, governing_label(code, m.start()), dyn)
        if bucket in KEEP_BY_DEFAULT:
            continue
        yield Finding(
            "placeholder-blank", path, line,
            "a placeholder that describes the field repeats the label above it. "
            "Blank it, or -- if it names a STATE of the record -- keep it with a "
            "`placeholder-blank: exempt -- <reason>` comment",
        )


# The year-bearing native controls. Each draws a spin-editable year segment that
# takes SIX digits unless `max` says otherwise; `time` is absent because it has
# no year to get wrong.
DATE_YEAR_TYPES = {"date", "datetime-local", "month", "week"}
DATE_YEAR_EXEMPT = re.compile(r"date-year:\s*exempt\s*--")
MAX_ATTR = re.compile(r"\bmax\s*=")


def check_date_year(path: Path, code: str, slug: str):
    """A raw `<input type="date">` must cap its year, and only `max` can.

    Chrome's year segment accepts SIX digits -- the HTML date format allows
    years past 9999 -- and there is no other handle on it: `maxLength` applies
    to text-entry types only, the segment is browser chrome the page cannot
    read, and `checkValidity()` returns TRUE for year 26666, so nothing
    downstream objects either. A `date` column stores it happily. That is the
    bug the client reported on Order Info's Deli.Dt (2026-08-21, screenshot
    2438: `dd-mm-142343`).

    `max` with a four-digit year is the whole fix, and it was MEASURED rather
    than assumed -- `min` alone leaves 26666 exactly as it was, because it
    bounds validity and not typing. See `DATE_MAX` in components/ui/input.tsx
    for the table.

    So this check has one target: the RAW lowercase element, which inherits
    nothing. `<Input type="date">` is not flagged and must not be -- the
    primitive defaults `max` for all 175 of them, and flagging them would be
    175 findings for a rule that is already kept.

    The primitive itself is not special-cased, deliberately (the `toolbar-size`
    lesson: exempting the declaring component is how a check passes while the
    cause sits untouched). It simply does not match -- its `type` comes from
    props, so there is no literal `type="date"` to find.

    Opt out with a `date-year: exempt -- <reason>` comment.
    """
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in DATE_YEAR_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)
    for m in RAW_FIELD_TAG.finditer(code):
        if m.group(1) != "input":
            continue
        tag = _jsx_open_tag(code, m.start())
        t = TYPE_ATTR.search(tag)
        if not t or t.group(1).lower() not in DATE_YEAR_TYPES:
            continue
        if MAX_ATTR.search(tag):
            continue
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        yield Finding(
            "date-year", path, line,
            f'raw <input type="{t.group(1)}"> has no `max`, so its year segment takes '
            "six digits (year 26666 reads as VALID and saves); use the <Input> "
            "primitive, or pass max={DATE_MAX}, or add a "
            "`date-year: exempt -- <reason>` comment",
        )


# ---------------------------------------------------------------------------
# color-token -- a Tailwind colour utility must name a token that EXISTS
# ---------------------------------------------------------------------------

COLOR_TOKEN_EXEMPT = re.compile(r"color-token:\s*exempt\b[^\n]*\S", re.I)

#: Utility prefixes that take a COLOUR. `shadow` is deliberately absent: its
#: common values are sizes (`shadow-sm`), and a coloured shadow is rare enough
#: here that including it would be noise for no signal.
COLOR_PREFIXES = (
    "bg", "text", "border", "ring", "fill", "stroke", "divide",
    "outline", "accent", "caret", "decoration", "placeholder",
    "from", "via", "to",
)

#: Values these prefixes take that are NOT colours. Without this the check
#: reports `text-sm` 1873 times.
NON_COLOUR_VALUES = {
    # sizes and the type scale
    "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl",
    "7xl", "8xl", "9xl",
    # text alignment / wrapping / decoration
    "left", "center", "right", "justify", "start", "end", "wrap", "nowrap",
    "balance", "pretty", "ellipsis", "clip", "truncate", "underline",
    "overline", "line", "through",
    # border / divide sides and styles
    "t", "r", "b", "l", "x", "y", "s", "e",
    "solid", "dashed", "dotted", "double", "hidden", "collapse", "separate",
    # backgrounds that are not colours
    "cover", "contain", "fixed", "local", "scroll", "repeat", "no", "origin",
    "top", "bottom", "middle", "auto", "clip",
    # keywords shared across prefixes
    "none", "inherit", "current", "transparent", "initial", "unset",
    # ring / outline
    "inset", "offset",
    # bg-gradient-to-br and friends are DIRECTIONS, not colours
    "gradient",
    # tailwind's two bare colours, which are real utilities
    "white", "black",
}

#: A prefix only counts at a word boundary. Without this, `to-` matches inside
#: `auto-update`, `auto-reload` and `auto-generated`, which the prototype found
#: 39 times -- enough noise to make the check unreadable.
#: Attributes whose VALUE is an identifier rather than a class list.
ATTR_NOT_CLASS = re.compile(r'(?:^|[^A-Za-z])(?:id|htmlFor|name|key|href|for)[ ]*[:=][ ]*["{`]?[^"`]*$')

COLOR_UTIL = re.compile(
    r"(?:^|[\s\"'`{(\[:])((?:" + "|".join(COLOR_PREFIXES) + r")-[a-z][a-z0-9/\[\]#.-]*)"
)

_DECLARED_TOKENS: dict[str, set[str]] = {}
_COLOR_TOKEN_MUTE = False


def _repo_root_of(path: Path) -> Path | None:
    """Walk UP from a source file until `app/globals.css` is beside us.

    NOT arithmetic on the slug. The first cut derived the root by walking up
    `len(Path(slug).parts) - 1` levels, which is off by one -- `slug` counts the
    FILENAME too -- so it landed one directory short, found no globals.css, and
    every colour utility in the repo looked undeclared. Searching for the file
    cannot be off by one.
    """
    here = path.parent
    for _ in range(12):
        if (here / "app" / "globals.css").is_file():
            return here
        if here.parent == here:
            break
        here = here.parent
    return None


def declared_color_tokens(root: Path) -> set[str]:
    """The `--color-*` names `app/globals.css` declares, cached.

    Tailwind v4 generates a colour utility for each of these and for NOTHING
    else, which is the whole basis of this check: a class naming any other
    token compiles to no CSS at all.

    Cached at module level because `check_*` runs per FILE -- 645 of them -- and
    re-reading and re-parsing globals.css each time would be 645 reads for one
    unchanging answer.
    """
    key = str(root)
    if key in _DECLARED_TOKENS:
        return _DECLARED_TOKENS[key]
    try:
        css = (root / "app" / "globals.css").read_text(encoding="utf-8", errors="replace")
    except OSError:
        css = ""
    tokens = set(re.findall(r"--color-([a-z0-9-]+)\s*:", css))
    # AN EMPTY ANSWER IS NEVER CACHED. The first cut memoised it, so one bad
    # root on the first file disabled the check for all 1,192 -- and it reported
    # `0 findings`, which reads exactly like a clean repo. That is the blind
    # check this file has been caught shipping three times.
    if tokens:
        _DECLARED_TOKENS[key] = tokens
    return tokens


def check_color_token(path: Path, code: str, slug: str):
    """A colour utility must name a token globals.css declares, or it is dead CSS.

    Tailwind v4 builds its colour utilities from `--color-*`. A class naming a
    token that does not exist -- `bg-destructive`, `bg-muted`, `bg-card` --
    generates NO CSS. Nothing errors, nothing warns, and the element simply has
    no colour.

    ## IT IS WORSE THAN NOTHING, BECAUSE `cn()` IS `twMerge`

    `twMerge` resolves conflicts by class NAME, not by whether the class
    resolves. So a `<Button className="bg-destructive ...">` with no `variant`
    has its working `bg-primary text-primary-foreground` STRIPPED -- twMerge
    treats the later className as an override -- and replaced with three
    classes that compile to nothing. Thirteen Planning delete buttons rendered
    with no background and no text colour at all, which is worse than if the
    className had never been written (2026-08-23).

    The same shape is already recorded for `bg-muted` / `bg-card` /
    `bg-secondary`: shadcn habits carried in from other projects, where the
    tokens are real. Here they are not.

    ## THE PREFIX MUST BE ANCHORED

    `to-`, `from-` and `via-` are gradient stops, and they match inside ordinary
    words: `auto-update`, `auto-reload`, `auto-generated`. The prototype for
    this check found 39 such hits before anchoring. A leading boundary is what
    makes the output readable.

    A utility carrying a DIGIT is Tailwind's own palette (`amber-500`,
    `blue-600`) or an arbitrary value, and is skipped -- this check knows the
    project's tokens, not Tailwind's.

    Opt out with a `color-token: exempt -- <reason>` comment.
    """
    if not code:
        return
    root = _repo_root_of(path)
    declared = declared_color_tokens(root) if root else set()
    if not declared:
        # NOTHING TO CHECK AGAINST IS NOT A CLEAN BILL, AND IT MUST NOT BE
        # SILENT. Reporting every class as undeclared would bury the repo; a
        # bare `return` is worse -- it prints `0 findings`, which reads exactly
        # like a clean run. This check already shipped that way once (the root
        # was derived one directory short, the empty answer was cached, and all
        # 1,192 files came back clean). So it says so, once.
        global _COLOR_TOKEN_MUTE
        if not _COLOR_TOKEN_MUTE:
            _COLOR_TOKEN_MUTE = True
            yield Finding(
                "color-token", path, 1,
                "could not read app/globals.css, so no colour token could be "
                "verified -- this check did NOT run; 0 findings here means "
                "nothing",
            )
        return

    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    exempt = {line_of(raw, m.start()) for m in COLOR_TOKEN_EXEMPT.finditer(raw)}
    commentish = comment_only_lines(raw, code)

    for m in COLOR_UTIL.finditer(code):
        util = m.group(1)
        # AN `id` IS NOT A className. `budget-screen.tsx` prefixes its field ids
        # `bg-` for "budget" -- `htmlFor="bg-rate"`, `id="bg-remark"` -- and a
        # scan that reads any `bg-*` token reported three of them as dead CSS.
        # The nearest attribute name is what tells them apart.
        before = code[max(0, m.start() - 24):m.start()]
        if ATTR_NOT_CLASS.search(before):
            continue
        prefix, _, value = util.partition("-")
        # Drop the opacity modifier: `bg-danger/40` names the token `danger`.
        value = value.split("/", 1)[0]
        if not value or any(ch.isdigit() for ch in value):
            continue
        if "[" in value or "(" in value or "." in value:
            continue  # arbitrary value: bg-[#fff], bg-[var(--x)]
        if value in NON_COLOUR_VALUES:
            continue
        # A compound like `border-t` on the `border` prefix is a side, not a
        # token; its first segment carries that.
        if value.split("-", 1)[0] in NON_COLOUR_VALUES:
            continue
        if value in declared:
            continue
        line = line_of(code, m.start())
        if exempt_above(exempt, commentish, line):
            continue
        yield Finding(
            "color-token", path, line,
            f"`{util}` names no token globals.css declares, so it compiles to NO "
            f"CSS -- and `cn()` is twMerge, which still strips the variant class "
            f"it appears to override. Use a declared token ({', '.join(sorted(declared)[:4])}, "
            f"...) or a Button `variant`, or add a `color-token: exempt -- <reason>` comment",
        )

# --------------------------------------------------------------------------
# mount
# --------------------------------------------------------------------------

MOUNT_EXEMPT = re.compile(r"mount:\s*exempt\b")

# `from "…/thing"` / `from './thing'` — any module specifier. Only the last
# segment is kept, so an alias import and a relative one match the same file.
IMPORT_SPEC = re.compile(r"""from\s+["']([^"']+)["']""")

# Computed once per run: every module basename imported ANYWHERE in the tree.
_IMPORTED: set[str] | None = None


def _root_of(path: Path, slug: str) -> Path:
    """The scan root, recovered from a path and its slug."""
    return path.parents[len(Path(slug).parts) - 1]


def _imported_basenames(root: Path) -> set[str]:
    global _IMPORTED
    if _IMPORTED is None:
        names: set[str] = set()
        for p in iter_sources(root):
            try:
                src = strip_comments(p.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
            for m in IMPORT_SPEC.finditer(src):
                names.add(m.group(1).rsplit("/", 1)[-1])
        _IMPORTED = names
    return _IMPORTED


def check_mount(path: Path, code: str, slug: str):
    """A master screen that NOTHING imports is dead code on the menu's behalf.

    2026-08-01 removed twelve entries from `lib/masters/submodules.ts` and the
    matching branches from the `[submodule]/[entity]` route. The COMPONENTS were
    left behind, so ten `*-screen.tsx` files sat complete, compiling and
    unreachable for a month -- Employee among them, which is what made
    `employees` hold a single test row and blocked the Merchandiser deploy step
    that 0478 depends on.

    Nothing detected it, and the reason is exact: **no other check asks what
    MOUNTS a component.** An unimported screen is an ABSENCE, not a broken
    reference. `tsc` is clean because dead code compiles; every layout and
    keyboard check stayed at baseline because they walk `components/masters/**`
    regardless of whether anything renders it. The screens were correct and
    merely unreachable, which is the one state the whole audit suite cannot see.

    ## WHY THE RULE IS "ANYTHING IMPORTS IT", NOT "THE ROUTE IMPORTS IT"

    A screen reached through another screen is legitimately mounted, so keying
    on the route file alone would report false positives on every nested one.
    The weaker rule still catches the thing that actually happened: an entry
    deleted from the registry leaves its component imported by nobody at all.

    Known limitation, stated rather than engineered around: two orphaned screens
    that import EACH OTHER would both pass. Building a reachability graph from
    the route down would close it, and is not worth the machinery for a case
    that has never occurred -- the ten found on 2026-08-31 had no imports at all
    outside prose comments.

    ## THE EXEMPTION IS THE POINT, NOT AN ESCAPE HATCH

    Nine of those ten are dark ON PURPOSE: the client removed them as "not part
    of this business process". They are meant to stay in git -- their tables were
    deliberately kept -- so this check must not nag about them forever.

    But the decision lived only in a comment in `submodules.ts`, and the screens
    said nothing. Three agents in one session grepped a screen, found no reason,
    and concluded it had been dropped by accident; the lead approved restoring it
    on that false premise. `mount: exempt -- <reason>` puts the reason WHERE THE
    GREP LANDS. That is the whole exercise: it converts an invisible absence into
    a declared decision.

    Verified by being made to FAIL FIRST, and against the real broken state
    rather than a manufactured one -- nine orphans existed in the tree when this
    was written, and it found exactly those nine before any exemption was added.
    Positive control: `vendor-master-screen.tsx` resolves to a real import, so
    the check demonstrably distinguishes mounted from orphaned.
    """
    if not slug.startswith("components/masters/") or not slug.endswith("-screen.tsx"):
        return
    if path.stem in _imported_basenames(_root_of(path, slug)):
        return
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        raw = ""
    # Read from RAW text: `code` has had its comments blanked, and the
    # exemption IS a comment.
    if MOUNT_EXEMPT.search(raw):
        return
    # Line 1: the fault is the absence of an importer, which has no line in
    # this file to point at.
    yield Finding(
        "mount", path, 1,
        f"nothing imports {path.name} -- a master screen no route mounts is "
        "unreachable, and no other check can see it. Register it in "
        "lib/masters/submodules.ts + the [submodule]/[entity] route, or add a "
        "`mount: exempt -- <reason>` comment saying why it is deliberately dark",
    )


CHECKS = {
    "grid-required-mobile": check_grid_required_mobile,
    "cascade-filter": check_cascade_filter,
    "required-star": check_required_star,
    "created-columns": check_created_columns,
    "created-by-data": check_created_by_data,
    "required-hold": check_required_hold,
    "toolbar-size": check_toolbar_size,
    "truncate-reveal": check_truncate_reveal,
    "autofill": check_autofill,
    "dup-check": check_dup_check,
    "spell-suggest": check_spell_suggest,
    "picker-inactive": check_picker_inactive,
    "screen-grid": check_screen_grid,
    "screen-table": check_screen_table,
    "field-track": check_field_track,
    "editor-clone": check_editor_clone,
    "text-size-noop": check_text_size_noop,
    "caps-input": check_caps_input,
    "row-actions": check_row_actions,
    "stored-select": check_stored_select,
    "picker-perms": check_picker_perms,
    "grid-single-frame": check_grid_single_frame,
    "grid-caption": check_grid_caption,
    "placeholder-blank": check_placeholder_blank,
    "date-year": check_date_year,
    "color-token": check_color_token,
    "mount": check_mount,
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

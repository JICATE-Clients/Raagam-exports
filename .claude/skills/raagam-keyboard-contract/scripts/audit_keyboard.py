#!/usr/bin/env python3
"""Audit a Raagam checkout for surfaces that have drifted out of the keyboard contract.

Every check here corresponds to a rule in ../references/contract.md or a failure
mode in ../references/traps.md. Findings are CANDIDATES to inspect, not verdicts:
the checks are textual heuristics, so a hit may legitimately be fine and a miss
does not prove compliance. Read the flagged file before changing anything.

Checks run against a comment-stripped copy of each file, because this codebase
documents its own past bugs in comments -- searching raw text finds the bug
description and reports the fix as the defect.

Usage:
    python audit_keyboard.py <repo-root>
    python audit_keyboard.py <repo-root> --check picker-trigger
    python audit_keyboard.py <repo-root> --quiet     # findings only, no summary
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# Directories that never contain application surfaces.
SKIP_DIRS = {
    "node_modules", ".next", ".git", "dist", "build", "out",
    "coverage", "public", ".claude", "supabase",
}

SOURCE_SUFFIXES = {".tsx", ".ts"}


@dataclass
class Finding:
    check: str
    path: Path
    line: int
    message: str


def iter_sources(root: Path):
    """Yield every source file under root, skipping vendored/build directories."""
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


def tag_end(code: str, start: int) -> int:
    """Index of the `>` that closes the JSX tag opening at `start`, else -1.

    Brace- and quote-aware. A naive `find(">")` lands on the arrow of an inline
    `onClick={() => ...}` handler, which is precisely the shape this needs to
    look past.
    """
    depth, quote, i, n = 0, "", start, len(code)
    while i < n:
        c = code[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = ""
        elif c in "\"'`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0:
            return i
        i += 1
    return -1


# --------------------------------------------------------------------------
# Checks. Each takes (path, code) where `code` is comment-stripped source.
# --------------------------------------------------------------------------

def check_picker_trigger(path: Path, code: str):
    """A picker component's trigger button must carry data-field-trigger.

    Without it the picker is not a *field*: Enter activates the button and opens
    the dialog instead of advancing, arrows do nothing, and it stops being a real
    grid column. See contract.md, "honoured in THREE places".

    Scoped to files that DEFINE a picker. Screens that merely render one import
    the marker along with the component and must not be flagged.
    """
    defines_picker = path.name.endswith("-picker.tsx") or re.search(
        r"export\s+function\s+\w*Picker\b", code
    )
    if not defines_picker or "data-field-trigger" in code:
        return
    m = re.search(r"<button\b", code)
    if m:
        yield Finding(
            "picker-trigger", path, line_of(code, m.start()),
            "picker component whose trigger has no data-field-trigger marker",
        )


def check_combobox_consumes_tab(path: Path, code: str):
    """A role=combobox control may close on Tab, but must NOT consume it.

    Tab is pure movement. Calling preventDefault leaves focus where it was --
    native tab order and Sheet's focus trap both stand down on defaultPrevented.
    See traps.md, "Combobox must close on Tab without consuming it".
    """
    if 'role="combobox"' not in code:
        return
    for m in re.finditer(r'key\s*===\s*"Tab"', code):
        following = code[m.end(): m.end() + 400]
        # Stop at the next branch, or a neighbouring Escape branch's
        # preventDefault reads as the Tab branch's.
        cut = following.find("else if")
        if cut != -1:
            following = following[:cut]
        if "preventDefault" in following:
            yield Finding(
                "combobox-tab", path, line_of(code, m.start()),
                "combobox calls preventDefault on Tab; Tab must always move focus",
            )


def check_bare_overlay_guard(path: Path, code: str):
    """A hand-rolled `fixed inset-0` overlay must call useModalGuard.

    reload-guard's DOM scan only sees role="dialog" / aria-modal, so a bare div
    is invisible to it and the silent PWA updater can reload the tab underneath
    a half-typed form. Mirrors the standing rule in AGENTS.md.

    Self-closing overlays are skipped: a bare `<div className="fixed inset-0"
    onClick={close} />` is a dropdown click-catcher, holds no editable state, and
    has nothing for a reload to destroy. Only overlays that WRAP content are
    reported.
    """
    if "useModalGuard" in code or 'role="dialog"' in code or "aria-modal" in code:
        return
    for m in re.finditer(r"fixed inset-0", code):
        start = code.rfind("<", 0, m.start())
        end = tag_end(code, start) if start != -1 else -1
        if start == -1 or end == -1:
            continue
        if code[:end].rstrip().endswith("/"):
            continue  # self-closing: a click-catcher, not an overlay
        yield Finding(
            "overlay-guard", path, line_of(code, m.start()),
            "fixed inset-0 overlay wrapping content, with no useModalGuard and no dialog role",
        )
        return


def check_unsaved_guard(path: Path, code: str):
    """An editor surface should declare unsaved work.

    useUnsavedGuard(dirty || isPending) feeds BOTH the reload guard and the
    Escape dirty-confirm, so a surface that skips it silently loses the confirm.

    Scoped to files that render an editor surface, where Escape actually closes
    something. Plain list/detail pages are out of scope by design.
    """
    if "useUnsavedGuard" in code or "useFormDraft" in code:
        return
    if not re.search(r"<(Sheet|MasterFullScreen|SimpleMasterScreen)\b", code):
        return
    # A PAGE-MOUNTED `MasterFullScreen` REGISTERS THE GUARD FOR ITS SCREEN, and
    # is the one surface that does. `master-full-screen.tsx` calls
    # `useUnsavedGuard(mount === "page" && (dirty || !!footer.isPending))`, so a
    # screen handing it a `dirty` flag has declared -- calling the hook again
    # beside it would register the same fact twice.
    #
    # Deliberately BOTH conditions. `mount="overlay"` takes the `useModalGuard`
    # branch instead, and `confirmDiscard()` reads only `useUnsavedGuard` -- so
    # an overlay-mounted screen that skips the hook loses the Escape confirm
    # silently, which is the exact failure this check exists to catch. And a
    # `dirty` prop left off means the component has nothing to register: the
    # guard would be permanently false and Escape would discard typed work
    # without asking.
    # Read the props off the TAG, via `tag_end` -- a `[^>]*?` scan stops at the
    # `>` of the first inline `onSave={() => ...}` handler and never reaches the
    # props below it, which is what `tag_end` is quote- and brace-aware for.
    for m in re.finditer(r"<MasterFullScreen\b", code):
        end = tag_end(code, m.start())
        if end == -1:
            continue
        props = code[m.start():end]
        if 'mount="page"' in props and re.search(r"\bdirty=", props):
            return
    m = re.search(r"\bisPending\b", code) or re.search(r"\buseState\b", code)
    if m and re.search(r"\b(onSave|handleSave|onSubmit)\b", code):
        yield Finding(
            "unsaved-guard", path, line_of(code, m.start()),
            "editor surface with no useUnsavedGuard; Escape will not confirm",
        )


def check_listbox_stops_propagation(path: Path, code: str):
    """Arrow handlers in a listbox must stopPropagation.

    Otherwise a combobox inside a grid cell moves its highlight AND jumps the
    grid a row on the same keypress.
    """
    if 'role="listbox"' not in code or "stopPropagation" in code:
        return
    m = re.search(r'"ArrowDown"', code)
    if m:
        yield Finding(
            "listbox-propagation", path, line_of(code, m.start()),
            "listbox handles arrows without stopPropagation",
        )


def check_grid_keyed_on_td(path: Path, code: str):
    """Grid navigation must key off data-grid-row, never closest("td").

    Material grids render cards, not tables, so a <td>-based lookup silently does
    nothing there -- the classic "arrows work on some screens" report.
    """
    for m in re.finditer(r'closest\(\s*["\'](td|tr)["\']\s*\)', code):
        yield Finding(
            "grid-td", path, line_of(code, m.start()),
            'grid lookup via closest("td"/"tr"); use data-grid-row / data-grid-body',
        )


def check_dialog_owns_escape(path: Path, code: str):
    """A portal dialog must consume Escape.

    Escape's last layer leaves the PAGE (keyboard-nav-provider, bound to window so
    it runs after every document handler). A dialog that never claims the key
    therefore turns one press into "dismiss the dialog AND navigate away" -- or,
    worse, leaves Escape dead inside it while hasOpenModalInDom blocks the page
    layer. Reuse pickerKeyDown rather than hand-rolling this.
    """
    if 'role="dialog"' not in code or "createPortal" not in code:
        return
    if "pickerKeyDown" in code or "useOverlayFocus" in code:
        return
    if re.search(r'key\s*(!==|===)\s*"Escape"', code):
        return
    m = re.search(r'role="dialog"', code)
    yield Finding(
        "dialog-escape", path, line_of(code, m.start()),
        "portal dialog with no Escape handler; Escape will fall through to the page",
    )


# Screens that run a duplicate check but deliberately do NOT hold the cursor.
# Named here rather than read from a comment in the file: comments are stripped
# before the checks run, and -- following audit_layout.py -- an exemption you
# have to defend in one reviewable list is better than one hidden at the site.
DUP_HOLD_EXEMPT = {
    # The name is a composed <div> preview, not an input. There is no field to
    # hold; Save is gated on the error instead.
    "yarn-quick-create-sheet.tsx",
    # A WARNING, not an error. Two consignees may legitimately share a GSTIN
    # (branches, a re-keyed party) and `canSave` is not gated on it -- holding
    # here would cage the operator on a field they have every right to leave.
    "consignee-master-screen.tsx",
}


# Either hook wires a live check. Rule 1 below must know both, or a screen that
# moves from one to the other silently stops being checked.
DUP_HOOK = re.compile(r"\buseDuplicate(?:Check|Name)\b")

# The opt-out for rule 3, written beside the call it applies to and required to
# say why. Matched against RAW text -- it is a comment, which `code` has blanked
# out. Same family as audit_layout.py's `dup-check: exempt`, deliberately: the
# reader of a server-only check is the person who needs the reason.
SERVER_ONLY_OK = re.compile(r"dup-check:\s*server-only\b[^\n]*\S", re.I)


def check_dup_hold_wiring(path: Path, code: str):
    """A live duplicate check must reach the field, and reach it IN TIME.

    Three failure modes, one check:

    1. A screen runs a check and renders the message, but never puts
       `data-dup-error` on the input -- so the error shows and the cursor walks
       away from it, which is the behaviour the hold exists to stop.
    2. Someone writes `data-dup-error` by hand. It then drifts out of step with
       aria-invalid / aria-describedby, and worse, tends to get keyed off a
       broader signal than a real duplicate (see traps.md).
    3. A master SCREEN uses the server-only `useDuplicateCheck`. The hold is a
       keydown-time test, and that hook answers 300ms + a round trip later -- so
       the operator who types and tabs straight away is already gone when the
       message paints. That is exactly how the rule was reported broken (client
       2026-08-01). A `*-master-screen.tsx` is handed its `rows`, so the
       synchronous half (`useDuplicateName`) is always available to it; opt out
       with `// dup-check: server-only -- <reason>` where the rows genuinely are
       not there (a quick-create sheet opened from a picker) or where the check
       is advisory and holds nothing.

       The late answer still fetches the cursor back (the catch-up in
       keyboard-nav-provider.tsx), so this is a quality finding, not a break:
       being held before you move is better than being pulled back after.
    """
    if (
        DUP_HOOK.search(code)
        and "dupFieldProps" not in code
        and path.name not in DUP_HOLD_EXEMPT
    ):
        m = DUP_HOOK.search(code)
        yield Finding(
            "dup-hold", path, line_of(code, m.start()),
            f"{m.group(0)} without dupFieldProps(); the error will show but "
            "the cursor will not be held",
        )
    for m in re.finditer(r'data-dup-error\s*=', code):
        yield Finding(
            "dup-hold", path, line_of(code, m.start()),
            "data-dup-error written by hand; emit it via dupFieldProps()",
        )

    if path.name.endswith("-master-screen.tsx") and "useDuplicateCheck" in code:
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            raw = ""
        if not SERVER_ONLY_OK.search(raw):
            m = re.search(r"useDuplicateCheck", code)
            yield Finding(
                "dup-hold", path, line_of(code, m.start()),
                "server-only useDuplicateCheck on a screen that has `rows`; use "
                "useDuplicateName so the collision is known in the same render "
                "as the keystroke, before Tab can move",
            )


# The only files allowed to name Tab. Everything else in the app inherits the
# rule from components/shell/keyboard-nav-provider.tsx.
#
#   focus.ts                  the rule itself (cycleTab)
#   keyboard-nav-provider     delivers it, and the duplicate hold refuses it
#   picker-keys.ts            a portal dialog's trap, which delegates to cycleTab
#   combobox / data-picker /  an open list CLOSING on Tab without consuming it --
#     material-master-screen    legitimate, and covered by `combobox-tab` above
#   child-grid.tsx            a grid owns "Tab = next cell", the sanctioned
#                               exception -- and the one that reaches the
#                               page-level screens the provider's gate excludes
TAB_OWNERS = {
    "focus.ts",
    "keyboard-nav-provider.tsx",
    "picker-keys.ts",
    "child-grid.tsx",
    "combobox.tsx",
    "data-picker.tsx",
    "material-master-screen.tsx",
}

# A child ROW's Remove button, by the label it announces itself with.
#
# Deliberately just "Remove", and deliberately only inside a file that renders a
# grid. A `Clear` inside a Combobox or a `Delete` on a DataPicker row also carries
# tabIndex={-1}, and there it is NOT redundant: those sit in the content region
# with the fields, so the attribute is what keeps them off the ↑↓←→ spatial walk
# (`arrowNavigate` walks `orderedFocusables`, which has no field filter) as well
# as off Tab. Flagging them would push a reader into reintroducing an arrow bug to
# silence an audit. A row's Remove is the narrow case where the grid's own
# `ROW_FIELDS` axis already excludes it from the arrows, so Tab was the only key
# still landing on it and the global rule is now the whole answer.
ROW_REMOVE_LABEL = re.compile(r'aria-label=(?:"|\{[`"\'])\s*Remove\b', re.I)


def check_tab_is_not_local(path: Path, code: str):
    """Tab belongs to the provider. A local handler silently replaces it.

    The provider bails on `defaultPrevented`, which is what lets a control own a
    key -- and means a per-surface Tab handler does not ADD behaviour, it takes
    the contract off that surface and keeps it off through every future change.
    Two such handlers existed (sheet.tsx, master-full-screen.tsx) and between
    them they were the reason Tab was ordered on two surfaces and native on all
    the rest.

    A surface that needs Tab to do something new needs `lib/focus.ts` changed,
    not a listener of its own.
    """
    if path.name in TAB_OWNERS:
        return
    for m in re.finditer(r'key\s*===\s*"Tab"', code):
        yield Finding(
            "tab-local", path, line_of(code, m.start()),
            "local Tab handler; Tab is delivered by keyboard-nav-provider and "
            "targets fields -- a handler here opts this surface out",
        )


def check_row_remove(path: Path, code: str):
    """A grid row's Remove button: reachable by Ctrl+Del, and not by tabIndex.

    Two findings, one button.

    `tabIndex={-1}` here was the answer to "Tab lands on the row's Remove" once
    (ChildGrid, 2026-08-01). It fixed exactly the one component it was written in;
    ~22 hand-rolled grids still had the bug three days later. `cycleTab` now
    targets `isFieldLike` on every surface, so the attribute buys nothing -- and
    it costs something, because it removes the control from the document's focus
    order outright, where the contract only wants it off the TYPING path.

    And with Tab gone from it, `Ctrl+Del` is the only key that reaches it. That
    lookup is by `data-row-remove` or an `aria-label` starting "Remove", so a
    button labelled anything else is a row a keyboard cannot delete.

    See traps.md, "A fix inside a shared component still leaves a remainder".
    """
    if "data-grid-row" not in code:
        return
    for m in ROW_REMOVE_LABEL.finditer(code):
        start = code.rfind("<", 0, m.start())
        end = tag_end(code, start) if start != -1 else -1
        if start == -1 or end == -1:
            continue
        if re.search(r"tabIndex=\{-1\}", code[start:end]):
            yield Finding(
                "tab-fields", path, line_of(code, m.start()),
                "tabIndex={-1} on a row's Remove; Tab skips non-fields on every "
                "surface now -- drop it and keep the control focusable",
            )


def check_editor_declares_itself(path: Path, code: str):
    """An editor Tab cannot recognise keeps native tab order.

    `isEditorScope` (lib/focus.ts) claims Tab only for a `[role="dialog"]`, a pane
    carrying `data-focus-scope`, or a surface with a `data-focus-region="footer"`.
    That gate is deliberate -- it is what keeps Tab native on list pages and
    filter bars -- but it means a hand-rolled editor that declares none of them
    silently keeps the OLD behaviour: no trap, no field targeting, the ✕ first in
    DOM order. That is precisely the "focus missing on some screens" report.

    Scoped to hand-rolled `fixed inset-0` overlays. Anything built on Sheet or
    MasterFullScreen inherits a marker and is not flagged.
    """
    if re.search(r"data-focus-scope|data-focus-region|role=\"dialog\"|aria-modal", code):
        return
    # An overlay with no fields is a menu or a click-catcher, not an editor.
    if not re.search(r"<(Input|Textarea|Combobox|Select|DataPicker)\b", code):
        return
    for m in re.finditer(r"fixed inset-0", code):
        start = code.rfind("<", 0, m.start())
        end = tag_end(code, start) if start != -1 else -1
        if start == -1 or end == -1:
            continue
        # Self-closing: a dropdown's click-catcher (topbar's user menu), not an
        # editor. Same exclusion `overlay-guard` above makes, for the same reason
        # -- it wraps nothing, so there is nothing in it to tab through.
        if code[:end].rstrip().endswith("/"):
            continue
        yield Finding(
            "tab-fields", path, line_of(code, m.start()),
            "hand-rolled overlay with fields but no data-focus-scope / dialog "
            "role; Tab keeps native order there and will walk into the page behind it",
        )
        return


def check_page_editor_declares_itself(path: Path, code: str):
    """A page-level editor that Tab cannot recognise keeps native tab order.

    Same gate as the overlay check above, aimed at the other shape: a form
    rendered straight onto a page rather than into an overlay. `isEditorScope`
    claims Tab for a dialog, a `data-focus-scope` pane, or a surface with a
    footer region -- and a hand-rolled page form usually declares none of them,
    so Tab there still walks into the sidebar and still stops on Save/Cancel.

    Deliberately NOT solved by widening `isEditorScope` to "a <form> with a
    submit button": 98 of the 99 unmarked forms in this repo have one, including
    every list-page filter panel and search box, so that rule would cage the
    operator inside a filter bar. The marker has to be deliberate.

    The discriminator is `useUnsavedGuard` / `useFormDraft`: the standing rule in
    AGENTS.md says every screen holding editable local state calls one, so their
    presence is the codebase's own statement that this surface is an editor.
    Surfaces built on Sheet / MasterFullScreen / SimpleMasterScreen inherit a
    marker and are not flagged.
    """
    # The hooks' own source, not a screen that calls them.
    if path.name in {"reload-guard.ts", "use-form-draft.ts"}:
        return
    if not re.search(r"\buseUnsavedGuard\b|\buseFormDraft\b", code):
        return
    if re.search(r"data-focus-scope|data-focus-region", code):
        return
    if re.search(r"<(Sheet|MasterFullScreen|SimpleMasterScreen)\b", code):
        return
    m = re.search(r"\buseUnsavedGuard\b|\buseFormDraft\b", code)
    yield Finding(
        "tab-page-form", path, line_of(code, m.start()),
        "page-level editor with no data-focus-scope; Tab keeps native order "
        "here, so it leaves the form and stops on buttons",
    )


CHECKS = {
    "tab-local": check_tab_is_not_local,
    "tab-page-form": check_page_editor_declares_itself,
    "tab-fields": lambda p, c: (
        list(check_row_remove(p, c)) + list(check_editor_declares_itself(p, c))
    ),
    "picker-trigger": check_picker_trigger,
    "combobox-tab": check_combobox_consumes_tab,
    "dialog-escape": check_dialog_owns_escape,
    "overlay-guard": check_bare_overlay_guard,
    "unsaved-guard": check_unsaved_guard,
    "listbox-propagation": check_listbox_stops_propagation,
    "grid-td": check_grid_keyed_on_td,
    "dup-hold": check_dup_hold_wiring,
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("root", type=Path, help="repo root to scan")
    parser.add_argument("--check", action="append", choices=sorted(CHECKS),
                        help="run only these checks (repeatable)")
    parser.add_argument("--quiet", action="store_true", help="findings only")
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
        for check in selected.values():
            findings.extend(check(path, code))

    findings.sort(key=lambda f: (f.check, str(f.path)))
    for f in findings:
        rel = f.path.relative_to(root).as_posix()
        print(f"[{f.check}] {rel}:{f.line}  {f.message}")

    if not args.quiet:
        by_check: dict[str, int] = {}
        for f in findings:
            by_check[f.check] = by_check.get(f.check, 0) + 1
        print()
        print(f"scanned {scanned} source files under {root}")
        for name in sorted(selected):
            print(f"  {name:<22} {by_check.get(name, 0)}")
        if findings:
            print()
            print("These are heuristics. Read each file before changing it;")
            print("see ../references/traps.md for what each check is protecting.")

    # Always exit 0: this is an advisory audit, not a gate. Wiring it into CI
    # would turn every legitimate exception into a broken build.
    return 0


if __name__ == "__main__":
    sys.exit(main())

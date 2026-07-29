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


CHECKS = {
    "screen-grid": check_screen_grid,
    "screen-table": check_screen_table,
    "field-track": check_field_track,
    "editor-clone": check_editor_clone,
    "text-size-noop": check_text_size_noop,
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

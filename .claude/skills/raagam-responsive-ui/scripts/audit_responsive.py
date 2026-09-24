#!/usr/bin/env python3
"""Flag hand-rolled patterns that break a Raagam screen on a phone or a small laptop.

    python .claude/skills/raagam-responsive-ui/scripts/audit_responsive.py            # app/ + components/
    python .claude/skills/raagam-responsive-ui/scripts/audit_responsive.py <paths...> # files or dirs
    python .claude/skills/raagam-responsive-ui/scripts/audit_responsive.py --changed  # vs master + working tree
    ... --check wide-fixed --check raw-table   # only these
    ... --strict                               # exit 1 on any finding (default: advisory, exit 0)

WHAT IT IS FOR. Responsiveness in this repo lives in the primitives (DataTable,
ChildGrid, FieldRow/Field, Sheet, FilterBar, Tabs, MasterFullScreen). A screen built
from them is responsive without a single `sm:` class. What breaks on a phone is the
code that hand-rolls one of them — and that code has recognisable shapes. This script
finds those shapes. Its findings are CANDIDATES: read each one; exempt the legitimate
ones with a reason.

EXEMPTIONS
    // responsive: exempt -- <reason>        on the flagged line or the line above it
    // responsive-file: exempt -- <reason>   anywhere in the file (print views, charts)

Comments are stripped before matching, so prose that DESCRIBES a bad pattern (this
repo documents its history in comments at length) is never flagged. Line numbers are
preserved by the stripper.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

PHONE_PX = 360  # narrowest phone content we design for; wider fixed widths overflow
EXTS = {".tsx", ".jsx", ".ts"}
SKIP_DIRS = {"node_modules", ".next", ".next-verify", ".git", "dist", "out", "coverage"}
DEFAULT_ROOTS = ["app", "components"]

VARIANT = r"(?<![\w:\-/\[])"  # token start with NO variant prefix (no `md:` / `@lg/x:` before it)


# ---------------------------------------------------------------- comment stripping

def strip_comments(src: str) -> str:
    """Blank out // and /* */ comments, keeping newlines so line numbers survive.

    Strings and template literals are respected, so `"http://..."` and a `//` inside a
    className are left alone.
    """
    out = []
    i, n = 0, len(src)
    quote = None  # current string delimiter
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            # A '…' / "…" string cannot span lines, so a newline ends one. That is what
            # stops an apostrophe in JSX text ("Don't …") from swallowing the file.
            if c == quote or (c == "\n" and quote != "`"):
                quote = None
            i += 1
            continue
        if c in "\"'`":
            quote = c
            out.append(c)
            i += 1
            continue
        if src.startswith("/*", i):
            end = src.find("*/", i + 2)
            end = n if end == -1 else end + 2
            out.append(re.sub(r"[^\n]", " ", src[i:end]))
            i = end
            continue
        if src.startswith("//", i):
            end = src.find("\n", i)
            end = n if end == -1 else end
            out.append(" " * (end - i))
            i = end
            continue
        out.append(c)
        i += 1
    return "".join(out)


# ---------------------------------------------------------------- checks

def _px(value: float, unit: str) -> float:
    return value * 16 if unit == "rem" else value


RE_DYNAMIC = re.compile(r"(?:^|[\s\"'`{])(?:sm|md|lg|xl|2xl|max-\w+|@[\w\-\[\]]+(?:/[\w\-]+)?):[^\s\"'`]*\$\{")
RE_JS_BP = re.compile(
    r"innerWidth\s*[<>]=?\s*\d|\d\s*[<>]=?\s*window\.innerWidth"
    r"|matchMedia\(\s*[\"'`]\s*\(\s*(?:min|max)-width"
)
RE_WIDE_ARB = re.compile(VARIANT + r"(min-w|w)-\[(\d+(?:\.\d+)?)(px|rem)\]")
RE_WIDE_SCALE = re.compile(VARIANT + r"(min-w|w)-(\d+)(?![\w\-\[/.])")
RE_GRID_N = re.compile(VARIANT + r"grid-cols-(\d+)\b")
RE_GRID_ARB = re.compile(VARIANT + r"grid-cols-\[([^\]]+)\]")
RE_OPACITY0 = re.compile(VARIANT + r"opacity-0\b")


def check_dynamic_class(lines, code, path):
    for no, line in enumerate(lines, 1):
        if RE_DYNAMIC.search(line):
            yield no, "breakpoint/container variant built in a template literal -- Tailwind scans source, so this compiles to NO CSS; use a map of literal classes"


def check_js_breakpoint(lines, code, path):
    for no, line in enumerate(lines, 1):
        if RE_JS_BP.search(line):
            yield no, "layout chosen by a JS width check -- hydration mismatch + a second breakpoint; use md: or a container query (pointer/hover queries are fine)"


RE_CAPPED = re.compile(VARIANT + r"max-w-(?:full|screen|\[\d+(?:\.\d+)?(?:vw|%)\]|\[calc)")


def check_wide_fixed(lines, code, path):
    for no, line in enumerate(lines, 1):
        if RE_CAPPED.search(line):
            continue  # `w-[64rem] max-w-full` already gives way on a phone
        for m in RE_WIDE_ARB.finditer(line):
            px = _px(float(m.group(2)), m.group(3))
            if px > PHONE_PX:
                yield no, f"unprefixed {m.group(0)} (~{px:.0f}px) is wider than a phone -- use w-full max-w-[..], a Field w= step, or prefix it (md:/@..:)"
        for m in RE_WIDE_SCALE.finditer(line):
            px = int(m.group(2)) * 4
            if px > PHONE_PX:
                yield no, f"unprefixed {m.group(0)} (~{px}px) is wider than a phone -- prefix it (md:/sm:) or cap it (max-w-)"


def check_bare_grid_cols(lines, code, path):
    for no, line in enumerate(lines, 1):
        for m in RE_GRID_N.finditer(line):
            if int(m.group(1)) >= 3:
                yield no, f"unprefixed {m.group(0)} forces {m.group(1)} columns on a phone -- grid-cols-1 sm:grid-cols-2 md:{m.group(0)}, or FieldRow/Field"
        for m in RE_GRID_ARB.finditer(line):
            tracks = m.group(1)
            fixed = re.findall(r"(\d+(?:\.\d+)?)(px|rem)", tracks)
            total = sum(_px(float(v), u) for v, u in fixed)
            if "repeat(" in tracks or len(tracks.split("_")) >= 3 and total > PHONE_PX * 0.6 or total > PHONE_PX:
                yield no, f"unprefixed {m.group(0)} -- a fixed multi-track row on a phone; stack below md: / a container query"


def check_hover_only(lines, code, path):
    for no, line in enumerate(lines, 1):
        if "group-hover:opacity-100" in line and RE_OPACITY0.search(line) and "focus" not in line:
            yield no, "control hidden until hover -- invisible on touch; use md:opacity-0 md:group-hover:opacity-100 + focus-within:opacity-100"


MOBILE_ALT = re.compile(r"md:hidden|MobileCardList|renderMobileRow|overflow-x-auto|@container")


def check_raw_table(lines, code, path):
    if "<table" not in code or MOBILE_ALT.search(code):
        return
    for no, line in enumerate(lines, 1):
        if "<table" in line:
            yield no, "raw <table> with no phone alternative -- use DataTable / ChildGrid, or give it cards below md (a read-only report may use overflow-x-auto)"
            return


RE_FLEX_OPEN = re.compile(r"^(\s*)<div\b[^>]*className=[\"'`{][^>]*(?<![\w\-:])flex(?![\w\-])")  # `flex`, not `flex-1` / `md:flex`


def check_nowrap_toolbar(lines, code, path):
    for idx, line in enumerate(lines):
        m = RE_FLEX_OPEN.match(line)
        if not m:
            continue
        cls = line
        if "</div>" in line or re.search(r"/>\s*$", line):
            continue  # opened and closed on one line -- nothing beneath it to count
        if re.search(r"flex-wrap|flex-col|(?<![\w:])hidden\b|inline-flex|overflow-x-auto", cls):
            continue
        indent = m.group(1)
        buttons = 0
        for j in range(idx + 1, min(idx + 60, len(lines))):
            nxt = lines[j]
            if nxt.startswith(indent + "</div>") and len(nxt) - len(nxt.lstrip()) == len(indent):
                break
            buttons += len(re.findall(r"<(?:Button|DataIoToolbar|a)\b", nxt))
        if buttons >= 4:
            yield idx + 1, f"flex row holding {buttons} buttons with no flex-wrap -- pushes off a 360px screen; add flex-wrap gap-2"


CHECKS = {
    "dynamic-class": check_dynamic_class,
    "js-breakpoint": check_js_breakpoint,
    "wide-fixed": check_wide_fixed,
    "bare-grid-cols": check_bare_grid_cols,
    "hover-only": check_hover_only,
    "raw-table": check_raw_table,
    "nowrap-toolbar": check_nowrap_toolbar,
}

# The primitives that DEFINE the responsive behaviour legitimately write the raw
# classes everyone else must not. Skipping them is not hiding a problem: a bug there
# is a primitive bug, found by looking at the screen, and fixed once.
PRIMITIVES = {
    "components/ui/data-table.tsx",
    "components/ui/data-table-frame.tsx",
    "components/masters/child-grid.tsx",
    "components/ui/sheet.tsx",
    "components/masters/master-full-screen.tsx",
    "components/masters/mobile-card-list.tsx",
    "components/ui/filter-bar.tsx",
    "components/ui/filter-drawer.tsx",
    "components/ui/tabs.tsx",
}


# ---------------------------------------------------------------- driver

def exempt_lines(raw_lines, code_lines):
    """The marker exempts its own line; a marker on a COMMENT-ONLY line (no code left
    once comments are stripped) exempts the line below it instead. A trailing marker on
    a line of code must not also exempt the next, unrelated line."""
    ex = set()
    for no, line in enumerate(raw_lines, 1):
        if "responsive: exempt" in line:
            ex.add(no)
            if not re.sub(r"[{}\s]", "", code_lines[no - 1]):
                ex.add(no + 1)
    return ex


def iter_files(root: Path, targets):
    for t in targets:
        p = (root / t) if not Path(t).is_absolute() else Path(t)
        if p.is_file():
            if p.suffix in EXTS:
                yield p
        elif p.is_dir():
            for f in p.rglob("*"):
                if f.suffix in EXTS and not SKIP_DIRS.intersection(f.parts):
                    yield f


def changed_files(root: Path, base: str):
    names = set()
    cmds = [
        ["git", "diff", "--name-only", f"{base}...HEAD"],
        ["git", "diff", "--name-only"],
        ["git", "diff", "--name-only", "--cached"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ]
    for cmd in cmds:
        try:
            out = subprocess.run(cmd, cwd=root, capture_output=True, text=True, check=False).stdout
        except OSError:
            continue
        names.update(l.strip() for l in out.splitlines() if l.strip())
    return sorted(n for n in names if Path(n).suffix in EXTS and (root / n).is_file())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*", help="files or directories (default: app components)")
    ap.add_argument("--root", default=".", help="repo root (default: cwd)")
    ap.add_argument("--changed", action="store_true", help="only files changed vs --base, staged, unstaged or untracked")
    ap.add_argument("--base", default="master")
    ap.add_argument("--check", action="append", choices=sorted(CHECKS), help="run only these (repeatable)")
    ap.add_argument("--strict", action="store_true", help="exit 1 if anything is found")
    ap.add_argument("--include-primitives", action="store_true", help="also scan the primitives that define the responsive rules")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if args.changed:
        targets = changed_files(root, args.base)
        if not targets:
            print("no changed .ts/.tsx files")
            return 0
    else:
        targets = args.paths or DEFAULT_ROOTS
    checks = {k: CHECKS[k] for k in (args.check or CHECKS)}

    findings = []
    scanned = 0
    for f in sorted(set(iter_files(root, targets))):
        try:
            rel = f.resolve().relative_to(root).as_posix()
        except ValueError:
            rel = f.as_posix()
        if rel in PRIMITIVES and not args.include_primitives:
            continue
        raw = f.read_text(encoding="utf-8", errors="replace")
        if "responsive-file: exempt" in raw:
            continue
        scanned += 1
        code = strip_comments(raw)
        lines = code.split("\n")
        ex = exempt_lines(raw.split("\n"), lines)
        for name, fn in checks.items():
            for no, msg in fn(lines, code, rel):
                if no not in ex:
                    findings.append((rel, no, name, msg))

    for rel, no, name, msg in findings:
        print(f"{rel}:{no}  [{name}]  {msg}")
    counts = {k: 0 for k in checks}
    for _, _, name, _ in findings:
        counts[name] += 1
    print()
    print(f"scanned {scanned} files -- " + ", ".join(f"{k}: {v}" for k, v in counts.items()))
    print(f"total: {len(findings)} finding(s)" + ("" if findings else " -- clean"))
    return 1 if (args.strict and findings) else 0


if __name__ == "__main__":
    sys.exit(main())

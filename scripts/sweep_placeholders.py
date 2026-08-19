#!/usr/bin/env python3
"""Propose, review, then apply the de-clutter sweep for on-screen hint text.

    python scripts/sweep_placeholders.py .                    # write the review file
    python scripts/sweep_placeholders.py . --apply            # apply what was ticked
    python scripts/sweep_placeholders.py . --module masters   # one batch at a time

THE RULE  (doc/ui/LAYOUT.md §3 "An unfilled field shows NOTHING", §6)

Text that merely DESCRIBES a field or a box is removed. Text that names a STATE
of the record, or a CAUSE the operator can act on somewhere else, is kept and
gets a `placeholder-blank: exempt -- <reason>` comment so the reasoning survives
in the file and `--check placeholder-blank` stays clean.

WHY A REVIEW FILE  (the pattern is scripts/mine-name-vocabularies.mts)

That script's header states the principle this one inherits: "Nothing reaches an
operator un-reviewed." **The POLARITY is inverted here, deliberately.** The vocab
miner defaults to reject because ADDING a name is the risky act; here REMOVING is
the act, and the client has already ruled "remove all, keep the named
state-carrying ones". So every occurrence is listed with a box:

    - [ ]  removed on --apply
    - [x]  KEPT, and stamped with an exemption comment

Buckets D (names a state) and E (a dynamic expression) are pre-ticked, because
those are the two the machine must not decide. On the Garment Order screen four
of eight placeholders were dynamic and every one turned out to be a legitimate
"empty and explain" state -- an auto-remove would have been wrong eight times out
of eight on the half it could not read.

WHY THIS IS PYTHON AND NOT .mts

The scanning helpers below are IMPORTED from scripts/audit_layout.py rather than
re-written: `strip_comments` (this codebase documents its own past bugs in
comments, so a raw scan finds the bug description and "fixes" it),
`_component_open_tag` (every `<ChildGrid<Row>` call site carries a TS generic and
a plain tag scan ends at the `>` that closes it), `_tag_prop_offset` (depth-0
props only, or a nested `renderMobileRow={... <Field label={...}> ...}` reads as
the outer component's prop) and `exempt_above`. Each of those encodes a bug this
repo actually shipped. A TypeScript port would be a second copy free to drift
from the checker that has to agree with it.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from dataclasses import dataclass, field as dc_field
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
REVIEW_FILE = HERE / "out" / "placeholder-proposals.md"


def _load_audit():
    """Import audit_layout.py as a module so its helpers are reused, not copied."""
    spec = importlib.util.spec_from_file_location("audit_layout", HERE / "audit_layout.py")
    mod = importlib.util.module_from_spec(spec)
    # dataclass resolves its module via sys.modules; without this the import of
    # audit_layout's own @dataclass blows up with a bare AttributeError.
    sys.modules["audit_layout"] = mod
    spec.loader.exec_module(mod)
    return mod


al = _load_audit()


# ---------------------------------------------------------------------------
# What is NOT in scope. Each line is a decision with a document behind it.

# The primitives DEFAULT the empty state and forward the caller's prop. They are
# the declaration, not a call site -- and all three are already correct today:
# Combobox `placeholder = ""`, Select `placeholder={placeholder ?? ""}`,
# DataPicker `placeholder ?? ""`.
OWNERS = {
    "components/ui/input.tsx",
    "components/ui/textarea.tsx",
    "components/ui/select.tsx",
    "components/ui/data-picker.tsx",
    "components/ui/combobox.tsx",
    "components/ui/multi-select.tsx",
    "components/ui/field.tsx",
    "components/masters/child-grid.tsx",
    "components/ui/filter-bar.tsx",
    "components/ui/data-table.tsx",
}

# ONE COPY OF THE RULES, shared with scripts/audit_layout.py's
# `placeholder-blank` check. See scripts/hint_rules.py for why it is a third
# module rather than living in either reader.
from hint_rules import (            # noqa: E402
    BARE_LABEL_OPTION,
    BUCKETS,
    FILTER_OPTION,
    KEEP_BY_DEFAULT,
    SEARCH_TEXT,
    STATE_PHRASE,
    _norm,
    classify_hint,
    governing_label,
    hint_attr_span,
    is_jsx_attribute,
)


@dataclass
class Hit:
    kind: str          # "placeholder" | "empty" | "option"
    slug: str
    line: int
    text: str          # the literal, or the expression source
    bucket: str
    dynamic: bool
    label: str | None = None   # the governing label, when one was resolved
    reason: str = ""
    keep: bool = False
    tags: list[str] = dc_field(default_factory=list)


# ---------------------------------------------------------------------------
# Scanning

PLACEHOLDER_EXEMPT = re.compile(r"placeholder-blank:\s*exempt\s*--")
DATATABLE_OPEN = re.compile(r"<DataTable\b")
OPTION_BLANK = re.compile(r'<option value="">([^<]+)</option>')


def scan_file(path: Path, root: Path) -> list[Hit]:
    slug = al.rel(path, root)
    if slug in OWNERS or slug in al.PRIMITIVES:
        return []
    raw = path.read_text(encoding="utf-8", errors="replace")
    code = al.strip_comments(raw)
    exempt = {al.line_of(raw, m.start()) for m in PLACEHOLDER_EXEMPT.finditer(raw)}
    commentish = al.comment_only_lines(raw, code)
    hits: list[Hit] = []

    for m in re.finditer(r"\bplaceholder\s*=", code):
        at = m.start()
        line = al.line_of(code, at)
        if al.exempt_above(exempt, commentish, line):
            continue
        if not is_jsx_attribute(code, at):
            continue
        # `searchPlaceholder` needs no guard of its own here: the scan pattern is
        # `\bplaceholder`, and there is no word boundary between "h" and "P" (nor
        # does the case match), so it cannot fire inside that identifier. A search
        # box written as a plain `placeholder="Search customers..."` IS caught,
        # just below, by its words rather than by its prop name.
        try:
            _, _, src, dyn = hint_attr_span(code, at)
        except ValueError:
            continue
        if not dyn and SEARCH_TEXT.match(src):
            continue                      # a search box, by its words -- see SEARCH_TEXT
        bucket, reason = classify_hint(src, governing_label(code, at), dyn)
        hits.append(Hit("placeholder", slug, line, src, bucket, dyn,
                        governing_label(code, at), reason, bucket in KEEP_BY_DEFAULT))

    for m in DATATABLE_OPEN.finditer(code):
        tag = al._component_open_tag(code, m.start(), "DataTable")
        off = al._tag_prop_offset(tag, "empty")
        if off is None:
            continue
        at = al._component_tag_start(code, m.start(), "DataTable") + off
        line = al.line_of(code, at)
        if al.exempt_above(exempt, commentish, line):
            continue
        try:
            _, _, src, dyn = hint_attr_span(code, at)
        except ValueError:
            continue
        # A LIST IS NOT A FIELD, and the test is different because of it.
        # LAYOUT.md's own reason a table CELL keeps its dash -- a column of blanks
        # is ambiguous with one that failed to load -- applies to a whole table
        # too. So the question here is not "does this describe the box" but
        # DOES IT SAY ANYTHING BEYOND "THERE ARE NONE":
        #   - names the cause ("...match your filter")
        #   - tells the operator what to do next ("Add one to get started")
        #   - reports a POSITIVE state ("All entries are confirmed.") -- which is
        #     not an empty state at all, it is the good outcome
        #   - carries an explaining clause after a dash or a full stop
        # Only a bare restatement ("No line items.") goes.
        explains = (
            re.search(r"\b(filters?|match(es|ing)?|search|selected)\b", src, re.I)
            or re.search(r"\b(add|use|confirm|clear|create|assign|first|start)\b", src, re.I)
            or re.match(r"\s*all\b", src, re.I)
            or re.search(r"[—–-]\s+\w|\.\s+\w", src)
        )
        if dyn or explains or STATE_PHRASE.search(src):
            bucket, reason, keep = "D", "says more than 'there are none', so a blank table is not ambiguous", True
        else:
            bucket, reason, keep = "C", "a bare restatement that the list is empty", False
        hits.append(Hit("empty", slug, line, src, bucket, dyn, None, reason, keep))

    for m in OPTION_BLANK.finditer(code):
        txt = m.group(1).strip()
        if not txt:
            continue
        line = al.line_of(code, m.start())
        if al.exempt_above(exempt, commentish, line):
            continue
        # `parseOptions` in select.tsx takes this text as the CONTROL'S
        # placeholder, which is why it belongs in this sweep at all.
        if FILTER_OPTION.match(txt):
            continue                      # a filter's real selection
        if _norm(txt) in BARE_LABEL_OPTION:
            continue                      # the only label the control has
        if txt.startswith("{"):
            bucket, reason, keep = "E", "a computed option label", True
        elif STATE_PHRASE.search(txt):
            bucket, reason, keep = "D", "names a state of the data", True
        else:
            bucket, reason, keep = "C", "a prompt; the label above already names the field", False
        hits.append(Hit("option", slug, line, txt, bucket, False, None, reason, keep))

    return hits


def module_of(slug: str) -> str:
    m = re.match(r"app/\(app\)/([^/]+)/", slug)
    if m:
        return m.group(1)
    m = re.match(r"components/([^/]+)/", slug)
    return f"components-{m.group(1)}" if m else "other"


# ---------------------------------------------------------------------------
# The review file

HEADER = """# Placeholder / hint-text sweep — proposals

Generated by `python scripts/sweep_placeholders.py .`. **Nothing is applied until you
run `--apply`.**

## How to read this

The rule is `doc/ui/LAYOUT.md` §3 — *an unfilled field shows NOTHING*. Text that
describes a field goes; text that names a **state of the record**, or a **cause you
can act on elsewhere**, stays.

**A ticked box is KEPT.** This is the opposite polarity to `mine:vocab`, on purpose:
there, adding a word was the risky act, so nothing shipped unticked. Here REMOVING is
the act, and the instruction was "remove all, keep the named state-carrying ones" — so
an unticked line is removed and a ticked one is kept and stamped with an exemption
comment carrying the reason beside it.

    - [ ] `Style name`      <- will be REMOVED
    - [x] `No projection`   <- will be KEPT, and exempted

Buckets **D** and **E** arrive pre-ticked, because those are the two a machine must not
decide. Everything else arrives unticked. Change any box you disagree with, then:

    python scripts/sweep_placeholders.py . --apply

To override the recorded reason, write your own after ` :: ` on the line.

Already out of scope and not listed: search boxes (`searchPlaceholder`, and the picker's
own `Search <noun>…`), `All …` / `Any` filter options, and the four blank options that
are the only label their control has (`Item`, `UOM`, `Material`, `Account`).
"""


def render(hits: list[Hit]) -> str:
    out = [HEADER]
    by_mod: dict[str, list[Hit]] = {}
    for h in hits:
        by_mod.setdefault(module_of(h.slug), []).append(h)

    out.append("\n## Summary\n")
    out.append("| bucket | meaning | count | default |")
    out.append("|---|---|---:|---|")
    for b, desc in BUCKETS.items():
        n = sum(1 for h in hits if h.bucket == b)
        out.append(f"| {b} | {desc} | {n} | {'KEEP' if b in KEEP_BY_DEFAULT else 'remove'} |")
    out.append(f"\n**{len(hits)} occurrences in {len({h.slug for h in hits})} files.**\n")

    for mod in sorted(by_mod, key=lambda m: -len(by_mod[m])):
        rows = by_mod[mod]
        out.append(f"\n## MODULE {mod}  ({len(rows)})\n")
        for slug in sorted({r.slug for r in rows}):
            out.append(f"\n### {slug}\n")
            for h in sorted((r for r in rows if r.slug == slug), key=lambda r: r.line):
                box = "x" if h.keep else " "
                shown = h.text if len(h.text) <= 70 else h.text[:67] + "..."
                shown = shown.replace("`", "'").replace("\n", " ")
                out.append(
                    f"- [{box}] L{h.line} `{h.kind}` — `{shown}`  \n"
                    f"      _{h.bucket}: {h.reason}_"
                )
    return "\n".join(out) + "\n"


LINE_RX = re.compile(r"^- \[([ xX])\] L(\d+) `(\w+)`")
FILE_RX = re.compile(r"^### (\S+)")


def parse_review(text: str) -> dict[tuple[str, int], tuple[bool, str]]:
    """(slug, line) -> (keep, reason). Mirrors mine:vocab's --apply round-trip."""
    out: dict[tuple[str, int], tuple[bool, str]] = {}
    slug = None
    for line in text.split("\n"):
        fm = FILE_RX.match(line)
        if fm:
            slug = fm.group(1)
            continue
        lm = LINE_RX.match(line)
        if not lm:
            continue
        if slug is None:
            raise SystemExit(f"--apply: a ticked line appears before any '### <file>' heading: {line}")
        keep = lm.group(1).lower() == "x"
        reason = line.split(" :: ", 1)[1].strip() if " :: " in line else ""
        out[(slug, int(lm.group(2)))] = (keep, reason)
    return out


# ---------------------------------------------------------------------------
# Applying
#
# Edits run BOTTOM-UP within a file, so an earlier edit never shifts the offsets
# of a later one. Every edit re-derives its span from the file as it is on disk
# at that moment -- the tree is shared with another agent session, and one `tsc`
# run in this repo has already reported an error against a version that had been
# overwritten mid-run.

def _line_start(text: str, line: int) -> int:
    idx = 0
    for _ in range(line - 1):
        idx = text.index("\n", idx) + 1
    return idx


def _remove_attr(raw: str, code: str, line: int, name: str, expect: str | None = None) -> str | None:
    """Drop `name=<value>` on `line`. Returns the new text, or None if not found.

    When the attribute is ALONE on its line the whole line goes; otherwise only
    the attribute and one adjoining space, so a same-line neighbour is untouched.

    `expect` IS THE STALE-LINE GUARD, and it is not paranoia here. The scan
    records line numbers, `--apply` edits later, and ANOTHER AGENT SESSION is
    writing to this same tree -- during this work one `tsc` run reported an error
    against a version of a file that had already been overwritten. If the line
    has moved, the value found will not be the value proposed, and the edit is
    refused rather than applied somewhere it was never reviewed.
    """
    ls = _line_start(code, line)
    le = code.find("\n", ls)
    le = len(code) if le == -1 else le
    m = re.search(rf"\b{name}\s*=", code[ls:le])
    if not m:
        return None
    at = ls + m.start()
    try:
        s, e, found, _ = hint_attr_span(code, at)
    except ValueError:
        return None
    if expect is not None and found.strip() != expect.strip():
        return None
    # Widen to the full line(s) when nothing else shares them.
    line_end = raw.find("\n", e)
    line_end = len(raw) if line_end == -1 else line_end + 1
    if raw[ls:s].strip() == "" and raw[e:line_end].strip() == "":
        return raw[:ls] + raw[line_end:]
    pad = 1 if s > 0 and raw[s - 1] == " " else 0
    return raw[: s - pad] + raw[e:]


def _stamp_exempt(raw: str, code: str, line: int, reason: str) -> str:
    """Put a `placeholder-blank: exempt` comment above `line`, at its indent."""
    ls = _line_start(raw, line)
    indent = re.match(r"[ \t]*", raw[ls:]).group(0)
    body = f"placeholder-blank: exempt -- {reason}"
    wrapped, cur = [], indent + "/* "
    for word in body.split():
        if len(cur) + len(word) + 1 > 92 and cur.strip() not in ("/*",):
            wrapped.append(cur.rstrip())
            cur = indent + "   " + word + " "
        else:
            cur += word + " "
    wrapped.append(cur.rstrip() + " */")
    return raw[:ls] + "\n".join(wrapped) + "\n" + raw[ls:]


def _blank_option(raw: str, line: int) -> str | None:
    """`<option value="">Text</option>` -> `<option value=""></option>`.

    NEVER delete the element. `select.tsx` derives `clearable={hasEmpty}` from a
    blank-valued option being present, so removing the node silently takes the
    control's clear button away with it.
    """
    ls = _line_start(raw, line)
    le = raw.find("\n", ls)
    le = len(raw) if le == -1 else le
    seg = raw[ls:le]
    new = OPTION_BLANK.sub('<option value=""></option>', seg)
    return raw[:ls] + new + raw[le:] if new != seg else None


def apply_decisions(root: Path, decisions, hits: list[Hit], dry: bool) -> tuple[int, int, list[str]]:
    removed = kept = 0
    notes: list[str] = []
    by_file: dict[str, list[Hit]] = {}
    for h in hits:
        if (h.slug, h.line) in decisions:
            by_file.setdefault(h.slug, []).append(h)

    for slug, rows in sorted(by_file.items()):
        path = root / slug
        raw = path.read_text(encoding="utf-8", errors="replace")
        for h in sorted(rows, key=lambda r: -r.line):
            keep, override = decisions[(h.slug, h.line)]
            code = al.strip_comments(raw)
            if keep:
                # A COMMENT IS ONLY WRITTEN WHEN A HUMAN WROTE THE REASON.
                # Stamping all 447 keepers with a machine-generated sentence would
                # put text in the file that READS like a considered justification
                # and is not one -- the same failure as a red `*` with nothing
                # behind it. A keeper with no `:: reason` is simply left alone;
                # the CHECK is what is taught to stop asking about it (see the
                # shared classifier note in scripts/hint_text_rules.py).
                if override:
                    raw = _stamp_exempt(raw, code, h.line, override)
                    kept += 1
            elif h.kind == "option":
                new = _blank_option(raw, h.line)
                if new is None:
                    notes.append(f"{slug}:{h.line} option text moved; skipped")
                    continue
                raw, _ = new, None
                removed += 1
            else:
                attr = "empty" if h.kind == "empty" else "placeholder"
                new = _remove_attr(raw, code, h.line, attr, expect=h.text)
                if new is None:
                    notes.append(f"{slug}:{h.line} {attr} moved or changed since the scan; SKIPPED")
                    continue
                raw = new
                removed += 1
        if not dry:
            path.write_text(raw, encoding="utf-8")
    return removed, kept, notes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=Path)
    ap.add_argument("--apply", action="store_true", help="apply what the review file says")
    ap.add_argument("--dry-run", action="store_true", help="with --apply: report, write nothing")
    ap.add_argument("--module", action="append",
                    help="limit to one module batch, e.g. --module masters (repeatable)")
    args = ap.parse_args()
    root = args.root.resolve()

    hits: list[Hit] = []
    for path in al.iter_sources(root):
        if path.suffix != ".tsx":
            continue
        hits.extend(scan_file(path, root))
    if args.module:
        want = {m.lower() for m in args.module}
        hits = [h for h in hits if module_of(h.slug).lower().replace("components-", "") in want
                or module_of(h.slug).lower() in want]

    if not args.apply:
        REVIEW_FILE.parent.mkdir(parents=True, exist_ok=True)
        REVIEW_FILE.write_text(render(hits), encoding="utf-8")
        print(f"wrote {REVIEW_FILE}")
        print(f"  {len(hits)} occurrences in {len({h.slug for h in hits})} files")
        for b, desc in BUCKETS.items():
            n = sum(1 for h in hits if h.bucket == b)
            print(f"    {b}  {desc:<52} {n:>4}  {'KEEP' if b in KEEP_BY_DEFAULT else 'remove'}")
        print("\nReview the boxes, then re-run with --apply. A TICKED box is KEPT.")
        return 0

    if not REVIEW_FILE.exists():
        print(f"--apply: {REVIEW_FILE} does not exist. Run without --apply first, "
              f"review the boxes, then re-run with --apply.", file=sys.stderr)
        return 2
    decisions = parse_review(REVIEW_FILE.read_text(encoding="utf-8"))
    removed, kept, notes = apply_decisions(root, decisions, hits, args.dry_run)
    print(f"{'DRY RUN: ' if args.dry_run else ''}removed {removed}, kept+exempted {kept}")
    for n in notes:
        print(f"  ! {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

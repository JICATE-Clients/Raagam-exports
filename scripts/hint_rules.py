#!/usr/bin/env python3
"""The hint-text rule set -- ONE COPY, TWO READERS.

`scripts/audit_layout.py` (the `placeholder-blank` check) and
`scripts/sweep_placeholders.py` (the propose/apply codemod) must agree about what
counts as clutter. If they drift, the checker reports things the sweep has
already decided to keep, and a check nobody can read as a gate is worse than no
check -- the same "0 findings means nothing" failure this repo has hit three
times, one step along.

They cannot simply import each other: the sweep already imports the audit for its
file-walking helpers, so putting the rules in the audit would make a cycle. Hence
a third module that depends on neither.

THE RULE is doc/ui/LAYOUT.md §3 "An unfilled field shows NOTHING" and §6.
Text that DESCRIBES a field or a box goes; text that names a STATE of the record,
or a CAUSE the operator can act on elsewhere, stays.
"""

from __future__ import annotations

import re


# A SEARCH BOX KEEPS ITS WORDS. Documented twice: LAYOUT.md §3 ("the picker's
# noun ... still names the panel, the search box"), and AGENTS.md §CAPITALS,
# which exempts a search box because a query is not a stored value.
#
# TWO SPELLINGS, and the second is the one that nearly got swept. `\bplaceholder`
# does not match inside `searchPlaceholder` (no word boundary at "hP", and the
# case differs), so that prop excludes itself. But a list screen's own search box
# is a plain `<Input placeholder="Search applicant…">` -- indistinguishable from
# any other placeholder to the scanner, and the first run put 8 of them in the
# REMOVE pile. A query is not a stored value; the noun is the only thing naming
# the box.
SEARCH_PROPS = ("searchPlaceholder",)
SEARCH_TEXT = re.compile(r"^\s*(search|filter|find)\b", re.I)

# A FILTER FACET KEEPS ITS WORD. LAYOUT.md §3: on a filter, "showing everything"
# is a real selection the operator needs to read; a blank filter dropdown reads
# as broken. ~70 of the 81 blank options in this repo are exactly this.
FILTER_OPTION = re.compile(r"^\s*(all|any)\b", re.I)

# A LABEL THE CONTROL DOES NOT OTHERWISE HAVE. LAYOUT.md §3 names these by hand:
# a few dense inline grid rows use the blank option as the only label, and
# blanking them leaves an unlabelled box.
BARE_LABEL_OPTION = {"item", "uom", "material", "account"}


BUCKETS = {
    "A": "restates its own label",
    "B": "a format example / a hint about the box",
    "C": "a bare verb or prompt",
    "D": "names a STATE of the record, or a CAUSE elsewhere",
    "E": "a dynamic expression -- never decided by the machine",
}
KEEP_BY_DEFAULT = {"D", "E"}

BARE_VERB = re.compile(
    r"^\s*[-—–\s]*(select|choose|pick|enter|type|search|add|set)\b|^\s*[-—–]+\s*$", re.I
)
FORMAT_HINT = re.compile(
    r"^\s*(e\.?g\.?|ex\.?|eg)\b|^\s*\d[\d.,/x× -]*$|max\s+\d+|\bDD/MM|\bYYYY\b|^\s*0\.00\s*$",
    re.I,
)
# Phrases that report a state of the data or point at another screen. These are
# the survivors LAYOUT.md §3 names, generalised.
STATE_PHRASE = re.compile(
    r"\bno\b.*\b(yet|found|linked|declared|projection|conversion)\b"
    r"|\bfirst\b|\bnone\b|\bsame as\b|\bautomatic|\bwill be\b|\bdefaults? to\b"
    r"|\bdeclares no\b|\ball .* \(",
    re.I,
)


# ---------------------------------------------------------------------------
# Finding the governing LABEL, so "restates its own label" can be decided.
#
# Three shapes, and the search is deliberately SHORT in each. A label found ten
# lines away is a guess, and a wrong guess here deletes text the operator needs
# -- so anything unresolved falls through to bucket E (review) rather than to
# "remove". That asymmetry is the whole safety property of this script.

FIELD_LABEL = re.compile(r'<Field\b[^>]*?\blabel="([^"]*)"')
PLAIN_LABEL = re.compile(r'<Label\b[^>]*>([^<]{1,40})</Label>')
COLUMN_HEADER = re.compile(r'^\s*header:\s*"([^"]*)"', re.M)


def governing_label(code: str, offset: int) -> str | None:
    """The label a reader sees directly above this control, or None.

    Searches BACKWARDS a bounded distance only. `<Field label>` and `<Label>` are
    the two form shapes; `header:` is the ChildGridColumn shape, where the
    placeholder sits inside that column's own `cell:` render function and the
    column header is what names it on screen.
    """
    window = code[max(0, offset - 900):offset]
    # The LAST match of any of the three shapes -- the nearest label above the
    # control is the one a reader sees over it. Ties cannot occur: the three
    # regexes match disjoint syntax.
    cands = [
        (m.start(), m.group(1))
        for rx in (FIELD_LABEL, PLAIN_LABEL, COLUMN_HEADER)
        for m in rx.finditer(window)
    ]
    if not cands:
        return None
    return max(cands)[1].strip() or None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def restates(text: str, label: str | None) -> bool:
    """True when the placeholder is the label said again."""
    if not label:
        return False
    t, l = _norm(text), _norm(label)
    if not t or not l:
        return False
    if t == l:
        return True
    # "Style name" under a label of "Style"; "Enter style" under "Style".
    stripped = re.sub(r"^(enter|select|choose|type|pick)\s+", "", t)
    stripped = re.sub(r"\s+(name|no|number|code|value|here)$", "", stripped)
    return stripped == l or t == f"{l} name" or t == f"{l} no"


def classify_hint(text: str, label: str | None, dynamic: bool) -> tuple[str, str]:
    """(bucket, reason). Errs toward REVIEW, never toward removal."""
    if dynamic:
        return "E", "a computed value -- read it before deciding"
    # A BARE NUMBER MAY BE THE BLANK FALLBACK, not a format example -- and that
    # distinction is invisible from the string. On Material BOM Amendment
    # `placeholder="1"` turned out to state what `innersOf` SAVES for an empty
    # cell, so removing it would have hidden a real value; the written rule had
    # named "1" as an obvious goer, on the string alone, and was wrong. Anything
    # numeric therefore goes to review rather than to either pile.
    if re.fullmatch(r"[\d.,]+\s*%?", text.strip()):
        return "E", "a bare number -- may state what a BLANK saves, not a format"
    if STATE_PHRASE.search(text):
        return "D", "reports a state of the data rather than describing the box"
    if restates(text, label):
        return "A", f"repeats the label {label!r} directly above it"
    if BARE_VERB.match(text):
        return "C", "a bare verb; the label and the control already say a value goes here"
    if FORMAT_HINT.search(text):
        return "B", "a format example describing the box"
    if label and _norm(text).startswith(_norm(label)):
        return "A", f"opens with the label {label!r}"
    # Unclassified prose is not automatically clutter.
    return "E", "unclassified -- decide by reading it in place"


def hint_attr_span(code: str, start: int) -> tuple[int, int, str, bool]:
    """(start, end, source, dynamic) of one JSX attribute beginning at `start`.

    `start` points at the attribute NAME. The value is either a quoted string or
    a braced expression which may span lines and nest -- a naive scan to the next
    quote or `}` truncates a ternary and corrupts the file, so both forms are
    walked with a depth/quote state machine.
    """
    i = code.index("=", start) + 1
    while i < len(code) and code[i].isspace():
        i += 1
    if i >= len(code):
        raise ValueError("attribute has no value")
    if code[i] in "\"'":
        q = code[i]
        j = code.index(q, i + 1)
        return start, j + 1, code[i + 1:j], False
    if code[i] != "{":
        raise ValueError("unrecognised attribute value")
    depth, quote, j = 0, None, i
    while j < len(code):
        c = code[j]
        if quote:
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return start, j + 1, code[i + 1:j].strip(), True
        j += 1
    raise ValueError("unterminated expression")


def is_jsx_attribute(code: str, at: str | int) -> bool:
    r"""True when `placeholder` at `at` is a JSX ATTRIBUTE, not a JS binding.

    THIS FUNCTION EXISTS BECAUSE THE SWEEP CORRUPTED A FILE. A component that
    declares its own prop writes the identical characters in a destructuring
    pattern with a default:

        export function TypeOrPick({ label, id, placeholder = "—", ... })

    `\bplaceholder\s*=` matches that, `_attr_span` happily read `= "—"` as a
    string attribute value, and the removal left a bare `,` on the line -- a
    syntax error, caught only because tsc refused to parse the file. The OWNERS
    set guarded the primitives that were known on the day it was written; this is
    a NEW component, and an allow-list cannot cover a file that does not exist
    yet. So the test has to be structural.

    Two signals, either of which is disqualifying, and both err toward SKIPPING
    (a missed placeholder is a cosmetic miss; a corrupted file is not):

      - the previous non-space character is `,` or `{` -- entries in a
        destructuring pattern are comma-separated inside braces, while a JSX
        attribute follows a tag name, another attribute's value, or a spread;
      - the next non-space character after the VALUE is `,` or `}` -- a JSX
        attribute is followed by another attribute, `/`, or `>`, never a comma.
    """
    i = int(at) - 1
    while i >= 0 and code[i].isspace():
        i -= 1
    if i >= 0 and code[i] in ",{":
        return False
    try:
        _, end, _, _ = hint_attr_span(code, int(at))
    except ValueError:
        return False
    j = end
    while j < len(code) and code[j].isspace():
        j += 1
    return not (j < len(code) and code[j] in ",}")

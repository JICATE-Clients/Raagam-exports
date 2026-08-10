#!/usr/bin/env python3
"""
Audit reporting coverage for Raagam ERP.

Sweeps supabase/migrations/*.sql for tables that carry BOTH an item foreign key
and a quantity column — i.e. tables that plausibly record material movement —
and cross-checks them against REPORT_SOURCES in lib/reports/registry.ts.

Anything unregistered is material the reports cannot see. That is the failure
this script exists to catch: a child sub-module gets built, records stock, and
never reaches a report, so the stock reconciles wrongly and nobody finds out.

Findings are heuristics to inspect, not verdicts. A config table that happens to
have a `quantity` column is not a movement source — register it as `gap` with a
note, or leave it and accept the warning.

Usage:  python audit_reports.py <repo-root>
Exit:   0 = nothing unregistered, 1 = unregistered tables found, 2 = bad usage.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ITEM_FK = re.compile(r"^\s*(item_id|used_item_id|component_item_id)\b", re.M)
QTY_COL = re.compile(
    r"^\s*(\w*qty\w*|quantity\w*|\w*_qty)\s+numeric", re.M | re.I
)
CREATE_TABLE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\((.*?)\n\)\s*;",
    re.S | re.I,
)
ALTER_ADD = re.compile(
    r"alter\s+table\s+(?:public\.)?(\w+)\s+(.*?);", re.S | re.I
)
SOURCE_TABLE = re.compile(r"""table:\s*["'](\w+)["']""")
SOURCE_ID = re.compile(r"""\bid:\s*["'](\w+)["']""")


def collect_tables(migrations: Path) -> dict[str, set[str]]:
    """table name -> set of column-ish lines seen across every migration."""
    bodies: dict[str, list[str]] = {}
    for sql in sorted(migrations.glob("*.sql")):
        text = sql.read_text(encoding="utf-8", errors="replace")
        for name, body in CREATE_TABLE.findall(text):
            bodies.setdefault(name, []).append(body)
        for name, body in ALTER_ADD.findall(text):
            bodies.setdefault(name, []).append(body)
    return {k: set(v) for k, v in bodies.items()}


def movement_tables(bodies: dict[str, set[str]]) -> list[str]:
    found = []
    for name, chunks in bodies.items():
        joined = "\n".join(chunks)
        if ITEM_FK.search(joined) and QTY_COL.search(joined):
            found.append(name)
    return sorted(found)


def registered(registry: Path) -> tuple[set[str], set[str]]:
    if not registry.exists():
        return set(), set()
    text = registry.read_text(encoding="utf-8", errors="replace")
    # itemColumn values like "po_line_items.item_id" also name a table
    tables = set(SOURCE_TABLE.findall(text))
    ids = set(SOURCE_ID.findall(text))
    for qualified in re.findall(r"""["'](\w+)\.\w+["']""", text):
        tables.add(qualified)
    return tables, ids


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip())
        return 2

    root = Path(argv[1]).resolve()
    migrations = root / "supabase" / "migrations"
    registry = root / "lib" / "reports" / "registry.ts"

    if not migrations.is_dir():
        print(f"no migrations directory at {migrations}")
        return 2

    bodies = collect_tables(migrations)
    candidates = movement_tables(bodies)
    known_tables, known_ids = registered(registry)
    known = known_tables | known_ids

    unregistered = [t for t in candidates if t not in known]

    print(f"scanned {len(bodies)} tables across {len(list(migrations.glob('*.sql')))} migrations")
    print(f"{len(candidates)} carry an item FK + a quantity column")
    print(f"{len(known_tables)} tables referenced by REPORT_SOURCES\n")

    if not unregistered:
        print("OK — every material-movement table is accounted for in REPORT_SOURCES.")
        return 0

    print("UNREGISTERED — these record material movement but reports cannot see them:\n")
    for t in unregistered:
        print(f"  - {t}")
    print(
        "\nAdd a ReportSource for each in lib/reports/registry.ts.\n"
        "Set status to 'wired' (feeds report_item_movements), 'off_book' (reported\n"
        "but posts no stock movement), or 'gap' (cannot be reported yet — say why\n"
        "in `note`). Declaring a gap is correct; omitting the table is not."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))

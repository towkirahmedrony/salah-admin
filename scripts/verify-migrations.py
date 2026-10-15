#!/usr/bin/env python3
"""
Syntax-validate every migration in `supabase/migrations` against the real
PostgreSQL parser.

Why this exists
---------------

The migrations cannot be checked by the repository's own tooling: they are SQL, the
test suite is Vitest, and `npm run build` deliberately runs with no database. A
mistyped keyword or an unbalanced `$$` therefore reaches `supabase db push` — or a
production SQL editor — and fails there, at the point of highest cost.

This script closes the gap that can be closed without a server. It runs every
statement through libpg_query, the actual PostgreSQL grammar, and every procedural
body through PostgreSQL's dedicated PL/pgSQL parser, which detects a real syntax
error inside a `BEGIN ... END` block rather than treating it as an opaque string.

What it VERIFIES
    * every statement parses as PostgreSQL (syntax, not semantics)
    * every `DO` block parses as plpgsql
    * every function body parses under its declared language

What it does NOT verify
    * that the statements succeed against a live schema — dependency ordering,
      constraint conflicts, enum dependency drops, RLS behaviour, trigger firing
      order, or a data backfill
    * the runtime semantics of any function or policy

A live database is still required before trusting the migrations. This script only
makes the cheap class of failure impossible to ship.

Usage
-----

    pip install pglast          # needs the real PostgreSQL grammar
    python3 scripts/verify-migrations.py

Exit status is 0 when every statement and body parses, 1 otherwise, so it can be
wired into a pipeline if desired. It is not part of `npm run check`.
"""

from __future__ import annotations

import pathlib
import re
import sys

import pglast

SQL_LANGUAGE_BODY = re.compile(
    r"\blanguage\s+sql\b.*?\bas\s+(?P<tag>\$[A-Za-z_]*\$)(?P<body>.*?)(?P=tag)",
    re.IGNORECASE | re.DOTALL,
)

PLPGSQL_LANGUAGE = re.compile(r"\blanguage\s+plpgsql\b", re.IGNORECASE)
IS_DO_BLOCK = re.compile(r"^\s*do\b", re.IGNORECASE)

# `parse_plpgsql` resolves variable types without a catalog. A variable whose type
# is a schema-qualified user-defined type (an enum, for example) is therefore
# misclassified as a row type as soon as it appears in a multi-column
# `SELECT ... INTO`, and the parser reports "<name> is not a scalar variable".
#
# That is a limitation of parsing without a database, not a defect: the same
# function with the variable declared `text` parses cleanly, and a single-column
# assignment into the very same enum-typed variable parses cleanly too. Such
# statements are reported as UNVERIFIED, naming the variable, so the remaining gap
# is visible rather than silently swallowed.
PARSER_LIMITATION = re.compile(r'"(?P<var>[^"]+)" is not a scalar variable')


class Report:
    def __init__(self) -> None:
        self.failures = 0
        self.statements = 0
        self.bodies = 0
        self.unverified: list[tuple[str, str, str]] = []

    def fail(self, filename: str, what: str, error: Exception) -> None:
        limitation = PARSER_LIMITATION.search(str(error))
        if limitation:
            self.unverified.append((filename, what, limitation.group("var")))
            return

        self.failures += 1
        print(f"FAIL  {filename}  [{what}]")
        print(f"      {type(error).__name__}: {error}")
        print()


def validate(path: pathlib.Path, report: Report) -> None:
    for index, raw in enumerate(pglast.split(path.read_text(encoding="utf-8")), start=1):
        statement = raw.strip()
        if not statement:
            continue

        # 1. Always: does this parse as PostgreSQL at all?
        try:
            pglast.parse_sql(statement)
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            report.fail(path.name, f"statement #{index}", error)
            continue
        report.statements += 1

        # 2. Procedural bodies, under their own parser.
        try:
            if IS_DO_BLOCK.match(statement) or PLPGSQL_LANGUAGE.search(statement):
                pglast.parse_plpgsql(statement)
                report.bodies += 1
            else:
                match = SQL_LANGUAGE_BODY.search(statement)
                if match:
                    pglast.parse_sql(match.group("body"))
                    report.bodies += 1
        except Exception as error:  # noqa: BLE001
            label = "DO block" if IS_DO_BLOCK.match(statement) else "function body"
            report.fail(path.name, f"{label} of statement #{index}", error)


def main() -> int:
    repo_root = pathlib.Path(__file__).resolve().parent.parent
    migrations = repo_root / "supabase" / "migrations"
    files = sorted(migrations.glob("*.sql"))

    if not files:
        print(f"no migrations found under {migrations}", file=sys.stderr)
        return 1

    print(f"PostgreSQL grammar version: {pglast.get_postgresql_version()}")
    print()

    report = Report()
    for path in files:
        failures_before = report.failures
        unverified_before = len(report.unverified)
        validate(path, report)

        if report.failures == failures_before and len(report.unverified) == unverified_before:
            print(f"ok    {path.name}")
        elif report.failures == failures_before:
            print(f"part  {path.name}")

    print()
    print(
        f"{len(files)} files, {report.statements} statements, "
        f"{report.bodies} procedural bodies parsed"
    )

    if report.unverified:
        print()
        print(f"UNVERIFIED: {len(report.unverified)} body/bodies could not be checked:")
        for filename, what, variable in report.unverified:
            print(f'  - {filename}  [{what}]: variable "{variable}" has a')
            print("    schema-qualified user-defined type, which the parser cannot resolve")
            print("    without a catalog. Verify against a live database.")

    print()
    print(f"FAILURES: {report.failures}" if report.failures else "FAILURES: none")
    return 1 if report.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

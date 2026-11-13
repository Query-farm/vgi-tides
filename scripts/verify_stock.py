#!/usr/bin/env python3
"""Verify the public SQL contract using signed VGI in stock DuckDB 2.0.0."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile

import duckdb

ROOT = Path(__file__).resolve().parents[1]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--worker", help="Override the executable, for testing a compiled artifact")
    parser.add_argument("--output")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "vgi-worker.json").read_text())
    if duckdb.__version__ != "2.0.0":
        raise RuntimeError(f"Expected stock DuckDB 2.0.0, got {duckdb.__version__}")
    checks = json.loads((ROOT / "test/live-checks.json").read_text()) if args.live else manifest["checks"]
    errors = [] if args.live else json.loads((ROOT / "test/error-checks.json").read_text())
    catalog = manifest["catalog"]
    command = [args.worker] if args.worker else [str(ROOT / manifest["worker"][0]), *manifest["worker"][1:]]
    if args.live:
        # A live check must not accidentally use a leftover fixture endpoint.
        for key in ["TIDES_API_BASE_URL", "TIDES_METADATA_BASE_URL", "BUOYS_BASE_URL"]:
            os.environ.pop(key, None)
    attach = f"ATTACH {quote(catalog)} (TYPE vgi, LOCATION {quote(shlex.join(command))})"
    report = {"engine": "stock DuckDB", "engine_version": duckdb.__version__, "catalog": catalog,
              "mode": "live NOAA" if args.live else "offline fixtures", "attach_sql": attach,
              "verified_at": datetime.now(timezone.utc).isoformat(), "checks": []}
    with tempfile.TemporaryDirectory(prefix=f"vgi-{catalog}-duckdb-") as temporary:
        con = duckdb.connect(config={"extension_repository_directory": str(Path(temporary) / "repositories")})
        try:
            con.execute(f"SET extension_directory={quote(temporary)}")
            con.execute("SET allow_extension_repositories='allowed'")
            con.execute("CREATE EXTENSION REPOSITORY query_farm WITH PREFIX 'https://duckdb-extensions.query.farm'")
            con.execute("INSTALL vgi FROM query_farm")
            con.execute("LOAD vgi FROM query_farm")
            con.execute("INSTALL icu FROM core")
            con.execute("LOAD icu")
            con.execute("SET TimeZone='UTC'")
            report["extension_version"] = con.execute("SELECT extension_version FROM duckdb_extensions() WHERE extension_name='vgi'").fetchone()[0]
            con.execute(attach)
            for check in checks:
                rows = [list(row) for row in con.execute(check["sql"]).fetchall()]
                if rows != check["rows"]:
                    raise AssertionError(f"{check['name']}: expected {check['rows']!r}, got {rows!r}")
                report["checks"].append({"name": check["name"], "passed": True, "rows": rows})
                print(f"PASS {check['name']}", flush=True)
            for check in errors:
                try:
                    con.execute(check["sql"]).fetchall()
                except duckdb.Error as error:
                    if not re.search(check["error"], str(error), re.DOTALL):
                        raise AssertionError(f"Unexpected error for {check['sql']}: {error}") from error
                else:
                    raise AssertionError(f"Expected an error for {check['sql']}")
            report["expected_error_checks"] = len(errors)
        finally:
            con.close()
    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
    print(f"{catalog}: {len(checks)} result checks and {len(errors)} error checks passed; DuckDB {duckdb.__version__}, VGI {report['extension_version']}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
check_benchmarks.py — compare current benchmark output against baseline.

Usage
-----
Pipe the output of `cargo test bench_ -- --nocapture` into this script:

    cd contracts/token-factory
    cargo test bench_ -- --nocapture 2>/dev/null | python3 ../../scripts/check_benchmarks.py

Or pass the baseline file and a pre-collected JSON file explicitly:

    python3 scripts/check_benchmarks.py \\
        --baseline contracts/token-factory/bench_snapshots/baseline.json \\
        --current  /tmp/bench_current.json

Exit codes
----------
0  All entrypoints within threshold (or informational mode).
1  One or more entrypoints regressed beyond the configured threshold.
2  Script error (missing file, parse error, etc.).

Environment variables
---------------------
BENCH_BLOCKING        Set to "1" to promote regressions to hard failures
                      (exit code 1).  Default: informational-only (exit 0).
BENCH_THRESHOLD_PCT   Override the regression threshold percentage.
                      Default: value from baseline JSON (typically 10).
BENCH_BASELINE        Path to baseline JSON (overrides --baseline).
BENCH_CURRENT         Path to current measurements JSON (overrides --current).
"""

import json
import os
import re
import sys
import argparse
from pathlib import Path

# ── constants ──────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASELINE = (
    REPO_ROOT / "contracts" / "token-factory" / "bench_snapshots" / "baseline.json"
)

METRICS = ("cpu_insns", "mem_bytes")

# ANSI colours for terminal output (disabled if not a tty)
RED    = "\033[91m" if sys.stdout.isatty() else ""
YELLOW = "\033[93m" if sys.stdout.isatty() else ""
GREEN  = "\033[92m" if sys.stdout.isatty() else ""
BOLD   = "\033[1m"  if sys.stdout.isatty() else ""
RESET  = "\033[0m"  if sys.stdout.isatty() else ""

# ── helpers ────────────────────────────────────────────────────────────────────

def load_json(path: Path) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[error] File not found: {path}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as e:
        print(f"[error] JSON parse error in {path}: {e}", file=sys.stderr)
        sys.exit(2)


def parse_bench_lines(lines: list[str]) -> dict:
    """Extract BENCH_RESULT JSON objects from cargo test --nocapture output."""
    results: dict[str, dict] = {}
    pattern = re.compile(r"BENCH_RESULT:\s*(\{.*\})")
    for line in lines:
        m = pattern.search(line)
        if m:
            try:
                obj = json.loads(m.group(1))
                label = obj["label"]
                results[label] = obj
            except (json.JSONDecodeError, KeyError):
                continue
    return results


def fmt_num(n: int | float) -> str:
    return f"{n:,.0f}"


def pct_change(old: float, new: float) -> float:
    if old == 0:
        return 0.0
    return (new - old) / old * 100.0


def colour_pct(pct: float, threshold: float) -> str:
    if pct > threshold:
        return f"{RED}{pct:+.1f}%{RESET}"
    elif pct > threshold * 0.5:
        return f"{YELLOW}{pct:+.1f}%{RESET}"
    elif pct < 0:
        return f"{GREEN}{pct:+.1f}%{RESET}"
    else:
        return f"{pct:+.1f}%"


# ── main ───────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare benchmark output against baseline snapshot."
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        default=Path(os.environ.get("BENCH_BASELINE", DEFAULT_BASELINE)),
        help="Path to baseline JSON (default: bench_snapshots/baseline.json)",
    )
    parser.add_argument(
        "--current",
        type=Path,
        default=None,
        help="Path to current measurements JSON (if not provided, reads stdin)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=float(os.environ.get("BENCH_THRESHOLD_PCT", "0")),
        help="Regression threshold %% (0 = use value from baseline JSON)",
    )
    parser.add_argument(
        "--blocking",
        action="store_true",
        default=os.environ.get("BENCH_BLOCKING", "0") == "1",
        help="Exit 1 on regression (default: informational only, exit 0)",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        default=False,
        help="Overwrite baseline.json with current measurements (use with care!)",
    )
    args = parser.parse_args()

    # ── load baseline ─────────────────────────────────────────────────────────
    baseline = load_json(args.baseline)
    baseline_entries: dict = baseline.get("entrypoints", {})
    threshold_pct = args.threshold or float(
        baseline.get("thresholds", {}).get("regression_pct", 10)
    )

    # ── load current ──────────────────────────────────────────────────────────
    if args.current and str(args.current) != "":
        current_data = load_json(args.current)
        # Support two formats: raw bench JSON or the same entrypoints dict.
        if "entrypoints" in current_data:
            current_entries = current_data["entrypoints"]
        else:
            current_entries = current_data
    else:
        # Parse BENCH_RESULT lines from stdin (piped cargo test output).
        stdin_lines = sys.stdin.read().splitlines()
        raw = parse_bench_lines(stdin_lines)
        if not raw:
            print(
                "[warn] No BENCH_RESULT lines found in stdin. "
                "Did you run: cargo test bench_ -- --nocapture ?",
                file=sys.stderr,
            )
            return 0
        # Normalise to the same shape as baseline entrypoints.
        current_entries = {
            label: {k: v for k, v in obj.items() if k != "label"}
            for label, obj in raw.items()
        }

    # ── compare ───────────────────────────────────────────────────────────────
    regressions: list[str] = []
    improvements: list[str] = []
    missing: list[str] = []

    col_w = max((len(k) for k in baseline_entries), default=20) + 2
    header = (
        f"{'Entrypoint':<{col_w}}"
        f"{'CPU baseline':>16}{'CPU current':>14}{'CPU Δ':>10}"
        f"{'Mem baseline':>16}{'Mem current':>14}{'Mem Δ':>10}"
    )
    print(f"\n{BOLD}Benchmark comparison  (threshold: {threshold_pct:.0f}%){RESET}")
    print("─" * len(header))
    print(header)
    print("─" * len(header))

    for label, base_vals in sorted(baseline_entries.items()):
        if label not in current_entries:
            missing.append(label)
            print(f"{label:<{col_w}}  {YELLOW}[missing from current run]{RESET}")
            continue

        cur_vals = current_entries[label]
        row_regressions = []

        cpu_base = base_vals.get("cpu_insns", 0)
        cpu_cur  = cur_vals.get("cpu_insns", 0)
        mem_base = base_vals.get("mem_bytes", 0)
        mem_cur  = cur_vals.get("mem_bytes", 0)

        cpu_delta = pct_change(cpu_base, cpu_cur)
        mem_delta = pct_change(mem_base, mem_cur)

        if cpu_delta > threshold_pct:
            row_regressions.append(
                f"{label}: cpu_insns +{cpu_delta:.1f}% "
                f"({fmt_num(cpu_base)} → {fmt_num(cpu_cur)})"
            )
        if mem_delta > threshold_pct:
            row_regressions.append(
                f"{label}: mem_bytes +{mem_delta:.1f}% "
                f"({fmt_num(mem_base)} → {fmt_num(mem_cur)})"
            )

        regressions.extend(row_regressions)
        if cpu_delta < -threshold_pct or mem_delta < -threshold_pct:
            improvements.append(label)

        print(
            f"{label:<{col_w}}"
            f"{fmt_num(cpu_base):>16}{fmt_num(cpu_cur):>14}"
            f"{colour_pct(cpu_delta, threshold_pct):>10}"
            f"{fmt_num(mem_base):>16}{fmt_num(mem_cur):>14}"
            f"{colour_pct(mem_delta, threshold_pct):>10}"
        )

    print("─" * len(header))

    # Summary
    if missing:
        print(f"\n{YELLOW}[warn] Entrypoints not measured in current run:{RESET}")
        for m in missing:
            print(f"  • {m}")

    if improvements:
        print(f"\n{GREEN}[info] Improvements detected:{RESET}")
        for label in improvements:
            print(f"  ↓ {label}")

    if regressions:
        print(f"\n{RED if args.blocking else YELLOW}[{'ERROR' if args.blocking else 'WARN'}] Regressions detected (>{threshold_pct:.0f}% increase):{RESET}")
        for r in regressions:
            print(f"  ↑ {r}")
        if args.blocking:
            print(
                f"\n{RED}Failing CI because BENCH_BLOCKING=1 and regressions were detected.{RESET}\n"
                "To investigate: run the benchmark locally and compare against baseline.\n"
                "To update the baseline (after confirming the change is intentional):\n"
                "  python3 scripts/check_benchmarks.py --update-baseline\n"
            )
            return 1
        else:
            print(
                f"\n{YELLOW}[info] Informational mode — not failing CI.{RESET}\n"
                "Set BENCH_BLOCKING=1 to promote regressions to hard failures.\n"
            )
    else:
        print(f"\n{GREEN}[ok] No regressions detected.{RESET}")

    # ── optionally update baseline ─────────────────────────────────────────────
    if args.update_baseline:
        if not current_entries:
            print("[error] Cannot update baseline: no current measurements.", file=sys.stderr)
            return 2
        baseline["entrypoints"] = {
            label: {
                "cpu_insns": current_entries[label].get("cpu_insns", 0),
                "mem_bytes": current_entries[label].get("mem_bytes", 0),
                "ledger_reads": current_entries[label].get("ledger_reads", 0),
                "ledger_writes": current_entries[label].get("ledger_writes", 0),
                "notes": baseline_entries.get(label, {}).get("notes", ""),
            }
            for label in current_entries
        }
        with open(args.baseline, "w") as f:
            json.dump(baseline, f, indent=2)
            f.write("\n")
        print(f"\n{GREEN}[ok] Baseline updated at {args.baseline}{RESET}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

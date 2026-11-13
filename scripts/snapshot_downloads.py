#!/usr/bin/env python3
"""Record GitHub release asset download totals and the change since the last snapshot.

GitHub only exposes a lifetime download_count per asset id. Re-uploading a file
creates a new id and the counter starts over, so rows are keyed by asset id.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

TAGS = ("latest-prod", "latest-qa", "latest-preuat", "latest-uat")
FIELDS = ("date", "tag", "asset_id", "name", "downloads", "delta", "prev_date", "created_at")


def repo_root() -> Path:
    out = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True)
    return Path(out.strip())


def repo_slug() -> str:
    slug = os.environ.get("GITHUB_REPOSITORY")
    if slug:
        return slug
    return subprocess.check_output(
        ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        text=True,
    ).strip()


def release_for(repo: str, tag: str) -> dict | None:
    proc = subprocess.run(
        ["gh", "api", f"repos/{repo}/releases/tags/{tag}"],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        return json.loads(proc.stdout)
    if "HTTP 404" in proc.stderr:
        return None
    raise SystemExit(f"failed to read {tag}: {proc.stderr.strip() or proc.stdout.strip()}")


def is_installer(name: str) -> bool:
    lower = name.lower()
    if lower.endswith(".dmg") or lower.endswith(".exe"):
        return True
    return lower.endswith(".zip") and not lower.endswith(".blockmap")


def asset_rank(name: str) -> tuple:
    lower = name.lower()
    if lower.endswith(".dmg"):
        group = 0
    elif lower.endswith(".exe"):
        group = 1
    elif lower.endswith(".zip") and not lower.endswith(".blockmap"):
        group = 2
    elif lower.endswith(".blockmap"):
        group = 3
    elif lower.endswith(".yml") or lower.endswith(".yaml"):
        group = 4
    else:
        group = 5
    return (group, lower)


def load_history(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def has_snapshot(history: list[dict], today: str) -> bool:
    return any(row["date"] == today for row in history)


def prior_snapshot(history: list[dict], asset_id: int, today: str) -> dict | None:
    earlier = [row for row in history if row["asset_id"] == asset_id and row["date"] < today]
    if not earlier:
        return None
    return max(earlier, key=lambda row: row["date"])


def apply_snapshot(history: list[dict], observations: list[dict], today: str) -> list[dict]:
    kept = [row for row in history if row["date"] != today]
    fresh = []
    for obs in observations:
        prior = prior_snapshot(kept, obs["asset_id"], today)
        fresh.append(
            {
                "date": today,
                "tag": obs["tag"],
                "asset_id": obs["asset_id"],
                "name": obs["name"],
                "downloads": obs["downloads"],
                "delta": None if prior is None else obs["downloads"] - prior["downloads"],
                "prev_date": None if prior is None else prior["date"],
                "created_at": obs["created_at"],
            }
        )
    fresh.sort(key=lambda row: (TAGS.index(row["tag"]), asset_rank(row["name"])))
    return kept + fresh


def assert_no_backwards(rows: list[dict], today: str) -> None:
    bad = [
        row
        for row in rows
        if row["date"] == today and row["delta"] is not None and row["delta"] < 0
    ]
    if not bad:
        return
    detail = ", ".join(f"{row['tag']}/{row['name']} ({row['delta']})" for row in bad)
    raise SystemExit(f"download_count went backwards: {detail}")


def collect(repo: str) -> tuple[list[dict], list[str]]:
    observations = []
    missing = []
    for tag in TAGS:
        release = release_for(repo, tag)
        if release is None:
            missing.append(tag)
            continue
        for asset in release.get("assets", []):
            observations.append(
                {
                    "tag": tag,
                    "asset_id": asset["id"],
                    "name": asset["name"],
                    "downloads": asset["download_count"],
                    "created_at": asset["created_at"],
                }
            )
    if len(missing) == len(TAGS):
        raise SystemExit("no latest-* releases found")
    return observations, missing


def dump_row(row: dict) -> str:
    return json.dumps({key: row[key] for key in FIELDS}, separators=(",", ":"))


def delta_cell(delta: int | None) -> str:
    if delta is None:
        return "first seen"
    return str(delta)


def since_cell(prev_date: str | None) -> str:
    if prev_date is None:
        return "—"
    return prev_date


def replace_text(path: Path, text: str) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text)
    temporary.replace(path)


def render_summary(rows: list[dict], missing: list[str], today: str) -> str:
    today_rows = [row for row in rows if row["date"] == today]
    lines = [
        "# Release download counts",
        "",
        f"Snapshot date: {today} (UTC).",
        "",
        "Total is GitHub's lifetime count for that asset id, taken on the snapshot date. New is the change since the previous snapshot of the same id, and Since is that previous snapshot's date. A Since date more than one day earlier means a run was missed and New covers the whole gap. `first seen` means this upload has no earlier snapshot, which is also what a replaced file looks like: the old id stops and the new one starts at zero.",
        "",
        "dmg, exe, and zip are installs and auto-updates. yml files are updater checks. blockmaps are differential-update metadata.",
        "",
    ]
    by_tag: dict[str, list[dict]] = {tag: [] for tag in TAGS}
    for row in today_rows:
        by_tag[row["tag"]].append(row)
    for tag in TAGS:
        lines.append(f"## {tag}")
        lines.append("")
        if tag in missing:
            lines.append("No release published.")
            lines.append("")
            continue
        grouped = by_tag[tag]
        for title, want_installer in (
            ("Installers and update zip", True),
            ("Update metadata", False),
        ):
            subset = [row for row in grouped if is_installer(row["name"]) is want_installer]
            if not subset:
                continue
            lines.append(f"### {title}")
            lines.append("")
            lines.append("| File | Total | New | Since |")
            lines.append("| --- | ---: | ---: | --- |")
            for row in subset:
                lines.append(
                    f"| {row['name']} | {row['downloads']} | {delta_cell(row['delta'])} | {since_cell(row['prev_date'])} |"
                )
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def self_check() -> None:
    dmg = {
        "tag": "latest-prod",
        "asset_id": 1,
        "name": "OneForma-modern-0.1.12.dmg",
        "downloads": 5,
        "created_at": "2026-11-05T06:28:20Z",
    }
    first = apply_snapshot([], [dmg], "2026-11-13")
    assert first[0]["delta"] is None and first[0]["prev_date"] is None

    later = apply_snapshot(first, [{**dmg, "downloads": 8}], "2026-11-14")
    assert later[-1]["delta"] == 3 and later[-1]["prev_date"] == "2026-11-13"

    rerun = apply_snapshot(first, [{**dmg, "downloads": 6}], "2026-11-13")
    assert len(rerun) == 1 and rerun[0]["downloads"] == 6 and rerun[0]["delta"] is None

    assert has_snapshot(later, "2026-11-14")
    assert not has_snapshot(later, "2026-11-15")
    forced = apply_snapshot(later, [{**dmg, "downloads": 11}], "2026-11-14")
    assert [row for row in forced if row["date"] == "2026-11-13"][0]["downloads"] == 5
    assert forced[-1]["downloads"] == 11
    assert forced[-1]["delta"] == 6 and forced[-1]["prev_date"] == "2026-11-13"

    try:
        assert_no_backwards(
            [{"date": "2026-11-14", "tag": "latest-prod", "name": "a.dmg", "delta": -1}],
            "2026-11-14",
        )
    except SystemExit as exc:
        assert "backwards" in str(exc)
    else:
        raise AssertionError("negative delta should abort")

    replaced = apply_snapshot(
        later,
        [{**dmg, "asset_id": 2, "downloads": 1, "created_at": "2026-11-15T00:00:00Z"}],
        "2026-11-15",
    )
    newest = replaced[-1]
    assert newest["asset_id"] == 2 and newest["delta"] is None
    assert any(row["asset_id"] == 1 and row["date"] == "2026-11-14" for row in replaced)

    assert is_installer("OneForma-modern-qa-0.1.12.zip")
    assert not is_installer("OneForma-modern-0.1.12.zip.blockmap")
    assert not is_installer("latest-mac.yml")
    print("ok")


def main() -> None:
    if "--check" in sys.argv:
        self_check()
        return
    force = "--force" in sys.argv
    today = datetime.now(timezone.utc).date().isoformat()
    root = repo_root()
    stats = root / "stats"
    stats.mkdir(exist_ok=True)
    history_path = stats / "downloads.jsonl"
    history = load_history(history_path)
    if has_snapshot(history, today) and not force:
        print(f"snapshot for {today} already exists")
        return
    observations, missing = collect(repo_slug())
    rows = apply_snapshot(history, observations, today)
    assert_no_backwards(rows, today)
    replace_text(history_path, "".join(dump_row(row) + "\n" for row in rows))
    replace_text(stats / "summary.md", render_summary(rows, missing, today))
    print(f"snapshotted {today}: {len(observations)} assets, missing {missing or 'none'}")


if __name__ == "__main__":
    main()

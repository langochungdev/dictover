#!/usr/bin/env python3
from __future__ import annotations

import os
import json
import shutil
from pathlib import Path


def _workspace_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _addons21_dir() -> Path:
    appdata = os.getenv("APPDATA")
    if not appdata:
        raise RuntimeError("APPDATA is not set, cannot find Anki addons21 directory")

    addons_dir = Path(appdata) / "Anki2" / "addons21"
    addons_dir.mkdir(parents=True, exist_ok=True)
    return addons_dir


def _ignore_filter(_dir: str, names: list[str]) -> set[str]:
    ignored = {
        ".git",
        ".github",
        ".pytest_cache",
        "__pycache__",
        "tests",
    }
    return {name for name in names if name in ignored or name.endswith(".pyc")}


def _addon_folder_name(source_root: Path) -> str:
    manifest_path = source_root / "manifest.json"
    if not manifest_path.exists():
        return source_root.name

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return source_root.name

    package = manifest.get("package") if isinstance(manifest, dict) else None
    if isinstance(package, str) and package.strip():
        return package.strip()
    return source_root.name


def main() -> None:
    source_root = _workspace_root()
    target_root = _addons21_dir() / _addon_folder_name(source_root)

    if target_root.exists():
        shutil.rmtree(target_root)

    shutil.copytree(source_root, target_root, ignore=_ignore_filter)

    print(f"Deployed add-on to: {target_root}")
    print("Done. Close Anki completely, then open it again to load latest version.")


if __name__ == "__main__":
    main()

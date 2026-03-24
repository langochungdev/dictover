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
        "_vendor",
        "__pycache__",
        "tests",
    }
    return {name for name in names if name in ignored or name.endswith(".pyc")}


def _remove_path_if_exists(path: Path) -> bool:
    if not path.exists():
        return False

    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()
    return True


def _argostranslate_state_paths() -> list[Path]:
    candidates: list[Path] = []

    local_appdata = os.getenv("LOCALAPPDATA")
    if local_appdata:
        candidates.append(Path(local_appdata) / "argos-translate")

    appdata = os.getenv("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "argos-translate")

    user_profile = os.getenv("USERPROFILE")
    if user_profile:
        candidates.append(Path(user_profile) / ".local" / "share" / "argos-translate")

    home = os.getenv("HOME")
    if home:
        candidates.append(Path(home) / ".local" / "share" / "argos-translate")

    unique: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        normalized = str(path.resolve()) if path.exists() else str(path)
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(path)

    return unique


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
        vendor_path = target_root / "_vendor"
        if vendor_path.exists():
            shutil.rmtree(vendor_path)
        shutil.rmtree(target_root)

    removed_argos_paths: list[Path] = []
    for path in _argostranslate_state_paths():
        if _remove_path_if_exists(path):
            removed_argos_paths.append(path)

    shutil.copytree(source_root, target_root, ignore=_ignore_filter)

    print(f"Deployed add-on to: {target_root}")
    if removed_argos_paths:
        print("Removed Argos state:")
        for path in removed_argos_paths:
            print(f"- {path}")
    else:
        print("Removed Argos state: none found")
    print("Done. Close Anki completely, then open it again to load latest version.")


if __name__ == "__main__":
    main()

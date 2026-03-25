#!/usr/bin/env python3
from __future__ import annotations

import os
import json
import shutil
import subprocess
import time
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


def _try_remove_tree(path: Path) -> tuple[bool, str]:
    if not path.exists():
        return True, ""

    try:
        shutil.rmtree(path)
        return True, ""
    except Exception as error:
        return False, str(error)


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


def _is_anki_running() -> bool:
    # tasklist is available on Windows and is a reliable way to detect
    # whether Anki keeps native DLLs locked in the addon directory.
    try:
        process = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq anki.exe"],
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception:
        return False

    output = (process.stdout or "").lower()
    return "anki.exe" in output


def _close_anki_if_running() -> tuple[bool, str]:
    if not _is_anki_running():
        return True, ""

    try:
        process = subprocess.run(
            ["taskkill", "/F", "/T", "/IM", "anki.exe"],
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception as error:
        return False, f"Cannot stop Anki process: {error}"

    # Wait briefly for Windows to fully release file locks.
    for _ in range(20):
        if not _is_anki_running():
            return True, ""
        time.sleep(0.25)

    output = (process.stderr or process.stdout or "").strip()
    return False, output or "Anki process is still running after taskkill"


def _find_anki_executable() -> Path | None:
    candidates: list[Path] = []

    local_appdata = os.getenv("LOCALAPPDATA")
    if local_appdata:
        candidates.append(Path(local_appdata) / "Programs" / "Anki" / "anki.exe")

    program_files = os.getenv("ProgramFiles")
    if program_files:
        candidates.append(Path(program_files) / "Anki" / "anki.exe")

    program_files_x86 = os.getenv("ProgramFiles(x86)")
    if program_files_x86:
        candidates.append(Path(program_files_x86) / "Anki" / "anki.exe")

    for candidate in candidates:
        if candidate.exists():
            return candidate

    try:
        process = subprocess.run(
            ["where", "anki.exe"],
            check=False,
            capture_output=True,
            text=True,
        )
        if process.returncode == 0:
            first_line = (process.stdout or "").splitlines()[0].strip()
            if first_line:
                discovered = Path(first_line)
                if discovered.exists():
                    return discovered
    except Exception:
        pass

    return None


def _launch_anki() -> tuple[bool, str]:
    executable = _find_anki_executable()
    if executable is None:
        return False, "Cannot find anki.exe"

    try:
        subprocess.Popen(
            [str(executable)],
            cwd=str(executable.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True, str(executable)
    except Exception as error:
        return False, f"Cannot launch Anki: {error}"


def _enable_local_debug_popup(target_root: Path) -> tuple[bool, str]:
    config_path = target_root / "config.json"
    payload: dict[str, object] = {}

    if config_path.exists():
        try:
            loaded = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                payload = loaded
        except Exception:
            payload = {}

    payload["debug_panel_always_visible"] = True

    try:
        config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return True, str(config_path)
    except Exception as error:
        return False, str(error)


def main() -> None:
    source_root = _workspace_root()
    target_root = _addons21_dir() / _addon_folder_name(source_root)
    deploy_mode = "fresh"
    lock_warnings: list[str] = []
    anki_was_running = _is_anki_running()
    closed_ok, close_error = _close_anki_if_running()
    if not closed_ok:
        raise RuntimeError(close_error)

    if target_root.exists():
        vendor_path = target_root / "_vendor"
        if deploy_mode == "fresh" and vendor_path.exists():
            ok, message = _try_remove_tree(vendor_path)
            if not ok:
                deploy_mode = "in-place"
                lock_warnings.append(f"Cannot remove _vendor: {message}")

        if deploy_mode == "fresh":
            ok, message = _try_remove_tree(target_root)
            if not ok:
                deploy_mode = "in-place"
                lock_warnings.append(f"Cannot remove addon folder: {message}")

    if deploy_mode == "fresh":
        shutil.copytree(source_root, target_root, ignore=_ignore_filter)
    else:
        shutil.copytree(source_root, target_root, ignore=_ignore_filter, dirs_exist_ok=True)

    debug_ok, debug_info = _enable_local_debug_popup(target_root)

    print(f"Deployed add-on to: {target_root}")
    print(f"Deploy mode: {deploy_mode}")
    if anki_was_running:
        print("Anki process: closed automatically before deploy")
    if lock_warnings:
        print("Lock warnings:")
        for warning in lock_warnings:
            print(f"- {warning}")
    if debug_ok:
        print(f"Debug popup enabled for local deploy: {debug_info}")
    else:
        print(f"Debug popup enable failed: {debug_info}")

    launched_ok, launch_info = _launch_anki()
    if launched_ok:
        print(f"Anki relaunched: {launch_info}")
    else:
        print(f"Anki relaunch skipped: {launch_info}")

    print("Done.")


if __name__ == "__main__":
    main()

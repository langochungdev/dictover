# python scripts/build_release.py
#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


EXCLUDED_DIR_NAMES = {
    ".git",
    ".github",
    ".idea",
    ".pytest_cache",
    ".vscode",
    "__pycache__",
    "dist",
    "release",
    "tests",
}

EXCLUDED_FILE_NAMES = {
    ".DS_Store",
}

EXCLUDED_SUFFIXES = {
    ".bak",
    ".log",
    ".pyc",
    ".pyo",
    ".tmp",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build release archives (.zip and .ankiaddon) for this Anki add-on."
    )
    parser.add_argument(
        "--output-dir",
        default="dist",
        help="Output folder relative to repository root (default: dist).",
    )
    parser.add_argument(
        "--version",
        default="",
        help="Optional version tag in output filename. Example: --version 1.2.0",
    )
    parser.add_argument(
        "--include-scripts",
        action="store_true",
        help="Include scripts/ in release artifacts.",
    )
    return parser.parse_args()


def load_manifest(root: Path) -> dict:
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError("manifest.json not found in repository root")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def should_exclude(path: Path, root: Path, include_scripts: bool) -> bool:
    rel = path.relative_to(root)
    parts = set(rel.parts)

    if any(part in EXCLUDED_DIR_NAMES for part in parts):
        return True

    if not include_scripts and rel.parts and rel.parts[0] == "scripts":
        return True

    if path.name in EXCLUDED_FILE_NAMES:
        return True

    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return True

    return False


def collect_files(root: Path, include_scripts: bool) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if should_exclude(path, root, include_scripts):
            continue
        files.append(path)

    required = [root / "__init__.py", root / "manifest.json"]
    missing = [str(path.relative_to(root)) for path in required if path not in files]
    if missing:
        raise RuntimeError(f"Missing required runtime files in package set: {missing}")

    files.sort(key=lambda p: p.relative_to(root).as_posix())
    return files


def build_archive(archive_path: Path, files: list[Path], root: Path) -> None:
    with ZipFile(archive_path, mode="w", compression=ZIP_DEFLATED) as archive:
        for file_path in files:
            arcname = file_path.relative_to(root).as_posix()
            archive.write(file_path, arcname)


def cleanup_previous_artifacts(output_dir: Path, package_name: str) -> None:
    patterns = [
        f"{package_name}.zip",
        f"{package_name}.ankiaddon",
        f"{package_name}-*.zip",
        f"{package_name}-*.ankiaddon",
    ]
    for pattern in patterns:
        for path in output_dir.glob(pattern):
            if path.is_file():
                path.unlink()


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = load_manifest(root)
    package_name = str(manifest.get("package") or root.name).strip() or root.name

    output_dir = (root / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    cleanup_previous_artifacts(output_dir, package_name)

    files = collect_files(root, include_scripts=bool(args.include_scripts))
    if args.version.strip():
        stem = f"{package_name}-{args.version.strip()}"
    else:
        stem = package_name

    zip_path = output_dir / f"{stem}.zip"
    ankiaddon_path = output_dir / f"{stem}.ankiaddon"

    build_archive(zip_path, files, root)
    build_archive(ankiaddon_path, files, root)

    print(f"Built: {zip_path}")
    print(f"Built: {ankiaddon_path}")
    print(f"Files: {len(files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import argostranslate.package


def main() -> None:
    print("Updating Argos package index...")
    argostranslate.package.update_package_index()

    available = argostranslate.package.get_available_packages()
    package = next(
        (pkg for pkg in available if pkg.from_code == "en" and pkg.to_code == "vi"),
        None,
    )

    if package is None:
        raise RuntimeError("Cannot find EN->VI package in Argos index")

    print("Downloading EN->VI package...")
    package_path = package.download()

    print("Installing EN->VI package...")
    argostranslate.package.install_from_path(package_path)
    print("Done")


if __name__ == "__main__":
    main()

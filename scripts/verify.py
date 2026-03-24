#!/usr/bin/env python3
"""
verify.py - Run post-build checks to ensure the add-on is ready for manual testing.
"""
from __future__ import annotations

import json
import os
import sys
import unittest.mock as mock
import zipfile

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors: list[str] = []
warnings: list[str] = []


def check(label, fn):
    try:
        fn()
        print(f"[PASS] {label}")
    except AssertionError as error:
        print(f"[FAIL] {label}: {error}")
        errors.append(label)
    except Exception as error:
        print(f"[WARN] {label}: {error}")
        warnings.append(label)


# 1. Required file structure
def check_files():
    required = [
        "__init__.py",
        "manifest.json",
        "config.json",
        "features/lookup/__init__.py",
        "features/lookup/handler.py",
        "features/lookup/parser.py",
        "features/translate/__init__.py",
        "features/translate/handler.py",
        "services/dictionary_api.py",
        "services/translation_service.py",
        "web/popup.js",
        "web/popup.css",
        "scripts/install_langpack.py",
    ]
    missing = [path for path in required if not os.path.exists(os.path.join(base, path))]
    assert not missing, f"Missing files: {missing}"


check("File structure is complete", check_files)


# 2. Manifest structure
def check_manifest():
    with open(os.path.join(base, "manifest.json"), encoding="utf-8") as file:
        manifest = json.load(file)

    for key in ["package", "name", "min_point_version"]:
        assert key in manifest, f"Missing key: {key}"


check("manifest.json has required keys", check_manifest)


# 3. dictionaryapi.dev online contract
def check_dictionary_api():
    import urllib.request

    url = "https://api.dictionaryapi.dev/api/v2/entries/en/hello"
    with urllib.request.urlopen(url, timeout=5) as response:
        data = json.loads(response.read())

    assert data[0]["word"] == "hello"
    assert "phonetics" in data[0]
    assert "meanings" in data[0]

    audio_urls = [
        item.get("audio")
        for item in data[0].get("phonetics", [])
        if isinstance(item, dict) and item.get("audio")
    ]
    assert len(audio_urls) > 0, "No audio URLs found"


check("dictionaryapi.dev definition + phonetic + audio", check_dictionary_api)


# 4. Parser format
def check_parser():
    sys.path.insert(0, base)
    sys.modules.setdefault("aqt", mock.MagicMock())
    sys.modules.setdefault("aqt.utils", mock.MagicMock())
    sys.modules.setdefault("anki", mock.MagicMock())

    from features.lookup.parser import parse_response

    mock_data = [
        {
            "word": "hello",
            "phonetic": "/həˈloʊ/",
            "phonetics": [{"text": "/həˈloʊ/", "audio": "https://example.com/hello.mp3"}],
            "meanings": [
                {
                    "partOfSpeech": "exclamation",
                    "definitions": [
                        {"definition": "Used as a greeting.", "example": "Hello!"}
                    ],
                }
            ],
        }
    ]

    result = parse_response(mock_data)
    assert result["word"] == "hello"
    assert result["phonetic"] == "/həˈloʊ/"
    assert result["audio_url"] == "https://example.com/hello.mp3"
    assert len(result["meanings"]) > 0


check("parser.py parses dictionary response", check_parser)


# 5. argostranslate offline translation
def check_argos():
    import argostranslate.translate

    result = argostranslate.translate.translate("Hello", "en", "vi")
    assert isinstance(result, str) and len(result) > 0


check("argostranslate translates EN->VI", check_argos)


# 6. Import all modules
def check_imports():
    for module_name in ["aqt", "aqt.utils", "anki"]:
        sys.modules.setdefault(module_name, mock.MagicMock())

    from features.lookup.handler import handle_lookup  # noqa: F401
    from features.translate.handler import handle_translate  # noqa: F401
    from services.dictionary_api import fetch_definition  # noqa: F401
    from services.translation_service import translate_text  # noqa: F401


check("All modules import without crash", check_imports)


# 7. handle_lookup format
def check_handle_lookup():
    for module_name in ["aqt", "aqt.utils", "anki"]:
        sys.modules.setdefault(module_name, mock.MagicMock())

    with mock.patch("services.dictionary_api.fetch_definition") as mocked_fetch:
        mocked_fetch.return_value = [
            {
                "word": "test",
                "phonetic": "/tɛst/",
                "phonetics": [{"text": "/tɛst/", "audio": "https://example.com/test.mp3"}],
                "meanings": [
                    {
                        "partOfSpeech": "noun",
                        "definitions": [
                            {
                                "definition": "A procedure.",
                                "example": "Run a test.",
                            }
                        ],
                    }
                ],
            }
        ]

        from features.lookup.handler import handle_lookup

        result = handle_lookup("test")

    assert result["type"] == "lookup"
    assert result["word"] == "test"
    assert result["phonetic"] == "/tɛst/"
    assert result["audio_url"] != ""
    assert len(result["meanings"]) > 0


check("handle_lookup returns expected JSON", check_handle_lookup)


# 8. handle_translate format
def check_handle_translate():
    for module_name in ["aqt", "aqt.utils", "anki"]:
        sys.modules.setdefault(module_name, mock.MagicMock())

    with mock.patch("services.translation_service.translate_text") as mocked_translate:
        mocked_translate.return_value = "Xin chao the gioi"

        from features.translate.handler import handle_translate

        result = handle_translate("Hello world")

    assert result["type"] == "translate"
    assert result["original"] == "Hello world"
    assert result["translated"] == "Xin chao the gioi"


check("handle_translate returns expected JSON", check_handle_translate)


# 9. popup.js required functions
def check_popup_js():
    with open(os.path.join(base, "web/popup.js"), encoding="utf-8") as file:
        js = file.read()

    for required in ["mouseup", "pycmd", "updatePopover", "showPopover"]:
        assert required in js, f"Missing '{required}' in popup.js"


check("popup.js has required function hooks", check_popup_js)


# 10. Build .ankiaddon package
def build_package():
    output_path = os.path.join(os.path.dirname(base), "anki_popup_lookup.ankiaddon")
    exclude_dirs = {"tests", "__pycache__", ".git", "scripts"}

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, dirs, files in os.walk(base):
            dirs[:] = [folder for folder in dirs if folder not in exclude_dirs]
            for file_name in files:
                if file_name.endswith(".pyc"):
                    continue

                file_path = os.path.join(root, file_name)
                arcname = os.path.relpath(file_path, base)
                archive.write(file_path, arcname)

    assert os.path.exists(output_path)
    print(f"Built package: {output_path}")


check("Build .ankiaddon package", build_package)


print("\n" + "=" * 50)
if errors:
    print(f"FAIL: {len(errors)} check(s) failed: {errors}")
    sys.exit(1)

if warnings:
    print(f"WARN: {len(warnings)} warning(s): {warnings}")
    print("PASS: Core add-on checks completed with warnings.")
else:
    print("PASS: All checks passed.")

print(
    """
Next steps:
1. Symlink or copy this folder into addons21/
2. Run: python scripts/install_langpack.py (one-time EN->VI package install)
3. Restart Anki
4. Open a card and double-click a word for lookup
5. Select a phrase for translation
"""
)

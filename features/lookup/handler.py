from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from .parser import parse_response
except ImportError:
    from features.lookup.parser import parse_response

try:
    from ...services import dictionary_api
except ImportError:
    from services import dictionary_api

try:
    from ...services import translation_service
except ImportError:
    from services import translation_service

DEFAULT_CONFIG: dict[str, Any] = {
    "show_example": True,
    "max_definitions": 3,
}


def _load_config() -> dict[str, Any]:
    config_path = Path(__file__).resolve().parents[2] / "config.json"
    if not config_path.exists():
        return DEFAULT_CONFIG.copy()

    try:
        config_data = json.loads(config_path.read_text(encoding="utf-8"))
        if isinstance(config_data, dict):
            merged = DEFAULT_CONFIG.copy()
            merged.update(config_data)
            return merged
    except Exception:
        pass
    return DEFAULT_CONFIG.copy()


def handle_lookup(word: str) -> dict[str, Any]:
    normalized = (word or "").strip()
    if not normalized:
        return {"type": "error", "message": "Khong co tu de tra."}

    config = _load_config()

    try:
        raw_data = dictionary_api.fetch_definition(normalized)
        parsed = parse_response(raw_data, max_definitions=int(config["max_definitions"]))

        if not bool(config.get("show_example", True)):
            for meaning in parsed.get("meanings", []):
                for definition in meaning.get("definitions", []):
                    definition["example"] = ""

        if not parsed.get("meanings"):
            return {"type": "error", "message": "Khong tim thay tu nay."}

        try:
            translated = translation_service.translate_text(normalized, "en", "vi")
        except Exception:
            translated = ""

        return {
            "type": "lookup",
            "word": parsed.get("word") or normalized,
            "translated": translated,
            "phonetic": parsed.get("phonetic") or "",
            "audio_url": parsed.get("audio_url") or "",
            "meanings": parsed.get("meanings") or [],
        }
    except LookupError:
        return {"type": "error", "message": "Khong tim thay tu nay."}
    except Exception:
        return {"type": "error", "message": "Khong the tra tu luc nay."}

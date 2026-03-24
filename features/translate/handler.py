from __future__ import annotations

import json
from pathlib import Path

try:
    from ...services import translation_service
except ImportError:
    from services import translation_service

DEFAULT_CONFIG: dict[str, object] = {
    "source_language": "en",
    "target_language": "vi",
}


def _load_config() -> dict[str, object]:
    config_path = Path(__file__).resolve().parents[2] / "config.json"
    if not config_path.exists():
        return DEFAULT_CONFIG.copy()

    try:
        config_data = json.loads(config_path.read_text(encoding="utf-8"))
        if isinstance(config_data, dict):
            merged = DEFAULT_CONFIG.copy()
            merged.update(
                {
                    "source_language": str(
                        config_data.get("source_language", DEFAULT_CONFIG["source_language"])
                    ),
                    "target_language": str(
                        config_data.get("target_language", DEFAULT_CONFIG["target_language"])
                    ),
                }
            )
            return merged
    except Exception:
        pass

    return DEFAULT_CONFIG.copy()


def handle_translate(phrase: str) -> dict[str, str]:
    original = (phrase or "").strip()
    if not original:
        return {"type": "error", "message": "Khong co doan van de dich."}

    config = _load_config()
    source_language = str(config["source_language"])
    target_language = str(config["target_language"])

    try:
        translated = translation_service.translate_text(
            original,
            source_language,
            target_language,
        )
    except Exception:
        translated = "Khong the dich luc nay. Thu lai sau it giay."

    return {
        "type": "translate",
        "original": original,
        "translated": translated,
    }

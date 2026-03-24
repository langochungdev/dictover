from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from ...services import translation_service
except ImportError:
    from services import translation_service

try:
    from ...services import setup_service
except ImportError:
    from services import setup_service

DEFAULT_CONFIG: dict[str, object] = {
    "source_language": "en",
    "target_language": "vi",
    "auto_setup_on_startup": False,
    "auto_install_argostranslate": False,
    "auto_install_language_pack": False,
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
                    "auto_setup_on_startup": bool(
                        config_data.get(
                            "auto_setup_on_startup",
                            DEFAULT_CONFIG["auto_setup_on_startup"],
                        )
                    ),
                    "auto_install_argostranslate": bool(
                        config_data.get(
                            "auto_install_argostranslate",
                            DEFAULT_CONFIG["auto_install_argostranslate"],
                        )
                    ),
                    "auto_install_language_pack": bool(
                        config_data.get(
                            "auto_install_language_pack",
                            DEFAULT_CONFIG["auto_install_language_pack"],
                        )
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

    can_auto_setup = bool(config.get("auto_setup_on_startup", True))
    auto_install_dependency = bool(config.get("auto_install_argostranslate", True))
    auto_install_language_pack = bool(config.get("auto_install_language_pack", True))

    ready, reason = setup_service.ensure_translation_ready(
        source_language=source_language,
        target_language=target_language,
        auto_install_dependency=can_auto_setup and auto_install_dependency,
        auto_install_language_pack=can_auto_setup and auto_install_language_pack,
    )

    if not ready:
        return {
            "type": "translate",
            "original": original,
            "translated": (
                "Khong the tu dong setup dich offline. "
                "Kiem tra internet va quyen cai goi. "
                f"Chi tiet: {reason}"
            ),
        }

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

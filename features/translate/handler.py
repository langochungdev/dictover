from __future__ import annotations

import json
from pathlib import Path

try:
    from ...services import translation_service
except ImportError:
    from services import translation_service

try:
    from ...services import tts_service
except ImportError:
    from services import tts_service

DEFAULT_CONFIG: dict[str, object] = {
    "source_language": "en",
    "target_language": "vi",
}

SUPPORTED_SOURCE_LANGUAGES = {
    "auto",
    "en",
    "zh-CN",
    "ja",
    "ko",
    "ru",
    "fi",
    "de",
    "vi",
}

SUPPORTED_TARGET_LANGUAGES = {
    "en",
    "zh-CN",
    "ja",
    "ko",
    "ru",
    "fi",
    "de",
    "vi",
}


def _normalize_source_language(value: object) -> str:
    code = str(value or "").strip()
    return code if code in SUPPORTED_SOURCE_LANGUAGES else str(DEFAULT_CONFIG["source_language"])


def _normalize_target_language(value: object) -> str:
    code = str(value or "").strip()
    return code if code in SUPPORTED_TARGET_LANGUAGES else str(DEFAULT_CONFIG["target_language"])


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
    source_language = _normalize_source_language(config.get("source_language"))
    target_language = _normalize_target_language(config.get("target_language"))

    tts_language = source_language
    if source_language == "auto":
        try:
            detected = translation_service.detect_language(original)
            if detected.lower().startswith("zh"):
                tts_language = "zh-CN"
            elif detected in {"en", "ja", "ko", "ru", "fi", "de", "vi"}:
                tts_language = detected
            else:
                tts_language = "en"
        except Exception:
            tts_language = "en"

    try:
        translated = translation_service.translate_text(
            original,
            source_language,
            target_language,
        )
    except Exception:
        translated = "Khong the dich luc nay. Thu lai sau it giay."

    audio_url = tts_service.build_google_tts_url(original, tts_language)

    return {
        "type": "translate",
        "original": original,
        "translated": translated,
        "audio_url": audio_url,
        "audio_lang": tts_language,
    }

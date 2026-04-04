from __future__ import annotations

import json
import threading
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

try:
    from ...services import tts_service
except ImportError:
    from services import tts_service

DEFAULT_CONFIG: dict[str, Any] = {
    "show_example": True,
    "max_definitions": 3,
    "source_language": "en",
    "target_language": "vi",
    "popover_definition_language_mode": "output",
}

SUPPORTED_SOURCE_LANGUAGES = {
    "auto",
    "en",
    "zh-CN",
    "zh-TW",
    "ja",
    "ko",
    "ru",
    "fi",
    "de",
    "fr",
    "vi",
}
SUPPORTED_TARGET_LANGUAGES = {
    "en",
    "zh-CN",
    "zh-TW",
    "ja",
    "ko",
    "ru",
    "fi",
    "de",
    "fr",
    "vi",
}
SUPPORTED_DEFINITION_LANGUAGE_MODES = {"output", "input", "english"}
DEFINITION_TRANSLATION_CACHE_MAX = 512
LOOKUP_INPUT_MAX_LENGTH = 200
_definition_translation_cache: dict[tuple[str, str, str], str] = {}
_definition_translation_cache_lock = threading.Lock()


def _normalize_source_language(value: object) -> str:
    code = str(value or "").strip()
    return code if code in SUPPORTED_SOURCE_LANGUAGES else "en"


def _normalize_target_language(value: object) -> str:
    code = str(value or "").strip()
    return code if code in SUPPORTED_TARGET_LANGUAGES else "vi"


def _normalize_definition_language_mode(value: object) -> str:
    mode = str(value or "").strip().lower()
    if mode in SUPPORTED_DEFINITION_LANGUAGE_MODES:
        return mode
    return "output"


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


def _first_definition_text(meanings: object) -> str:
    if not isinstance(meanings, list) or not meanings:
        return ""

    first_meaning = meanings[0] if isinstance(meanings[0], dict) else {}
    definitions = (
        first_meaning.get("definitions", []) if isinstance(first_meaning, dict) else []
    )
    if not isinstance(definitions, list) or not definitions:
        return ""

    first_definition = definitions[0] if isinstance(definitions[0], dict) else {}
    return str(first_definition.get("definition") or "").strip()


def _translate_definition_cached(
    text: str, source_language: str, target_language: str
) -> str:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        return ""

    if source_language == target_language:
        return normalized_text

    cache_key = (source_language, target_language, normalized_text)
    with _definition_translation_cache_lock:
        cached = _definition_translation_cache.get(cache_key)
    if cached:
        return cached

    translated = translation_service.translate_text(
        normalized_text,
        source_language,
        target_language,
    ).strip()

    with _definition_translation_cache_lock:
        if len(_definition_translation_cache) >= DEFINITION_TRANSLATION_CACHE_MAX:
            oldest_key = next(iter(_definition_translation_cache), None)
            if oldest_key is not None:
                _definition_translation_cache.pop(oldest_key, None)

        _definition_translation_cache[cache_key] = translated or normalized_text
        return _definition_translation_cache[cache_key]


def handle_lookup(word: str) -> dict[str, Any]:
    normalized = (word or "").strip()
    if not normalized:
        return {"type": "error", "message": "Khong co tu de tra."}
    if len(normalized) > LOOKUP_INPUT_MAX_LENGTH:
        return {"type": "error", "message": "Tu can tra qua dai."}

    config = _load_config()
    source_language = _normalize_source_language(config.get("source_language"))
    target_language = _normalize_target_language(config.get("target_language"))
    definition_language_mode = _normalize_definition_language_mode(
        config.get("popover_definition_language_mode")
    )
    lookup_language = source_language

    if source_language == "auto":
        try:
            detected_language = translation_service.detect_language(normalized)
            lookup_language = translation_service.normalize_detected_language(
                detected_language,
                sample_text=normalized,
                default_language="en",
            )
        except Exception:
            lookup_language = "en"

    try:
        raw_data = dictionary_api.fetch_definition(
            normalized, source_language=lookup_language
        )
        parsed = parse_response(
            raw_data, max_definitions=int(config["max_definitions"])
        )

        if not bool(config.get("show_example", True)):
            for meaning in parsed.get("meanings", []):
                for definition in meaning.get("definitions", []):
                    definition["example"] = ""

        if not parsed.get("meanings"):
            return {"type": "error", "message": "Khong tim thay tu nay."}

        try:
            translated = translation_service.translate_text(
                normalized, lookup_language, target_language
            )
        except Exception:
            translated = "Khong the dich nghia luc nay."

        first_definition = _first_definition_text(parsed.get("meanings") or [])
        definition_target_language = target_language
        if definition_language_mode == "input":
            definition_target_language = lookup_language
        elif definition_language_mode == "english":
            definition_target_language = "en"

        definition_display = first_definition
        if first_definition and lookup_language != definition_target_language:
            try:
                definition_display = _translate_definition_cached(
                    first_definition,
                    lookup_language,
                    definition_target_language,
                )
            except Exception:
                definition_display = first_definition

        audio_url = str(parsed.get("audio_url") or "").strip()
        if not audio_url:
            audio_url = tts_service.build_google_tts_url(
                parsed.get("word") or normalized, lookup_language
            )

        return {
            "type": "lookup",
            "word": parsed.get("word") or normalized,
            "translated": translated,
            "phonetic": parsed.get("phonetic") or "",
            "audio_url": audio_url,
            "audio_lang": lookup_language,
            "definition_display": definition_display,
            "meanings": parsed.get("meanings") or [],
        }
    except LookupError:
        try:
            translated = translation_service.translate_text(
                normalized,
                lookup_language,
                target_language,
            ).strip()
        except Exception:
            translated = ""

        if not translated:
            return {"type": "error", "message": "Khong tim thay tu nay."}

        audio_url = tts_service.build_google_tts_url(normalized, lookup_language)
        return {
            "type": "lookup",
            "word": normalized,
            "translated": translated,
            "phonetic": "",
            "audio_url": audio_url,
            "audio_lang": lookup_language,
            "definition_display": translated,
            "meanings": [
                {
                    "partOfSpeech": "",
                    "definitions": [{"definition": translated, "example": ""}],
                }
            ],
        }
    except Exception:
        return {"type": "error", "message": "Khong the tra tu luc nay."}

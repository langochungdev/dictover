from __future__ import annotations

import importlib


def _load_argos_translate_module():
    try:
        return importlib.import_module("argostranslate.translate")
    except Exception:
        return None


def translate_text(text: str, source_language: str = "en", target_language: str = "vi") -> str:
    if not (text or "").strip():
        raise ValueError("Missing text")

    argos_translate = _load_argos_translate_module()
    if argos_translate is None:
        raise RuntimeError("argostranslate is not installed")

    translated = argos_translate.translate(text, source_language, target_language)
    translated_text = (translated or "").strip()
    if not translated_text:
        raise RuntimeError("argostranslate returned an empty translation")

    return translated_text
